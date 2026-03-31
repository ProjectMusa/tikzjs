/**
 * D3 highlight overlays — draws amber selection indicators on the SVG canvas.
 *
 * Dispatches to per-kind element handlers for highlight creation.
 * Cleanup (restoring tinted elements, removing groups) is handled here.
 */

import type { IRDiagram, IRElement } from '../../ir/types.js'
import { NodeGeometryRegistry } from '../core/coordResolver.js'
import { findElement } from './irMutator.js'
import { defaultD3Registry } from './elementHandlers/index.js'

const SVG_NS = 'http://www.w3.org/2000/svg'
export const HIGHLIGHT_CLASS = 'd3-highlight-group'

const TINTED_ATTR = 'data-d3-orig-stroke'
const TINTED_LABEL_ATTR = 'data-d3-orig-color'

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Add or remove the highlight overlay on the SVG canvas.
 * Clears any existing highlight, then draws a new one for `id` (if non-null).
 */
export function highlightElement(
  svg: SVGSVGElement,
  id: string | null,
  elementMap: Map<string, SVGElement>,
  nodeRegistry: NodeGeometryRegistry,
  diagram: IRDiagram | null,
): void {
  // ── Cleanup previous highlights ──
  svg.querySelectorAll(`.${HIGHLIGHT_CLASS}`).forEach((el) => el.remove())
  // Remove cloned tinted markers
  for (const clone of Array.from(svg.querySelectorAll(`[id$="-d3hl"]`))) {
    clone.remove()
  }
  // Restore tinted paths to original stroke color + marker refs
  for (const el of Array.from(svg.querySelectorAll(`[${TINTED_ATTR}]`))) {
    el.setAttribute('stroke', el.getAttribute(TINTED_ATTR) ?? '')
    el.removeAttribute(TINTED_ATTR)
    for (const attr of ['marker-start', 'marker-end', 'marker-mid']) {
      const saved = el.getAttribute(TINTED_ATTR + `-${attr}`)
      if (saved) {
        el.setAttribute(attr, saved)
        el.removeAttribute(TINTED_ATTR + `-${attr}`)
      }
    }
  }
  // Restore tinted labels to original fill
  for (const el of Array.from(svg.querySelectorAll(`[${TINTED_LABEL_ATTR}]`))) {
    const origFill = el.getAttribute(TINTED_LABEL_ATTR) ?? ''
    if (origFill) {
      el.setAttribute('fill', origFill)
    } else {
      el.removeAttribute('fill')
    }
    el.removeAttribute(TINTED_LABEL_ATTR)
  }
  if (!id) return

  // ── Find target element ──
  let target = elementMap.get(id)
  if (!target) {
    target = svg.querySelector(`[data-ir-id="${id}"]`) as SVGElement | null ?? undefined
  }
  if (!target) return

  const doc = svg.ownerDocument
  if (!doc) return

  // ── Dispatch to handler ──
  const kind = target.getAttribute('data-ir-kind') as keyof typeof defaultD3Registry | null
  const handler = kind ? defaultD3Registry[kind] : null
  const irElement = diagram ? findElement(diagram.elements, id) : null

  const group = doc.createElementNS(SVG_NS, 'g')
  group.setAttribute('class', HIGHLIGHT_CLASS)

  if (handler && irElement) {
    const ctx = { nodeRegistry, diagram: diagram! }
    const result = handler.createHighlight(irElement as any, target, svg, ctx)
    if (result) {
      for (const overlay of result.overlays) group.appendChild(overlay)
      if (result.handles) {
        for (const handle of result.handles) group.appendChild(handle)
      }
    }
  }

  // Render on top of everything, inside the zoom group if present
  const zoomGroup = svg.querySelector('.d3-zoom-group')
  ;(zoomGroup ?? svg).appendChild(group)
}
