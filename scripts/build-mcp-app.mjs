// Bundle the MCP App viewer (src/mcp/app/main.ts) into a single
// self-contained HTML file at dist/mcp/mcp-app.html.
//
// The MCP Apps iframe runs under a strict CSP with no network access, so
// everything (D3 editor, MathJax, App bridge) is inlined. jsdom is marked
// external: it is only reachable through tikzjs's server-side default math
// renderer, which this app never calls (it passes browser renderers).

import { build } from 'esbuild'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const result = await build({
  entryPoints: [path.join(ROOT, 'src/mcp/app/main.ts')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  write: false,
  external: ['jsdom'],
  logLevel: 'warning',
})

const js = result.outputFiles[0].text

const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>TikZ Viewer</title>
<style>
  html, body { margin: 0; height: 100%; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
  #wrap { display: flex; flex-direction: column; height: 100%; min-height: 320px; }
  #toolbar { display: flex; justify-content: flex-end; gap: 8px; padding: 6px 8px; border-bottom: 1px solid #e5e7eb; background: #f9fafb; }
  #toolbar button { font-size: 12px; padding: 3px 10px; border: 1px solid #d1d5db; border-radius: 6px; background: #fff; color: #374151; cursor: pointer; }
  #toolbar button:hover:not(:disabled) { background: #f3f4f6; }
  #toolbar button:disabled { opacity: 0.4; cursor: default; }
  #diagram { flex: 1; min-height: 0; background: #fff; }
  #status { position: absolute; top: 48px; left: 12px; font-size: 12px; color: #9ca3af; pointer-events: none; }
  #source { display: none; margin: 8px; height: 120px; font-family: Consolas, Menlo, monospace; font-size: 12px; }
</style>
</head>
<body>
<div id="wrap">
  <div id="toolbar">
    <button id="reset" disabled>Reset</button>
    <button id="copy" disabled>Copy TikZ</button>
  </div>
  <div id="diagram"></div>
  <div id="status"></div>
  <textarea id="source" readonly></textarea>
</div>
<script>
${js}
</script>
</body>
</html>
`

const outDir = path.join(ROOT, 'dist', 'mcp')
fs.mkdirSync(outDir, { recursive: true })
const outFile = path.join(outDir, 'mcp-app.html')
fs.writeFileSync(outFile, html, 'utf8')
console.log(`✓ ${path.relative(ROOT, outFile)} (${Math.round(html.length / 1024)} kB)`)
