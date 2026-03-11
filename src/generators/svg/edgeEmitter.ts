/**
 * Edge emitter: renders IREdge and IRTikzcdArrow elements to SVG paths.
 *
 * Edges are semantic (from-node to-node) and are distinct from IRPath
 * (geometric). This separation enables graph manipulation.
 */

import { IREdge, IRTikzcdArrow, EdgeRouting, EdgeLabel, ResolvedStyle } from '../../ir/types.js'
import { CoordResolver, NodeGeometryRegistry, getAnchorPosition, clipToNodeBoundary, ptToPx } from './coordResolver.js'
import { BoundingBox, fromCorners, mergeBBoxes } from './boundingBox.js'
import { buildPathAttrs, applyAttrs, buildTransform } from './styleEmitter.js'
import { ensureMarker, MarkerRegistry } from './markerDefs.js'
import { MathRenderer, defaultMathRenderer, mathModeRenderer } from '../../math/index.js'
import { AbsoluteCoordinate } from './boundingBox.js'

export interface EdgeRenderResult {
  elements: Element[]
  bbox: BoundingBox
}

/**
 * Render an IREdge (or IRTikzcdArrow) to SVG elements.
 */
export function emitEdge(
  edge: IREdge,
  document: Document,
  nodeRegistry: NodeGeometryRegistry,
  markerRegistry: MarkerRegistry,
  mathRenderer: MathRenderer = defaultMathRenderer
): EdgeRenderResult {
  const elements: Element[] = []
  const bboxes: BoundingBox[] = []

  const fromGeo = nodeRegistry.getById(edge.from)
  const toGeo   = nodeRegistry.getById(edge.to)

  if (!fromGeo || !toGeo) {
    // Can't render edge if nodes not yet resolved
    return { elements: [], bbox: fromCorners(0, 0, 0, 0) }
  }

  // Determine connection points
  const fromAnchor = edge.fromAnchor ?? 'center'
  const toAnchor   = edge.toAnchor   ?? 'center'
  const fromCenter = getAnchorPosition(fromGeo, 'center')
  const toCenter   = getAnchorPosition(toGeo, 'center')

  // Build the path geometry
  const { d, midpoint, bbox } = buildEdgePath(fromGeo, toGeo, fromAnchor, toAnchor, edge.routing)
  bboxes.push(bbox)

  if (d) {
    const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    pathEl.setAttribute('d', d)
    pathEl.setAttribute('fill', 'none')

    // Apply stroke style
    const color = edge.style.draw ?? '#000000'
    pathEl.setAttribute('stroke', color)
    pathEl.setAttribute('stroke-width', String(
      edge.style.drawWidth !== undefined ? ptToPx(edge.style.drawWidth) : 0.8
    ))

    if (edge.style.drawDash) {
      const dashMap: Record<string, string> = {
        'dashed': '6,3', 'dotted': '1.5,2', 'densely dashed': '4,2', 'loosely dashed': '10,5'
      }
      pathEl.setAttribute('stroke-dasharray', dashMap[edge.style.drawDash] ?? edge.style.drawDash)
    }

    // Markers
    if (edge.style.arrowEnd) {
      const mid = ensureMarker(edge.style.arrowEnd, markerRegistry, color)
      pathEl.setAttribute('marker-end', `url(#${mid})`)
    }
    if (edge.style.arrowStart) {
      const mid = ensureMarker(edge.style.arrowStart, markerRegistry, color)
      pathEl.setAttribute('marker-start', `url(#${mid})`)
    }

    elements.push(pathEl)
  }

  // tikzcd labels are always math (italic); plain edges use the passed renderer
  const labelRenderer = (edge as IRTikzcdArrow).tikzcdKind ? mathModeRenderer : mathRenderer

  // Render labels
  for (const label of edge.labels) {
    const labelEl = emitEdgeLabel(label, midpoint, fromCenter, toCenter, document, labelRenderer)
    if (labelEl) {
      elements.push(labelEl)
    }
  }

  return { elements, bbox: mergeBBoxes(bboxes) }
}

