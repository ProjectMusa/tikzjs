#!/usr/bin/env node
/**
 * Dev server: side-by-side comparison of tikzjs output vs TexLive reference SVGs.
 *
 * Usage:
 *   node scripts/server.js        # default port 3737
 *   node scripts/server.js 4000
 *
 * Routes:
 *   GET /              — fixture list
 *   GET /compare/:name — side-by-side comparison
 *   GET /render/:name  — raw tikzjs SVG (live re-render on each request)
 *   GET /ref/:name     — raw reference SVG from test/golden/refs/
 */

const http = require('http')
const fs = require('fs')
const path = require('path')

const PORT = parseInt(process.argv[2] || '3737', 10)
const ROOT = path.join(__dirname, '..')
const FIXTURES_DIR = process.env.TIKZJS_FIXTURES_DIR || path.join(ROOT, 'test/golden/fixtures')
const REFS_DIR = process.env.TIKZJS_REFS_DIR || path.join(ROOT, 'test/golden/refs')

// ── Helpers ────────────────────────────────────────────────────────────────

function fixtures() {
  return fs.readdirSync(FIXTURES_DIR)
    .filter(f => f.endsWith('.tikz'))
    .sort()
    .map(f => f.replace('.tikz', ''))
}

function renderTikzjs(name) {
  // Clear require cache so edits to dist/ are picked up on each request
  Object.keys(require.cache).forEach(k => {
    if (k.includes('/dist/') || k.includes('/_tikzjs')) delete require.cache[k]
  })
  const { generate } = require(path.join(ROOT, 'dist/index.js'))
  const src = fs.readFileSync(path.join(FIXTURES_DIR, name + '.tikz'), 'utf8')
  return generate(src)
}

function refSvg(name) {
  const p = path.join(REFS_DIR, name + '.svg')
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null
}

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// ── HTML templates ─────────────────────────────────────────────────────────

const CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, sans-serif; background: #f0f0f0; color: #222; }
  a { color: #0066cc; text-decoration: none; }
  a:hover { text-decoration: underline; }
  header { background: #1a1a2e; color: white; padding: 12px 24px; display: flex; align-items: center; gap: 16px; }
  header h1 { font-size: 16px; font-weight: 600; }
  header nav a { color: #aac4ff; font-size: 13px; }
  .list { padding: 24px; display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
  .card { background: white; border-radius: 6px; padding: 14px; border: 1px solid #ddd; }
  .card a { font-size: 13px; font-weight: 500; }
  .card .status { font-size: 11px; margin-top: 6px; color: #888; }
  .card .status.has-ref { color: #2a7a2a; }
  .compare { display: grid; grid-template-columns: 1fr 1fr; gap: 0; height: calc(100vh - 48px); }
  .pane { display: flex; flex-direction: column; overflow: hidden; border-right: 1px solid #ccc; }
  .pane-header { background: #222; color: #eee; padding: 8px 16px; font-size: 12px; display: flex; justify-content: space-between; align-items: center; }
  .pane-header .label { font-weight: 600; }
  .pane-header .hint { color: #888; font-size: 11px; }
  .pane-body { flex: 1; overflow: auto; display: flex; align-items: center; justify-content: center; background: white; padding: 32px; }
  .pane-body svg { width: auto; height: auto; max-width: calc(100% - 64px); max-height: calc(100% - 64px); display: block; }
  .error { background: #fff0f0; color: #cc0000; padding: 16px; font-size: 12px; font-family: monospace; border-radius: 4px; max-width: 500px; white-space: pre-wrap; }
  .no-ref { color: #999; font-size: 13px; text-align: center; }
  .source-pane { background: #1e1e1e; color: #d4d4d4; padding: 16px; font-size: 11px; font-family: monospace; overflow: auto; }
  .nav-strip { background: #2a2a3e; padding: 6px 16px; display: flex; gap: 8px; overflow-x: auto; }
  .nav-strip a { color: #aac4ff; font-size: 11px; white-space: nowrap; padding: 2px 6px; border-radius: 3px; }
  .nav-strip a:hover, .nav-strip a.active { background: #4444aa; color: white; text-decoration: none; }
  .reload { cursor: pointer; background: #333; border: 1px solid #555; color: #ccc; padding: 3px 8px; font-size: 11px; border-radius: 3px; }
  .reload:hover { background: #444; }
`

function pageShell(title, body, extraHead = '') {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${title} — tikzjs</title>
  <style>${CSS}</style>
  ${extraHead}
</head>
<body>${body}</body>
</html>`
}

function header(current) {
  return `<header>
    <h1>tikzjs preview</h1>
    <nav>
      <a href="/">fixtures</a> &nbsp;
      <a href="/diff">visual diff report</a>
    </nav>
  </header>`
}

// ── Route handlers ─────────────────────────────────────────────────────────

function handleIndex(res) {
  const list = fixtures()
  const cards = list.map(name => {
    const hasRef = fs.existsSync(path.join(REFS_DIR, name + '.svg'))
    return `<div class="card">
      <a href="/compare/${name}">${name}</a>
      <div class="status ${hasRef ? 'has-ref' : ''}">${hasRef ? '✓ ref available' : '○ no ref yet'}</div>
    </div>`
  }).join('')

  res.writeHead(200, { 'Content-Type': 'text/html' })
  res.end(pageShell('fixtures', `
    ${header()}
    <div class="nav-strip">
      ${list.map(n => `<a href="/compare/${n}">${n}</a>`).join('')}
    </div>
    <div class="list">${cards}</div>
  `))
}

function handleCompare(name, res) {
  const list = fixtures()
  if (!list.includes(name)) {
    res.writeHead(404); res.end('Not found'); return
  }

  const src = fs.readFileSync(path.join(FIXTURES_DIR, name + '.tikz'), 'utf8')

  // tikzjs pane — embed SVG inline so CSS max-width/max-height scales it the same way as the ref
  let ourPane
  try {
    const svg = renderTikzjs(name)
    ourPane = svg
  } catch (err) {
    ourPane = `<div class="error">Parse/render error:\n${esc(err.message)}</div>`
  }

  // ref pane
  const ref = refSvg(name)
  const refPane = ref
    ? ref  // embed SVG directly
    : `<div class="no-ref">No reference SVG.<br>Run <code>npm run golden</code> to generate.</div>`

  const navLinks = list.map(n =>
    `<a href="/compare/${n}" class="${n === name ? 'active' : ''}">${n}</a>`
  ).join('')

  const autoReload = `<script>
    // Auto-reload every 2s so edits to source are reflected
    let reloadTimer
    function scheduleReload() { reloadTimer = setTimeout(() => location.reload(), 2000) }
    document.querySelector('.reload').addEventListener('click', () => {
      clearTimeout(reloadTimer); location.reload()
    })
  </script>`

  res.writeHead(200, { 'Content-Type': 'text/html' })
  res.end(pageShell(name, `
    ${header(name)}
    <div class="nav-strip">${navLinks}</div>
    <div class="compare">
      <div class="pane">
        <div class="pane-header">
          <span class="label">tikzjs output</span>
          <button class="reload" onclick="location.reload()">↺ reload</button>
        </div>
        <div class="pane-body">${ourPane}</div>
      </div>
      <div class="pane">
        <div class="pane-header">
          <span class="label">TexLive reference</span>
          <span class="hint">${ref ? 'pdflatex + dvisvgm' : 'not generated'}</span>
        </div>
        <div class="pane-body">${refPane}</div>
      </div>
    </div>
    <div class="source-pane">${esc(src)}</div>
    ${autoReload}
  `))
}

function handleRawRender(name, res) {
  try {
    const svg = renderTikzjs(name)
    res.writeHead(200, { 'Content-Type': 'image/svg+xml' })
    res.end(svg)
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain' })
    res.end(err.message)
  }
}

function handleRawRef(name, res) {
  const svg = refSvg(name)
  if (!svg) { res.writeHead(404); res.end('No ref'); return }
  res.writeHead(200, { 'Content-Type': 'image/svg+xml' })
  res.end(svg)
}

// ── Static file server for /tmp/tikzjs-diff/ ──────────────────────────────

const DIFF_DIR = process.env.TIKZJS_DIFF_DIR || '/tmp/tikzjs-golden'
const MIME = { '.html': 'text/html', '.png': 'image/png', '.svg': 'image/svg+xml', '.css': 'text/css' }

function handleDiff(url, res) {
  const rel  = url === '/diff' || url === '/diff/' ? '/index.html' : url.slice('/diff'.length)
  const file = path.join(DIFF_DIR, rel)
  if (!fs.existsSync(file)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end(`No diff report found at ${DIFF_DIR}. Run: make cdiff  (or make cdiff-extra)`)
    return
  }
  const ext = path.extname(file)
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' })
  res.end(fs.readFileSync(file))
}

// ── Server ─────────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0]

  if (url === '/') return handleIndex(res)

  if (url.startsWith('/diff')) return handleDiff(url, res)

  const compareMatch = url.match(/^\/compare\/(.+)$/)
  if (compareMatch) return handleCompare(compareMatch[1], res)

  const renderMatch = url.match(/^\/render\/(.+)$/)
  if (renderMatch) return handleRawRender(renderMatch[1], res)

  const refMatch = url.match(/^\/ref\/(.+)$/)
  if (refMatch) return handleRawRef(refMatch[1], res)

  res.writeHead(404); res.end('Not found')
})

let currentPort = PORT

function listen(port) {
  currentPort = port
  server.listen(port, () => {
    console.log(`tikzjs preview server running at http://localhost:${port}`)
    console.log(`  Fixtures:    http://localhost:${port}/`)
    console.log(`  Diff report: http://localhost:${port}/diff  (run make cdiff first)`)
    console.log(`  Press Ctrl+C to stop`)
  })
}

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    const next = currentPort + 1
    console.warn(`Port ${currentPort} in use, trying ${next}...`)
    server.close()
    listen(next)
  } else {
    throw err
  }
})

listen(PORT)
