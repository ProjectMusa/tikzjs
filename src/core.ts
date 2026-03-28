/**
 * Core pipeline — Node.js CJS-safe entry point.
 *
 * Contains parse/generate functions without D3 editor dependencies.
 * Use this from Node.js scripts that need CJS require().
 * The full API (including D3 editor) is in index.ts.
 */

import type { IRDiagram } from './ir/types.js'
import { preprocess } from './preprocessor/index.js'
import { parseExpanded } from './parser/index.js'
import { generateSVG } from './generators/svg/index.js'
import type { SVGGeneratorOptions } from './generators/svg/index.js'
import { generateTikZ } from './generators/tikz/index.js'
import type { TikZGeneratorOptions } from './generators/tikz/index.js'

export type { IRDiagram, IRElement } from './ir/types.js'
export type { ExpandedDoc } from './preprocessor/index.js'
export { generateSVGElement } from './generators/svg/index.js'
export type { SVGGeneratorOptions, SVGElementResult } from './generators/svg/index.js'
export { generateTikZ } from './generators/tikz/index.js'
export type { TikZGeneratorOptions } from './generators/tikz/index.js'
export type { SVGRenderingConstants } from './generators/svg/constants.js'
export { DEFAULT_CONSTANTS } from './generators/svg/constants.js'
export type { SVGRendererRegistry } from './generators/svg/rendererRegistry.js'
export type { RenderContext, ElementRenderResult } from './generators/svg/renderContext.js'
export type { MathRenderer, MathResult } from './math/index.js'
export { defaultMathRenderer } from './math/index.js'
// irMutator has no d3 dependency — safe to re-export
export { moveNode, findNode, isDraggable, collectNodes, findElement, updateCurveControl, moveSegmentEndpoint, updateNodeLabel, updateEdgeLabel, removeElement, addNode } from './generators/d3/irMutator.js'

export function parse(tikzSource: string): IRDiagram {
  const doc = preprocess(tikzSource)
  return parseExpanded(doc)
}

export function generate(tikzSource: string, opts?: SVGGeneratorOptions): string {
  const diagram = parse(tikzSource)
  return generateSVG(diagram, opts)
}

export function generateFromIR(diagram: IRDiagram, opts?: SVGGeneratorOptions): string {
  return generateSVG(diagram, opts)
}

export function generateTikZFromIR(diagram: IRDiagram, opts?: TikZGeneratorOptions): string {
  return generateTikZ(diagram, opts)
}

export function runWorker(tikzSource: string): IRDiagram {
  return parse(tikzSource)
}

export function Generate(tikzSource: string): string {
  return generate(tikzSource)
}

export function serializeIR(diagram: IRDiagram): string {
  return JSON.stringify(diagram, null, 2)
}

export function deserializeIR(json: string): IRDiagram {
  return JSON.parse(json) as IRDiagram
}
