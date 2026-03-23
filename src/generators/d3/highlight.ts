/**
 * D3 highlight overlays — draws amber selection indicators on the SVG canvas.
 *
 * All visual properties are set as direct SVG attributes (not CSS classes) so
 * that the overlay is always visible regardless of CSS cascade or SVG defaults.
 *
 * For nodes: dashed bounding box from the NodeGeometryRegistry + anchor dots
 * For paths/edges: amber path overlay + dashed bbox via getBBox()
 * For bezier curves (path with curve segments): control point handles + handle lines
 */

import type { IRDiagram, IRPath, CoordRef } from '../../ir/types.js'
import { NodeGeometryRegistry, ptToPx } from '../core/coordResolver.js'
import { findElement } from './irMutator.js'

const SVG_NS = 'http://www.w3.org/2000/svg'
export const HIGHLIGHT_CLASS = 'd3-highlight-group'

const AMBER = '#f59e0b'
const AMBER_FILL = 'rgba(245,158,11,0.08)'

// ── Coord helper ─────────────────────────────────────────────────────────────

/** Resolve an absolute xy CoordRef to SVG pixel coords + original pt values. */
function resolveAbsXY(ref: CoordRef): { px: { x: number; y: number }; pt: { x: number; y: number } } | null {
  if (ref.mode !== 'absolute' || ref.coord.cs !== 'xy') return null
  return {
    px: { x: ptToPx(ref.coord.x), y: -ptToPx(ref.coord.y) },
    pt: { x: ref.coord.x, y: ref.coord.y },
  }
}

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
    addPathHighlight(doc, group, target, id, diagram)
  } else {
    // node, coordinate, matrix cell
    addNodeHighlight(doc, group, target, id, nodeRegistry)
  }

  // Render on top of everything
  svg.appendChild(group)
}