/** Build the SVG path 'd' attribute for an edge. */
function buildEdgePath(
  fromGeo: import('./coordResolver.js').NodeGeometry,
  toGeo: import('./coordResolver.js').NodeGeometry,
  fromAnchor: string,
  toAnchor: string,
  routing: EdgeRouting
): { d: string; midpoint: AbsoluteCoordinate; bbox: BoundingBox } {
  const from = getAnchorPosition(fromGeo, fromAnchor === 'center' ? 'center' : fromAnchor)
  const to   = getAnchorPosition(toGeo,   toAnchor   === 'center' ? 'center' : toAnchor)

  // Clip to node boundaries
  const fromClipped = clipToNodeBoundary(to, from, fromGeo)
  const toClipped   = clipToNodeBoundary(from, to, toGeo)

  switch (routing.kind) {
    case 'straight': {
      const midX = (fromClipped.x + toClipped.x) / 2
      const midY = (fromClipped.y + toClipped.y) / 2
      return {
        d: `M ${fromClipped.x} ${fromClipped.y} L ${toClipped.x} ${toClipped.y}`,
        midpoint: { x: midX, y: midY },
        bbox: fromCorners(fromClipped.x, fromClipped.y, toClipped.x, toClipped.y),
      }
    }

    case 'bend': {
      const angle = routing.angle
      const dir = routing.direction === 'left' ? 1 : -1
      const { cx, cy } = computeBendControl(fromClipped, toClipped, angle, dir)
      const midX = 0.5 * (fromClipped.x + 2 * cx + toClipped.x) / 2
      const midY = 0.5 * (fromClipped.y + 2 * cy + toClipped.y) / 2
      return {
        d: `M ${fromClipped.x} ${fromClipped.y} Q ${cx} ${cy} ${toClipped.x} ${toClipped.y}`,
        midpoint: { x: midX, y: midY },
        bbox: fromCorners(
          Math.min(fromClipped.x, cx, toClipped.x), Math.min(fromClipped.y, cy, toClipped.y),
          Math.max(fromClipped.x, cx, toClipped.x), Math.max(fromClipped.y, cy, toClipped.y)
        ),
      }
    }

    case 'loop': {
      const dir = routing.direction
      const { d: loopD, midpoint: loopMid } = buildLoopPath(fromGeo, dir)
      return {
        d: loopD,
        midpoint: loopMid,
        bbox: fromCorners(fromGeo.centerX - fromGeo.halfWidth * 3, fromGeo.centerY - fromGeo.halfHeight * 3,
                          fromGeo.centerX + fromGeo.halfWidth * 3, fromGeo.centerY + fromGeo.halfHeight * 3),
      }
    }

    case 'in-out': {
      const { inAngle, outAngle } = routing
      const outRad = (outAngle * Math.PI) / 180
      const inRad = (inAngle * Math.PI) / 180
      const dist = Math.sqrt((to.x - from.x) ** 2 + (to.y - from.y) ** 2) * 0.4
      const c1x = fromClipped.x + dist * Math.cos(outRad)
      const c1y = fromClipped.y - dist * Math.sin(outRad)
      const c2x = toClipped.x + dist * Math.cos(inRad + Math.PI)
      const c2y = toClipped.y - dist * Math.sin(inRad + Math.PI)
      return {
        d: `M ${fromClipped.x} ${fromClipped.y} C ${c1x} ${c1y} ${c2x} ${c2y} ${toClipped.x} ${toClipped.y}`,
        midpoint: { x: (fromClipped.x + toClipped.x) / 2, y: (fromClipped.y + toClipped.y) / 2 },
        bbox: fromCorners(
          Math.min(fromClipped.x, c1x, c2x, toClipped.x),
          Math.min(fromClipped.y, c1y, c2y, toClipped.y),
          Math.max(fromClipped.x, c1x, c2x, toClipped.x),
          Math.max(fromClipped.y, c1y, c2y, toClipped.y)
        ),
      }
    }
  }
}

