import { parse, generateFromIR } from 'tikzjs'
import type { IRDiagram, SVGGeneratorOptions } from 'tikzjs'
import { browserMathRenderer, browserMathModeRenderer, browserScriptMathModeRenderer } from './browserMath.js'

function browserSvgOptions(): SVGGeneratorOptions {
  return {
    document: window.document.implementation.createHTMLDocument(''),
    mathRenderer: browserMathRenderer,
    mathModeRenderer: browserMathModeRenderer,
    scriptMathModeRenderer: browserScriptMathModeRenderer,
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
