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
 * Output: /tmp/tikzjs-diff/ contains per-fixture diff PNGs + summary HTML report
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
const OUT_DIR = '/tmp/tikzjs-diff'
const PORT = 3738  // separate port to avoid collision with serve

// ── Inline server (same as server.js but minimal) ─────────────────────────────

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
  // Get the SVG element bounds
  const svgEl = await page.$('svg')
  if (!svgEl) {
    // Render error page — screenshot it as-is
    return page.screenshot({ clip: { x: 0, y: 0, width: size, height: size } })
  }
  // Fit SVG into fixed canvas for fair comparison
  await page.setViewportSize({ width: size, height: size })
  await page.evaluate((sz) => {
    const svg = document.querySelector('svg')
    if (svg) {
      svg.style.width = sz + 'px'
      svg.style.height = sz + 'px'
      svg.style.display = 'block'
      svg.style.margin = 'auto'
      // Center in body
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

    const hasRef = fs.existsSync(path.join(REFS_DIR, name + '.svg'))

    if (!hasRef) {
      console.log('(no ref)')
      results.push({ name, status: 'no-ref', diffPct: null })
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

      // Save individual images
      const base = path.join(OUT_DIR, name)
      fs.writeFileSync(base + '-ours.png', ourBuf)
      fs.writeFileSync(base + '-ref.png', refBuf)
      fs.writeFileSync(base + '-diff.png', PNG.sync.write(diffPng))

      const status = numDiff === 0 ? 'perfect' : parseFloat(diffPct) < 5 ? 'good' : parseFloat(diffPct) < 20 ? 'warn' : 'fail'
      console.log(`${diffPct}% diff [${status}]`)
      results.push({ name, status, diffPct: parseFloat(diffPct), numDiff })
    } catch (err) {
      console.log(`ERROR: ${err.message}`)
      results.push({ name, status: 'error', diffPct: null, error: err.message })
    }
  }

  await browser.close()
  server.close()

  // ── HTML report ────────────────────────────────────────────────────────────
  const rows = results.map(r => {
    const color = { perfect: '#d4edda', good: '#fff3cd', warn: '#ffeaa7', fail: '#f8d7da', 'no-ref': '#e9ecef', error: '#f8d7da' }[r.status] || '#fff'
    const imgs = r.status !== 'no-ref' && r.status !== 'error'
      ? `<td><img src="${r.name}-ours.png" width="200"></td>
         <td><img src="${r.name}-ref.png" width="200"></td>
         <td><img src="${r.name}-diff.png" width="200" style="filter:contrast(2)"></td>`
      : `<td colspan="3" style="color:#999">${r.error || 'no ref available'}</td>`
    return `<tr style="background:${color}">
      <td><b>${r.name}</b></td>
      <td>${r.diffPct !== null ? r.diffPct + '%' : '—'}</td>
      <td>${r.status}</td>
      ${imgs}
    </tr>`
  }).join('')

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>tikzjs visual diff</title>
  <style>
    body { font-family: monospace; padding: 20px; background: #f5f5f5; }
    h1 { font-size: 18px; }
    table { border-collapse: collapse; background: white; }
    td, th { padding: 8px 12px; border: 1px solid #ddd; vertical-align: top; }
    th { background: #333; color: white; }
    img { display: block; border: 1px solid #ccc; }
  </style>
</head>
<body>
  <h1>tikzjs visual diff — ${new Date().toISOString()}</h1>
  <p>${results.filter(r => r.status === 'perfect').length} perfect &nbsp;
     ${results.filter(r => r.status === 'good').length} good (&lt;5%) &nbsp;
     ${results.filter(r => r.status === 'warn').length} warn &nbsp;
     ${results.filter(r => r.status === 'fail').length} fail &nbsp;
     ${results.filter(r => r.status === 'no-ref').length} no-ref</p>
  <table>
    <tr><th>fixture</th><th>diff%</th><th>status</th><th>ours</th><th>ref</th><th>diff</th></tr>
    ${rows}
  </table>
</body>
</html>`

  const reportPath = path.join(OUT_DIR, 'report.html')
  fs.writeFileSync(reportPath, html)
  console.log(`\nReport: ${reportPath}`)

  if (openReport) {
    const opener = process.platform === 'darwin' ? 'open' : 'xdg-open'
    try { execSync(`${opener} ${reportPath}`, { stdio: 'ignore' }) } catch {}
  }
}

run().catch(err => { console.error(err); process.exit(1) })