function computeBendControl(
  from: AbsoluteCoordinate,
  to: AbsoluteCoordinate,
  angle: number,
  dir: number
): { cx: number; cy: number } {
  const mx = (from.x + to.x) / 2
  const my = (from.y + to.y) / 2
  const dx = to.x - from.x
  const dy = to.y - from.y
  const len = Math.sqrt(dx * dx + dy * dy)
  if (len < 1e-9) return { cx: mx, cy: my }
  const perpX = -dy / len
  const perpY = dx / len
  const d = (len / 2) * Math.tan((angle * Math.PI) / 180)
  return { cx: mx + dir * perpX * d, cy: my + dir * perpY * d }
}

function buildLoopPath(
  geo: import('./coordResolver.js').NodeGeometry,
  direction: 'left' | 'right' | 'above' | 'below' | number
): { d: string; midpoint: AbsoluteCoordinate } {
  const { centerX, centerY, halfWidth, halfHeight } = geo
  const loopSize = Math.max(halfWidth, halfHeight) * 2

  let dx = 0, dy = 0
  if (direction === 'above') dy = -1
  else if (direction === 'below') dy = 1
  else if (direction === 'left') dx = -1
  else if (direction === 'right') dx = 1
  else {
    const rad = (Number(direction) * Math.PI) / 180
    dx = Math.cos(rad); dy = -Math.sin(rad)
  }

  // Control points for the loop
  const startX = centerX + dy * halfWidth - dx * halfHeight
  const startY = centerY - dx * halfHeight + dy * halfWidth
  const endX   = centerX - dy * halfWidth - dx * halfHeight
  const endY   = centerY + dx * halfHeight + dy * halfWidth
  const c1x = startX + dx * loopSize + dy * loopSize * 0.5
  const c1y = startY + dy * loopSize - dx * loopSize * 0.5
  const c2x = endX   + dx * loopSize - dy * loopSize * 0.5
  const c2y = endY   + dy * loopSize + dx * loopSize * 0.5

  return {
    d: `M ${startX} ${startY} C ${c1x} ${c1y} ${c2x} ${c2y} ${endX} ${endY}`,
    midpoint: {
      x: centerX + dx * loopSize,
      y: centerY + dy * loopSize,
    },
  }
}

/** Render an edge label as a <g> element.
 *
 * Placement rule (tikzcd / TikZ `auto`):
 *   No swap (no prime): label on the LEFT of the arrow direction (in TikZ y-up) =
 *     CW-rotated perpendicular in SVG y-down: perp = (dy, -dx).
 *   Swap (prime): label on the RIGHT = opposite perp: (-dy, dx).
 *
 * The label center is placed at midpoint + perpendicular_offset,
 * where the offset magnitude is half the label's bounding box extent in the
 * perpendicular direction plus a small gap.
 */
function emitEdgeLabel(
  label: EdgeLabel,
  midpoint: AbsoluteCoordinate,
  from: AbsoluteCoordinate,
  to: AbsoluteCoordinate,
  document: Document,
  mathRenderer: MathRenderer
): Element | null {
  if (!label.text.trim()) return null

  try {
    const { svgString, widthPx, heightPx } = mathRenderer(label.text)
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g')

    // Compute unit arrow direction vector in SVG coords (y-down)
    const adx = to.x - from.x
    const ady = to.y - from.y
    const len = Math.sqrt(adx * adx + ady * ady)
    const ux = len > 1e-9 ? adx / len : 1
    const uy = len > 1e-9 ? ady / len : 0

    // Perpendicular: CW rotation in SVG y-down = "auto/above" for rightward arrow
    // auto (no swap) = (uy, -ux);  swap (prime) = (-uy, ux)
    const sign = label.swap ? -1 : 1
    const px = sign * uy
    const py = sign * (-ux)

    // Offset magnitude: half the label extent in the perp direction + gap
    const GAP_PX = 4
    const halfExtent = (Math.abs(px) * widthPx + Math.abs(py) * heightPx) / 2
    const offset = halfExtent + GAP_PX

    // Label center
    const cx = midpoint.x + px * offset
    const cy = midpoint.y + py * offset

    g.setAttribute('transform', `translate(${cx - widthPx / 2},${cy - heightPx / 2})`)
    g.innerHTML = svgString
    return g
  } catch {
    return null
  }
}
