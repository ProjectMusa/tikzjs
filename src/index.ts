/**
 * tikzjs public API.
 *
 * This module provides the main entry points for parsing TikZ source
 * and generating output. It replaces src/main.ts.
 *
 * Usage:
 *   import { parse, generate, roundTrip } from 'tikzjs'
 *
 *   // Parse TikZ to IR
 *   const diagram = parse('\\draw (0,0) -- (1,1);')
 *
 *   // Generate SVG
 *   const svg = generate('\\draw (0,0) -- (1,1);')
 *
 *   // Or parse first, then generate (allows IR inspection/manipulation)
 *   const ir = parse('\\draw[->] (A) -- (B);')
 *   const svg = generateFromIR(ir)
 */

import { IRDiagram, IRElement } from './ir/types.js'
import { preprocess, ExpandedDoc } from './preprocessor/index.js'
import { parseExpanded, parseRaw } from './parser/index.js'
import { generateSVG, SVGGeneratorOptions } from './generators/svg/index.js'

export type { IRDiagram, IRElement } from './ir/types.js'
export type { ExpandedDoc } from './preprocessor/index.js'
export type { SVGGeneratorOptions } from './generators/svg/index.js'

// ── Core pipeline ─────────────────────────────────────────────────────────────

/**
 * Parse TikZ source through the full pipeline (preprocess → parse) and
 * return an IRDiagram ready for rendering or manipulation.
 */
export function parse(tikzSource: string): IRDiagram {
  const doc = preprocess(tikzSource)
  return parseExpanded(doc)
}

/**
 * Generate an SVG string from TikZ source.
 * This is the main entry point for rendering.
 */
export function generate(tikzSource: string, opts?: SVGGeneratorOptions): string {
  const diagram = parse(tikzSource)
  return generateSVG(diagram, opts)
}

/**
 * Generate SVG from a pre-parsed IRDiagram.
 * Useful when you want to inspect or modify the IR before rendering.
 */
export function generateFromIR(diagram: IRDiagram, opts?: SVGGeneratorOptions): string {
  return generateSVG(diagram, opts)
}

// ── Backward-compatibility exports (matching old main.ts API) ─────────────────

/**
 * @deprecated Use parse() instead. Returns the IRDiagram.
 */
export function runWorker(tikzSource: string): IRDiagram {
  return parse(tikzSource)
}

/**
 * @deprecated Use generate() instead.
 * Returns the SVG as an outerHTML string.
 */
export function Generate(tikzSource: string): string {
  return generate(tikzSource)
}

// ── IR utilities ──────────────────────────────────────────────────────────────

/**
 * Serialize an IRDiagram to a JSON string.
 * The IR is fully JSON-serializable — no class instances or circular refs.
 */
export function serializeIR(diagram: IRDiagram): string {
  return JSON.stringify(diagram, null, 2)
}

/**
 * Deserialize an IRDiagram from a JSON string.
 */
export function deserializeIR(json: string): IRDiagram {
  return JSON.parse(json) as IRDiagram
}
