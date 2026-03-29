#!/usr/bin/env node
/**
 * Preview a fixture or arbitrary TikZ string as SVG.
 *
 * Usage:
 *   node scripts/preview.js [fixture-name-or-number]
 *   node scripts/preview.js 18
 *   node scripts/preview.js test/golden/fixtures/18-arc-shapes.tikz
 *   echo '\draw (0,0) -- (1,1);' | node scripts/preview.js
 *
 * Opens result in browser (Linux: xdg-open, macOS: open).
 * If no browser available, writes to /tmp/tikzjs-preview.svg and prints path.
 */

const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')
const { generate } = require('../dist/core.js')

const FIXTURES_DIR = path.join(__dirname, '../test/golden/fixtures')
const OUT = '/tmp/tikzjs-preview.svg'

function findFixture(arg) {
  if (!arg) return null
  // Numeric shorthand: "18" → find fixture starting with "18-"
  if (/^\d+$/.test(arg)) {
    const files = fs.readdirSync(FIXTURES_DIR).filter(f => f.startsWith(arg + '-'))
    if (files.length) return path.join(FIXTURES_DIR, files[0])
  }
  // Direct path
  if (fs.existsSync(arg)) return arg
  // Relative to fixtures dir
  const candidate = path.join(FIXTURES_DIR, arg.endsWith('.tikz') ? arg : arg + '.tikz')
  if (fs.existsSync(candidate)) return candidate
  return null
}

let source

const arg = process.argv[2]
const fixturePath = findFixture(arg)

if (fixturePath) {
  source = fs.readFileSync(fixturePath, 'utf8')
  console.log(`Rendering: ${path.basename(fixturePath)}`)
} else if (!process.stdin.isTTY) {
  source = fs.readFileSync('/dev/stdin', 'utf8')
} else if (arg) {
  // Treat arg itself as TikZ source
  source = arg
} else {
  console.log('Usage: node scripts/preview.js [fixture-number|fixture-name|tikz-source]')
  console.log('       echo "\\\\draw (0,0) -- (1,1);" | node scripts/preview.js')
  console.log()
  console.log('Fixtures:')
  fs.readdirSync(FIXTURES_DIR).filter(f => f.endsWith('.tikz')).sort().forEach(f => {
    console.log('  ' + f.replace('.tikz', ''))
  })
  process.exit(0)
}

let svg
try {
  svg = generate(source)
} catch (err) {
  console.error('Parse/render error:', err.message)
  process.exit(1)
}

// Wrap in a simple HTML page for comfortable browser viewing
const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>tikzjs preview</title>
  <style>
    body { background: #f8f8f8; display: flex; flex-direction: column; align-items: center; padding: 40px; font-family: monospace; }
    .diagram { background: white; border: 1px solid #ddd; padding: 40px; border-radius: 4px; }
    .diagram svg { display: block; }
    pre { background: #eee; padding: 16px; border-radius: 4px; max-width: 900px; overflow: auto; font-size: 12px; }
  </style>
</head>
<body>
  <div class="diagram">${svg}</div>
  <details><summary style="cursor:pointer;margin-top:16px">SVG source</summary><pre>${svg.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</pre></details>
</body>
</html>`

const htmlOut = '/tmp/tikzjs-preview.html'
fs.writeFileSync(htmlOut, html)
fs.writeFileSync(OUT, svg)

// Try to open in browser
const opener = process.platform === 'darwin' ? 'open' : 'xdg-open'
try {
  execSync(`${opener} ${htmlOut}`, { stdio: 'ignore' })
  console.log(`Opened in browser: ${htmlOut}`)
} catch {
  console.log(`SVG written to: ${OUT}`)
  console.log(`HTML written to: ${htmlOut}`)
}
