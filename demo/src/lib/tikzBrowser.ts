import { parse, generateFromIR, initPretext, createPretextMeasurer } from 'tikzjs'
import type { IRDiagram, SVGGeneratorOptions, TextMeasurer } from 'tikzjs'
import { browserMathRenderer, browserMathModeRenderer, browserScriptMathModeRenderer } from './browserMath.js'

let _textMeasurer: TextMeasurer | undefined

/**
 * Initialize the pretext text measurer for hybrid text+math layout.
 * Call once at app startup. Safe to call multiple times.
 */
export async function initTextLayout(): Promise<boolean> {
  const ok = await initPretext()
  if (ok) {
    _textMeasurer = createPretextMeasurer() ?? undefined
  }
  return ok
}

function browserSvgOptions(): SVGGeneratorOptions {
  return {
    document: window.document.implementation.createHTMLDocument(''),
    mathRenderer: browserMathRenderer,
    mathModeRenderer: browserMathModeRenderer,
    scriptMathModeRenderer: browserScriptMathModeRenderer,
    textMeasurer: _textMeasurer,
  }
}

/**
 * Parse TikZ source to IR in the browser.
 */
export function parseTikz(source: string): IRDiagram {
  return parse(source)
}

/**
 * Render TikZ source to an SVG string in the browser.
 */
export function renderTikz(source: string): string {
  const ir = parse(source)
  return generateFromIR(ir, browserSvgOptions())
}

/**
 * Render an IR diagram directly to SVG (for D3 editor round-trip).
 */
export function renderTikzFromIR(diagram: IRDiagram): string {
  return generateFromIR(diagram, browserSvgOptions())
}
