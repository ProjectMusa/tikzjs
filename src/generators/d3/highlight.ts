/**
 * D3 highlight overlays — draws amber selection indicators on the SVG canvas.
 *
 * All visual properties are set as direct SVG attributes (not CSS classes) so
 * that the overlay is always visible regardless of CSS cascade or SVG defaults.
 *
 * For nodes: dashed bounding box from the NodeGeometryRegistry + anchor dots
 * For paths/edges: amber path overlay + dashed bbox via getBBox()
 */

import { NodeGeometryRegistry } from '../core/coordResolver.js'

const SVG_NS = 'http://www.w3.org/2000/svg'
export const HIGHLIGHT_CLASS = 'd3-highlight-group'

const AMBER = '#f59e0b'
const AMBER_FILL = 'rgba(245,158,11,0.08)'

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
): void {
  // Remove all existing highlight groups
  svg.querySelectorAll(`.${HIGHLIGHT_CLASS}`).forEach((el) => el.remove())
  if (!id) return

  let target = elementMap.get(id)
  if (!target) {
    target = svg.querySelector(`[data-ir-id="${id}"]`) as SVGElement | null ?? undefined
  }
  if (!target) return

  const doc = svg.ownerDocument
  if (!doc) return

  const group = doc.createElementNS(SVG_NS, 'g')
  group.setAttribute('class', HIGHLIGHT_CLASS)

  const kind = target.getAttribute('data-ir-kind')
  if (kind === 'path' || kind === 'edge') {
    addPathHighlight(doc, group, target)
  } else {
    // node, coordinate, matrix cell
    addNodeHighlight(doc, group, target, id, nodeRegistry)
  }

  // Render on top of everything
  svg.appendChild(group)
}

// ── Node highlight ────────────────────────────────────────────────────────────

/**
 * Draw an amber dashed bounding box + anchor dots for a node.
 * Geometry comes from NodeGeometryRegistry (pre-computed in SVG Pass 1),
 * avoiding unreliable getBBox() calls.
 */
function addNodeHighlight(
  doc: Document,
  group: Element,
  target: SVGElement,
  irId: string,
  nodeRegistry: NodeGeometryRegistry,
): void {
  const geo = nodeRegistry.getById(irId)

  let x: number, y: number, w: number, h: number

  if (geo) {
    // Use pre-computed geometry — reliable, no DOM measurement needed
    x = geo.centerX - geo.halfWidth
    y = geo.centerY - geo.halfHeight
    w = geo.halfWidth * 2
    h = geo.halfHeight * 2
  } else {
    // Fallback for elements not in the registry (e.g., coordinate nodes)
    try {
      const bbox = (target as unknown as SVGGraphicsElement).getBBox?.()
      if (!bbox || bbox.width <= 0 || bbox.height <= 0) return
      x = bbox.x
      y = bbox.y
      w = bbox.width
      h = bbox.height
    } catch {
      return
    }
  }

  const pad = 4

  // Dashed amber bounding box
  const rect = doc.createElementNS(SVG_NS, 'rect')
  rect.setAttribute('x', String(x - pad))
  rect.setAttribute('y', String(y - pad))
  rect.setAttribute('width', String(w + pad * 2))
  rect.setAttribute('height', String(h + pad * 2))
  rect.setAttribute('rx', '2')
  rect.setAttribute('ry', '2')
  rect.setAttribute('fill', AMBER_FILL)
  rect.setAttribute('stroke', AMBER)
  rect.setAttribute('stroke-width', '1.5')
  rect.setAttribute('stroke-dasharray', '5 3')
  rect.setAttribute('pointer-events', 'none')
  group.appendChild(rect)

  // Anchor dots at cardinal + corner positions
  const cx = x + w / 2
  const cy = y + h / 2
  const anchors = [
    { x: cx,        y: y - pad },         // north
    { x: cx,        y: y + h + pad },     // south
    { x: x - pad,   y: cy },              // west
    { x: x + w + pad, y: cy },            // east
    { x: x - pad,   y: y - pad },         // north-west
    { x: x + w + pad, y: y - pad },       // north-east
    { x: x - pad,   y: y + h + pad },     // south-west
    { x: x + w + pad, y: y + h + pad },   // south-east
  ]

  const dotSize = 4
  for (const a of anchors) {
    const dot = doc.createElementNS(SVG_NS, 'rect')
    dot.setAttribute('x', String(a.x - dotSize / 2))
    dot.setAttribute('y', String(a.y - dotSize / 2))
    dot.setAttribute('width', String(dotSize))
    dot.setAttribute('height', String(dotSize))
    dot.setAttribute('fill', AMBER)
    dot.setAttribute('pointer-events', 'none')
    group.appendChild(dot)
  }
}

// ── Path / edge highlight ─────────────────────────────────────────────────────

/**
 * Draw an amber overlay for a path or edge element.
 * Duplicates the path's `d` attribute with amber stroke, and adds a dashed
 * bounding box via getBBox() (path elements are in the live DOM when highlighted).
 */
function addPathHighlight(doc: Document, group: Element, target: SVGElement): void {
  const pathEls: SVGElement[] = target.tagName.toLowerCase() === 'path'
    ? [target]
    : Array.from(target.querySelectorAll('path')) as SVGElement[]

  for (const pathEl of pathEls) {
    const d = pathEl.getAttribute('d')
    if (!d) continue

    // Amber path overlay — direct attributes, not CSS class
    const overlay = doc.createElementNS(SVG_NS, 'path')
    overlay.setAttribute('d', d)
    overlay.setAttribute('fill', 'none')
    overlay.setAttribute('stroke', AMBER)
    overlay.setAttribute('stroke-width', '2.5')
    overlay.setAttribute('pointer-events', 'none')
    const transform = pathEl.getAttribute('transform')
    if (transform) overlay.setAttribute('transform', transform)
    group.appendChild(overlay)
  }

  // Dashed bbox around the entire element via getBBox()
  // Path elements are in the live browser DOM at highlight time so this works.
  try {
    const bbox = (target as unknown as SVGGraphicsElement).getBBox?.()
    if (bbox && bbox.width > 0 && bbox.height > 0) {
      const pad = 3
      const rect = doc.createElementNS(SVG_NS, 'rect')
      rect.setAttribute('x', String(bbox.x - pad))
      rect.setAttribute('y', String(bbox.y - pad))
      rect.setAttribute('width', String(bbox.width + pad * 2))
      rect.setAttribute('height', String(bbox.height + pad * 2))
      rect.setAttribute('rx', '2')
      rect.setAttribute('ry', '2')
      rect.setAttribute('fill', 'rgba(245,158,11,0.06)')
      rect.setAttribute('stroke', AMBER)
      rect.setAttribute('stroke-width', '1')
      rect.setAttribute('stroke-dasharray', '4 3')
      rect.setAttribute('pointer-events', 'none')
      group.appendChild(rect)
    }
  } catch {
    // getBBox can throw in non-rendered contexts — skip the bbox rect
  }
}
