import { generateTikZ } from 'tikzjs'
import type { IRDiagram } from 'tikzjs'

/**
 * Generate TikZ source from an IRDiagram in the browser.
 * Used by the D3 editor to update the source code when nodes are dragged.
 */
export function generateTikZSource(diagram: IRDiagram): string {
  return generateTikZ(diagram)
}