// ── Node highlight ────────────────────────────────────────────────────────────

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
    x = geo.centerX - geo.halfWidth
    y = geo.centerY - geo.halfHeight
    w = geo.halfWidth * 2
    h = geo.halfHeight * 2
  } else {
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

  const cx = x + w / 2
  const cy = y + h / 2
  const anchors = [
    { x: cx,          y: y - pad },
    { x: cx,          y: y + h + pad },
    { x: x - pad,     y: cy },
    { x: x + w + pad, y: cy },
    { x: x - pad,     y: y - pad },
    { x: x + w + pad, y: y - pad },
    { x: x - pad,     y: y + h + pad },
    { x: x + w + pad, y: y + h + pad },
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

function addPathHighlight(
  doc: Document,
  group: Element,
  target: SVGElement,
  irId: string,
  diagram: IRDiagram | null,
): void {
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

  // Dashed bbox around the element
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
    // getBBox can throw in non-rendered contexts
  }

  // Control point handles for editable bezier curve segments
  if (diagram) {
    const el = findElement(diagram.elements, irId)
    if (el && el.kind === 'path') {
      addControlPointHandles(doc, group, el)
    }
  }
}

// ── Bezier control point handles ──────────────────────────────────────────────

/**
 * Draw draggable control point handles for each CurveSegment in the path.
 * Only handles absolute xy coords (cs === 'xy', mode === 'absolute').
 *
 * Visual elements per curve segment:
 *   - Thin dashed handle lines (prevPos → cp1, to → cp2)
 *   - Filled amber circles at cp1 / cp2 (draggable, tagged with data attrs)
 *   - White square at endpoint (to) — non-draggable visual marker
 */
function addControlPointHandles(doc: Document, group: Element, irPath: IRPath): void {
  let prevPx: { x: number; y: number } | null = null

  for (let segIdx = 0; segIdx < irPath.segments.length; segIdx++) {
    const seg = irPath.segments[segIdx]

    if (seg.kind === 'curve') {
      const cp1 = resolveAbsXY(seg.controls[0])
      const cp2ref = seg.controls.length >= 2 ? seg.controls[1] : undefined
      const cp2 = cp2ref ? resolveAbsXY(cp2ref) : null
      const to = resolveAbsXY(seg.to)

      // Handle lines (non-interactive, purely visual)
      if (prevPx && cp1) {
        addHandleLine(doc, group, prevPx.x, prevPx.y, cp1.px.x, cp1.px.y, `d3hl-${segIdx}-cp1`)
      }
      if (to && cp2) {
        addHandleLine(doc, group, to.px.x, to.px.y, cp2.px.x, cp2.px.y, `d3hl-${segIdx}-cp2`)
      }

      // Control point circles (draggable)
      if (cp1) {
        addCPHandle(doc, group, cp1.px.x, cp1.px.y, irPath.id, segIdx, 'cp1', cp1.pt.x, cp1.pt.y, `d3hl-${segIdx}-cp1`)
      }
      if (cp2) {
        addCPHandle(doc, group, cp2.px.x, cp2.px.y, irPath.id, segIdx, 'cp2', cp2.pt.x, cp2.pt.y, `d3hl-${segIdx}-cp2`)
      }

      // Endpoint marker (non-draggable square)
      if (to) {
        addEndpointMarker(doc, group, to.px.x, to.px.y)
      }

      prevPx = to?.px ?? null
    } else if ('to' in seg) {
      // Track current position for handle line start of the next curve segment
      const toRef = (seg as { to: CoordRef }).to
      const resolved = resolveAbsXY(toRef)
      prevPx = resolved?.px ?? null
    }
    // 'close', 'node-on-path', 'circle', 'ellipse': don't update prevPx
  }
}

function addHandleLine(
  doc: Document,
  group: Element,
  x1: number, y1: number,
  x2: number, y2: number,
  id: string,
): void {
  const line = doc.createElementNS(SVG_NS, 'line')
  line.setAttribute('id', id)
  line.setAttribute('x1', String(x1))
  line.setAttribute('y1', String(y1))
  line.setAttribute('x2', String(x2))
  line.setAttribute('y2', String(y2))
  line.setAttribute('stroke', AMBER)
  line.setAttribute('stroke-width', '0.8')
  line.setAttribute('stroke-dasharray', '3 2')
  line.setAttribute('pointer-events', 'none')
  group.appendChild(line)
}

function addCPHandle(
  doc: Document,
  group: Element,
  cx: number, cy: number,
  pathId: string,
  segIdx: number,
  cpRole: string,
  origPtX: number,
  origPtY: number,
  handleLineId: string,
): void {
  const circle = doc.createElementNS(SVG_NS, 'circle')
  circle.setAttribute('cx', String(cx))
  circle.setAttribute('cy', String(cy))
  circle.setAttribute('r', '5')
  circle.setAttribute('fill', AMBER)
  circle.setAttribute('stroke', '#fff')
  circle.setAttribute('stroke-width', '1.5')
  circle.setAttribute('cursor', 'grab')
  // Data attrs for drag handler
  circle.setAttribute('data-d3-role', 'cp-handle')
  circle.setAttribute('data-ir-path-id', pathId)
  circle.setAttribute('data-seg-idx', String(segIdx))
  circle.setAttribute('data-cp-role', cpRole)
  circle.setAttribute('data-orig-pt-x', String(origPtX))
  circle.setAttribute('data-orig-pt-y', String(origPtY))
  circle.setAttribute('data-handle-line-id', handleLineId)
  group.appendChild(circle)
}

function addEndpointMarker(doc: Document, group: Element, cx: number, cy: number): void {
  const size = 5
  const dot = doc.createElementNS(SVG_NS, 'rect')
  dot.setAttribute('x', String(cx - size / 2))
  dot.setAttribute('y', String(cy - size / 2))
  dot.setAttribute('width', String(size))
  dot.setAttribute('height', String(size))
  dot.setAttribute('fill', '#fff')
  dot.setAttribute('stroke', AMBER)
  dot.setAttribute('stroke-width', '1.5')
  dot.setAttribute('pointer-events', 'none')
  group.appendChild(dot)
}
