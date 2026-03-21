#!/usr/bin/env node
/**
 * Visual diff tool: screenshot tikzjs vs TexLive reference SVGs using Playwright,
 * then compare with pixelmatch.
 *
 * Usage:
 *   node scripts/visualdiff.js              # diff all fixtures with refs
 *   node scripts/visualdiff.js 01 05        # diff specific fixtures by prefix
 *   node scripts/visualdiff.js --open       # open HTML report after run
 *
 * Output: $DIFF_OUT_DIR (default /tmp/tikzjs-diff) — per-fixture PNGs + report.html
 *
 * Requires the dev server to NOT be running (this script starts its own).
 */

const { chromium } = require('playwright')
const http = require('http')
const fs = require('fs')
const path = require('path')
const { PNG } = require('pngjs')
const pixelmatch = require('pixelmatch')
const { execSync } = require('child_process')

const ROOT = path.join(__dirname, '..')
const FIXTURES_DIR = path.join(ROOT, 'test/golden/fixtures')
const REFS_DIR = path.join(ROOT, 'test/golden/refs')
const OUT_DIR = process.env.DIFF_OUT_DIR || '/tmp/tikzjs-diff'
const PORT = 3738  // separate port to avoid collision with serve

// ── Inline server ─────────────────────────────────────────────────────────────

function startServer() {
  Object.keys(require.cache).forEach(k => {
    if (k.includes('/dist/') || k.includes('/_tikzjs')) delete require.cache[k]
  })
  const { generate } = require(path.join(ROOT, 'dist/index.js'))

  const server = http.createServer((req, res) => {
    const url = req.url.split('?')[0]
    const renderMatch = url.match(/^\/render\/(.+)$/)
    const refMatch    = url.match(/^\/ref\/(.+)$/)

    if (renderMatch) {
      const name = renderMatch[1]
      try {
        const src = fs.readFileSync(path.join(FIXTURES_DIR, name + '.tikz'), 'utf8')
        const svg = generate(src)
        const html = `<!DOCTYPE html><html><body style="margin:0;background:white">${svg}</body></html>`
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(html)
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain' })
        res.end(err.message)
      }
    } else if (refMatch) {
      const name = refMatch[1]
      const p = path.join(REFS_DIR, name + '.svg')
      if (!fs.existsSync(p)) { res.writeHead(404); res.end('no ref'); return }
      const svg = fs.readFileSync(p, 'utf8')
      const html = `<!DOCTYPE html><html><body style="margin:0;background:white">${svg}</body></html>`
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(html)
    } else {
      res.writeHead(404); res.end()
    }
  })

  return new Promise((resolve) => server.listen(PORT, () => resolve(server)))
}

// ── PNG helpers ────────────────────────────────────────────────────────────────

async function svgToPng(page, url, size = 600) {
  await page.goto(url, { waitUntil: 'networkidle' })
  const svgEl = await page.$('svg')
  if (!svgEl) {
    return page.screenshot({ clip: { x: 0, y: 0, width: size, height: size } })
  }
  await page.setViewportSize({ width: size, height: size })
  await page.evaluate((sz) => {
    const svg = document.querySelector('svg')
    if (svg) {
      svg.style.width = sz + 'px'
      svg.style.height = sz + 'px'
      svg.style.display = 'block'
      svg.style.margin = 'auto'
      document.body.style.display = 'flex'
      document.body.style.alignItems = 'center'
      document.body.style.justifyContent = 'center'
      document.body.style.height = sz + 'px'
    }
  }, size)
  return page.screenshot({ clip: { x: 0, y: 0, width: size, height: size } })
}

