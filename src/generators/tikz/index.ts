/**
 * TikZ Generator — IR → standardized TikZ source code.
 *
 * Takes an IRDiagram and produces a clean, valid TikZ source string
 * that can be compiled by pdflatex. Uses rawOptions for faithful
 * round-trip preservation of the original option syntax.
 */

import type { IRDiagram, StyleDefinition } from '../../ir/types.js'
import { emitOptions } from './optionEmitter.js'
import { emitElement } from './elementEmitter.js'

// ── Options ──────────────────────────────────────────────────────────────────

export interface TikZGeneratorOptions {
  /** Indentation string for nested content. Default: '  ' (2 spaces). */
  indent?: string
}

// ── Style Registry ───────────────────────────────────────────────────────────

function emitStyleRegistry(registry: Record<string, StyleDefinition>): string[] {
  const lines: string[] = []
  for (const [name, def] of Object.entries(registry)) {
    const opts = emitOptions(def.rawOptions)
    if (def.base) {
      lines.push(`\\tikzset{${name}/.append style=${opts}}`)
    } else {
      lines.push(`\\tikzset{${name}/.style=${opts}}`)
    }
  }
  return lines
}

// ── Entry Point ──────────────────────────────────────────────────────────────

/**
 * Generate TikZ source from an IRDiagram.
 */
export function generateTikZ(diagram: IRDiagram, opts?: TikZGeneratorOptions): string {
  const indent = opts?.indent ?? '  '
  const lines: string[] = []

  // Style registry
  const styleLines = emitStyleRegistry(diagram.styleRegistry)
  lines.push(...styleLines)

  // Environment
  const globalOpts = emitOptions(diagram.globalRawOptions)
  lines.push(`\\begin{tikzpicture}${globalOpts}`)

  // Elements
  for (const el of diagram.elements) {
    const emitted = emitElement(el, diagram, indent, 1)
    if (emitted) {
      // Indent top-level elements
      const indented = emitted.split('\n').map(line => indent + line).join('\n')
      lines.push(indented)
    }
  }

  lines.push('\\end{tikzpicture}')
  return lines.join('\n')
}
