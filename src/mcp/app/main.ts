/**
 * MCP App viewer — interactive TikZ diagram rendered inside the host's
 * sandboxed iframe (MCP Apps extension).
 *
 * The server's `view_tikz` tool sends `{ source, diagram }` as structured
 * content; this app renders the IR with the D3 editor in 'present' mode
 * (drag nodes/control points, pan/zoom) plus Reset and Copy TikZ actions.
 * Bundled to a self-contained HTML file by scripts/build-mcp-app.mjs.
 */

import { App } from '@modelcontextprotocol/ext-apps'
import { createD3Editor, D3EditorController } from '../../generators/d3/index.js'
import { generateTikZ } from '../../generators/tikz/index.js'
import { preprocess } from '../../preprocessor/index.js'
import { parseExpanded } from '../../parser/index.js'
import type { IRDiagram } from '../../ir/types.js'
import {
  browserMathRenderer,
  browserMathModeRenderer,
  browserScriptMathModeRenderer,
} from './browserMath.js'

const diagramEl = document.getElementById('diagram') as HTMLDivElement
const statusEl = document.getElementById('status') as HTMLDivElement
const resetBtn = document.getElementById('reset') as HTMLButtonElement
const copyBtn = document.getElementById('copy') as HTMLButtonElement
const sourceEl = document.getElementById('source') as HTMLTextAreaElement

let controller: D3EditorController | null = null
let current: IRDiagram | null = null
let original: IRDiagram | null = null

function render(diagram: IRDiagram): void {
  controller?.destroy()
  diagramEl.innerHTML = ''
  current = diagram
  controller = createD3Editor(diagramEl, diagram, {
    onIRChange: (d) => {
      current = d
    },
    svgOptions: {
      document: document.implementation.createHTMLDocument(''),
      mathRenderer: browserMathRenderer,
      mathModeRenderer: browserMathModeRenderer,
      scriptMathModeRenderer: browserScriptMathModeRenderer,
    },
    showGrid: false,
    interactionMode: 'present',
  })
  statusEl.textContent = ''
  resetBtn.disabled = false
  copyBtn.disabled = false
}

function flash(message: string): void {
  const prev = copyBtn.textContent
  copyBtn.textContent = message
  setTimeout(() => {
    copyBtn.textContent = prev
  }, 1500)
}

resetBtn.addEventListener('click', () => {
  if (original) render(structuredClone(original))
  controller?.resetZoom()
})

copyBtn.addEventListener('click', async () => {
  if (!current) return
  const source = generateTikZ(current)
  try {
    await navigator.clipboard.writeText(source)
    flash('Copied!')
  } catch {
    // Clipboard may be blocked in the sandbox — show the source for manual copy.
    sourceEl.value = source
    sourceEl.style.display = 'block'
    sourceEl.select()
  }
})

/** Render from whatever data the host forwarded: prefer the pre-parsed IR
 *  from structuredContent, fall back to parsing TikZ source in the iframe
 *  (hosts differ in whether they forward structured output vs. tool input). */
function renderFromData(data: { source?: unknown; diagram?: unknown } | undefined): boolean {
  if (data?.diagram && typeof data.diagram === 'object') {
    const diagram = data.diagram as IRDiagram
    original = structuredClone(diagram)
    render(structuredClone(diagram))
    return true
  }
  if (typeof data?.source === 'string' && data.source.trim()) {
    try {
      const diagram = parseExpanded(preprocess(data.source))
      original = structuredClone(diagram)
      render(diagram)
      return true
    } catch (err) {
      statusEl.textContent = `TikZ parse error: ${err instanceof Error ? err.message : String(err)}`
      return true // handled — show the error rather than "no data"
    }
  }
  return false
}

async function main(): Promise<void> {
  const app = new App({ name: 'tikzjs-viewer', version: '0.1.0' })

  // Register before connect() so the initial notifications are not missed.
  // Tool input arrives first and carries the raw source — enough to render
  // even on hosts that do not forward structuredContent.
  app.ontoolinput = (params) => {
    renderFromData(params.arguments as { source?: unknown } | undefined)
  }

  app.ontoolresult = (params) => {
    if (renderFromData(params.structuredContent as { source?: unknown; diagram?: unknown } | undefined)) return
    if (controller) return // already rendered from tool input
    statusEl.textContent = params.isError
      ? 'Tool call failed — see the conversation for the error.'
      : 'No diagram data received from the host.'
  }

  await app.connect()
  if (!controller) statusEl.textContent = 'Waiting for diagram…'
}

main().catch((err) => {
  statusEl.textContent = `Viewer failed to start: ${err instanceof Error ? err.message : String(err)}`
})