function parsePng(buf) {
  return new Promise((resolve, reject) => {
    new PNG().parse(buf, (err, data) => err ? reject(err) : resolve(data))
  })
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// ── HTML report ────────────────────────────────────────────────────────────────

function buildReport(results, generatedAt) {
  const diffResults = results.filter(r => r.status !== 'perfect')
  const perfectCount = results.filter(r => r.status === 'perfect').length
  const counts = {
    good: results.filter(r => r.status === 'good').length,
    warn: results.filter(r => r.status === 'warn').length,
    fail: results.filter(r => r.status === 'fail').length,
    'no-ref': results.filter(r => r.status === 'no-ref').length,
    error: results.filter(r => r.status === 'error').length,
  }

  const statusColors = { good: '#2d8a4e', warn: '#b8860b', fail: '#c0392b', 'no-ref': '#666', error: '#c0392b' }
  const statusBg    = { good: '#d4f5e2', warn: '#fff8d6', fail: '#fde8e8', 'no-ref': '#f0f0f0', error: '#fde8e8' }

  const cards = diffResults.map(r => {
    const bg = statusBg[r.status] || '#fff'
    const fg = statusColors[r.status] || '#333'
    const tikzSrc = r.tikzSource ? escapeHtml(r.tikzSource) : ''
    const imagesHtml = (r.status !== 'no-ref' && r.status !== 'error')
      ? `<div class="images">
          <figure><figcaption>tikzjs</figcaption><img src="${r.name}-ours.png" loading="lazy"></figure>
          <figure><figcaption>reference</figcaption><img src="${r.name}-ref.png" loading="lazy"></figure>
          <figure><figcaption>diff (2× contrast)</figcaption><img src="${r.name}-diff.png" loading="lazy" class="diff-img"></figure>
        </div>`
      : `<p class="error-msg">${r.error || 'no reference SVG available'}</p>`

    return `<article class="card" style="background:${bg}">
  <header>
    <h2>${r.name}</h2>
    <span class="badge" style="color:${fg}">${r.status}${r.diffPct !== null ? ' — ' + r.diffPct + '%' : ''}</span>
  </header>
  ${imagesHtml}
  ${tikzSrc ? `<details class="source"><summary>TikZ source</summary><pre><code>${tikzSrc}</code></pre></details>` : ''}
</article>`
  }).join('\n')

  const summaryItems = Object.entries(counts)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `<span class="pill" style="background:${statusBg[k]};color:${statusColors[k]}">${v} ${k}</span>`)
    .join(' ')

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>tikzjs golden diff</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: ui-monospace, 'Cascadia Code', monospace; background: #f8f8f8; color: #1a1a1a; padding: 24px; }
    h1 { font-size: 1.2rem; font-weight: 700; margin-bottom: 4px; }
    .meta { font-size: 0.8rem; color: #666; margin-bottom: 20px; }
    .summary { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 28px; align-items: center; }
    .summary strong { font-size: 0.85rem; }
    .pill { font-size: 0.75rem; font-weight: 600; padding: 3px 10px; border-radius: 999px; }
    .perfect-note { font-size: 0.8rem; color: #2d8a4e; background: #d4f5e2; padding: 3px 10px; border-radius: 999px; }
    .cards { display: flex; flex-direction: column; gap: 20px; }
    .card { border-radius: 8px; padding: 16px; border: 1px solid rgba(0,0,0,0.08); }
    .card header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 14px; }
    .card h2 { font-size: 0.95rem; font-weight: 600; }
    .badge { font-size: 0.8rem; font-weight: 700; }
    .images { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; }
    figure { display: flex; flex-direction: column; gap: 4px; }
    figcaption { font-size: 0.7rem; color: #666; text-transform: uppercase; letter-spacing: 0.05em; }
    img { display: block; width: 200px; border: 1px solid rgba(0,0,0,0.12); border-radius: 4px; background: white; }
    .diff-img { filter: contrast(2); }
    .source summary { font-size: 0.78rem; cursor: pointer; color: #555; margin-bottom: 8px; user-select: none; }
    .source pre { background: #1e1e1e; color: #d4d4d4; padding: 12px 14px; border-radius: 6px; font-size: 0.78rem; line-height: 1.5; overflow-x: auto; white-space: pre; }
    .error-msg { font-size: 0.82rem; color: #888; margin: 8px 0; }
    .no-diffs { text-align: center; padding: 60px 20px; color: #2d8a4e; font-size: 1rem; }
  </style>
</head>
<body>
  <h1>tikzjs golden diff</h1>
  <p class="meta">Generated ${generatedAt}</p>
  <div class="summary">
    <strong>${results.length} fixtures</strong>
    ${perfectCount > 0 ? `<span class="perfect-note">${perfectCount} perfect</span>` : ''}
    ${summaryItems}
  </div>
  <div class="cards">
    ${diffResults.length === 0
      ? '<div class="no-diffs">All fixtures match perfectly.</div>'
      : cards}
  </div>
</body>
</html>`
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function run() {
  const args = process.argv.slice(2).filter(a => a !== '--open')
  const openReport = process.argv.includes('--open')

  const allFixtures = fs.readdirSync(FIXTURES_DIR)
    .filter(f => f.endsWith('.tikz'))
    .sort()
    .map(f => f.replace('.tikz', ''))

  const fixtures = args.length
    ? allFixtures.filter(n => args.some(a => n.startsWith(a)))
    : allFixtures.filter(n => fs.existsSync(path.join(REFS_DIR, n + '.svg')))

  if (fixtures.length === 0) {
    console.log('No fixtures with refs found. Run npm run golden first.')
    process.exit(0)
  }

  fs.mkdirSync(OUT_DIR, { recursive: true })

  console.log(`Diffing ${fixtures.length} fixtures...`)
  const server = await startServer()
  const browser = await chromium.launch()
  const page = await browser.newPage()

  const results = []

  for (const name of fixtures) {
    process.stdout.write(`  ${name} ... `)

    const ourUrl = `http://localhost:${PORT}/render/${name}`
    const refUrl = `http://localhost:${PORT}/ref/${name}`
    const tikzPath = path.join(FIXTURES_DIR, name + '.tikz')
    const tikzSource = fs.existsSync(tikzPath) ? fs.readFileSync(tikzPath, 'utf8') : null

    const hasRef = fs.existsSync(path.join(REFS_DIR, name + '.svg'))

    if (!hasRef) {
      console.log('(no ref)')
      results.push({ name, status: 'no-ref', diffPct: null, tikzSource })
      continue
    }

    try {
      const SIZE = 600
      const ourBuf = await svgToPng(page, ourUrl, SIZE)
      const refBuf = await svgToPng(page, refUrl, SIZE)

      const ourPng = await parsePng(ourBuf)
      const refPng = await parsePng(refBuf)

      const diffPng = new PNG({ width: SIZE, height: SIZE })
      const numDiff = pixelmatch(
        ourPng.data, refPng.data, diffPng.data,
        SIZE, SIZE,
        { threshold: 0.15, includeAA: false }
      )
      const diffPct = (numDiff / (SIZE * SIZE) * 100).toFixed(1)

      const base = path.join(OUT_DIR, name)
      fs.writeFileSync(base + '-ours.png', ourBuf)
      fs.writeFileSync(base + '-ref.png', refBuf)
      fs.writeFileSync(base + '-diff.png', PNG.sync.write(diffPng))

      const status = numDiff === 0 ? 'perfect' : parseFloat(diffPct) < 5 ? 'good' : parseFloat(diffPct) < 20 ? 'warn' : 'fail'
      console.log(`${diffPct}% diff [${status}]`)
      results.push({ name, status, diffPct: parseFloat(diffPct), numDiff, tikzSource })
    } catch (err) {
      console.log(`ERROR: ${err.message}`)
      results.push({ name, status: 'error', diffPct: null, error: err.message, tikzSource })
    }
  }

  await browser.close()
  server.close()

  const reportPath = path.join(OUT_DIR, 'index.html')
  fs.writeFileSync(reportPath, buildReport(results, new Date().toISOString()))
  console.log(`\nReport: ${reportPath}`)

  if (openReport) {
    const opener = process.platform === 'darwin' ? 'open' : 'xdg-open'
    try { execSync(`${opener} ${reportPath}`, { stdio: 'ignore' }) } catch {}
  }
}

run().catch(err => { console.error(err); process.exit(1) })
