/**
 * Parser entrypoint.
 *
 * Takes a preprocessed source string (from the preprocessor pipeline)
 * and returns an IRDiagram.
 */

import type { IRDiagram } from '../ir/types.js'
import type { ExpandedDoc } from '../preprocessor/index.js'
import { resetIdCounter } from './factory.js'

// The generated parser is a CommonJS module (Peggy output)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const generatedParser = require('./_tikzjs.js')

export interface ParseOptions {
  /** Reset element ID counter before parsing (for deterministic output in tests). */
  resetIds?: boolean
}

/**
 * Parse an ExpandedDoc (output of the preprocessor) into an IRDiagram.
 */
export function parseExpanded(doc: ExpandedDoc, opts: ParseOptions = {}): IRDiagram {
  if (opts.resetIds) resetIdCounter()

  const nodeRegistry: Record<string, string> = {}

  const diagram = generatedParser.parse(doc.source, {
    styleRegistry: doc.styleRegistry,
    tikzcdGrids: doc.tikzcdGrids,
    nodeRegistry,
  }) as IRDiagram

  // Merge the node registry populated during parse
  if (diagram) {
    Object.assign(diagram.nodeRegistry, nodeRegistry)
  }

  return diagram
}

/**
 * Parse raw TikZ source directly (without pre-processing).
 * Useful for testing the parser in isolation.
 */
export function parseRaw(source: string, opts: ParseOptions = {}): IRDiagram {
  if (opts.resetIds) resetIdCounter()

  const nodeRegistry: Record<string, string> = {}

  return generatedParser.parse(source, {
    nodeRegistry,
  }) as IRDiagram
}

export type { IRDiagram }
