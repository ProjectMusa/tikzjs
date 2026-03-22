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
import { MathRenderer, defaultMathRenderer, scriptMathModeRenderer } from '../../math/index.js'
import { AbsoluteCoordinate } from './boundingBox.js'
import { TIKZ_CONSTANTS, DEFAULT_CONSTANTS, SVGRenderingConstants } from './constants.js'

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
  mathRenderer: MathRenderer = defaultMathRenderer,
  constants: SVGRenderingConstants = DEFAULT_CONSTANTS
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
  const { d, midpoint, bbox } = buildEdgePath(fromGeo, toGeo, fromAnchor, toAnchor, edge.routing, constants)
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

    // Markers — resolve 'default' tip using arrowDefault if set
    const resolveDefaultTip = (tip: import('../../ir/types.js').ArrowTipSpec) =>
      tip.kind === 'default' && edge.style.arrowDefault
        ? { ...tip, kind: edge.style.arrowDefault }
        : tip
    const edgeLwPt = edge.style.drawWidth ?? TIKZ_CONSTANTS.DEFAULT_LINE_WIDTH_PT
    if (edge.style.arrowEnd) {
      const mid = ensureMarker(resolveDefaultTip(edge.style.arrowEnd), markerRegistry, color, edgeLwPt)
      pathEl.setAttribute('marker-end', `url(#${mid})`)
    }
    if (edge.style.arrowStart) {
      const mid = ensureMarker(resolveDefaultTip(edge.style.arrowStart), markerRegistry, color, edgeLwPt)
      pathEl.setAttribute('marker-start', `url(#${mid})`)
    }

    elements.push(pathEl)
  }

  // tikzcd arrow labels use \scriptstyle (0.7× scale); plain edges use the passed renderer
  const labelRenderer = (edge as IRTikzcdArrow).tikzcdKind ? scriptMathModeRenderer : mathRenderer

  // Render labels
  for (const label of edge.labels) {
    const result = emitEdgeLabel(label, midpoint, fromCenter, toCenter, document, labelRenderer, constants)
    if (result) {
      elements.push(result.el)
      bboxes.push(result.bbox)
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
  routing: EdgeRouting,
  constants: SVGRenderingConstants
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
      const rawAngle = routing.angle
      const angle = Math.abs(rawAngle)
      // In TikZ, bend right=-X is equivalent to bend left=X (negative angle flips direction)
      const baseDir = routing.direction === 'left' ? 1 : -1
      const dir = rawAngle < 0 ? -baseDir : baseDir
      // Use TikZ's actual cubic bezier formula: control points at distance 0.3915*len
      // placed at the rotated chord direction (not a quadratic approximation).
      // First compute approx control points from unclipped centers for tangent-clipping.
      const { c1: c1Approx, c2: c2Approx } = computeCubicBendControls(from, to, angle, dir)
      const fromClippedBend = clipToNodeBoundary(c1Approx, from, fromGeo)
      const toClippedBend   = clipToNodeBoundary(c2Approx, to, toGeo)
      const { c1, c2 } = computeCubicBendControls(fromClippedBend, toClippedBend, angle, dir)
      const { x: x0, y: y0 } = fromClippedBend
      const { x: x2, y: y2 } = toClippedBend
      // Midpoint of cubic bezier at t=0.5: (P0 + 3*C1 + 3*C2 + P3) / 8
      const midX = (x0 + 3 * c1.x + 3 * c2.x + x2) / 8
      const midY = (y0 + 3 * c1.y + 3 * c2.y + y2) / 8
      return {
        d: `M ${x0} ${y0} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${x2} ${y2}`,
        midpoint: { x: midX, y: midY },
        bbox: fromCorners(
          Math.min(x0, c1.x, c2.x, x2), Math.min(y0, c1.y, c2.y, y2),
          Math.max(x0, c1.x, c2.x, x2), Math.max(y0, c1.y, c2.y, y2)
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
      const dist = Math.sqrt((to.x - from.x) ** 2 + (to.y - from.y) ** 2) * constants.EDGE_INOUT_DISTANCE_FACTOR
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

/**
 * Compute TikZ-accurate cubic bezier control points for a bend edge.
 *
 * TikZ places c1 and c2 at distance d = 0.3915 * len (looseness=1) from P0 and P3
 * respectively, rotated by ±angle from the chord direction.
 *
 * In SVG y-down coords (where "left" = CW rotation = dir=1):
 *   c1 = P0 + d * ( ux*cos(X) + dir*uy*sin(X),  uy*cos(X) - dir*ux*sin(X) )
 *   c2 = P3 + d * (-ux*cos(X) + dir*uy*sin(X), -uy*cos(X) - dir*ux*sin(X) )
 */
function computeCubicBendControls(
  from: AbsoluteCoordinate,
  to: AbsoluteCoordinate,
  angle: number,
  dir: number
): { c1: AbsoluteCoordinate; c2: AbsoluteCoordinate } {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const len = Math.sqrt(dx * dx + dy * dy)
  if (len < 1e-9) return { c1: { x: from.x, y: from.y }, c2: { x: to.x, y: to.y } }
  const ux = dx / len
  const uy = dy / len
  const d = TIKZ_CONSTANTS.TO_PATH_LOOSENESS * len
  const rad = (angle * Math.PI) / 180
  const cosA = Math.cos(rad)
  const sinA = Math.sin(rad)
  return {
    c1: {
      x: from.x + d * (ux * cosA + dir * uy * sinA),
      y: from.y + d * (uy * cosA - dir * ux * sinA),
    },
    c2: {
      x: to.x + d * (-ux * cosA + dir * uy * sinA),
      y: to.y + d * (-uy * cosA - dir * ux * sinA),
    },
  }
}

function buildLoopPath(
  geo: import('./coordResolver.js').NodeGeometry,
  direction: 'left' | 'right' | 'above' | 'below' | number
): { d: string; midpoint: AbsoluteCoordinate } {
  const { centerX, centerY, halfWidth, halfHeight } = geo
  const DEG = Math.PI / 180

  // TikZ loop defaults: looseness=8, min distance=5mm (≈14.17pt)
  // loop above: out=105, in=75   loop below: out=285, in=255
  // loop left:  out=195, in=165  loop right: out=15,  in=-15
  let outAngle: number, inAngle: number
  if (direction === 'above')      { outAngle = 105; inAngle = 75 }
  else if (direction === 'below') { outAngle = 285; inAngle = 255 }
  else if (direction === 'left')  { outAngle = 195; inAngle = 165 }
  else if (direction === 'right') { outAngle = 15;  inAngle = -15 }
  else {
    // Numeric angle: spread ±15° around direction
    outAngle = Number(direction) + 15
    inAngle  = Number(direction) - 15
  }

  // Border intersection point at a given TikZ angle
  const borderPoint = (tikzAngle: number) => {
    const rad = tikzAngle * DEG
    const cos = Math.cos(rad), sin = Math.sin(rad)
    // Ellipse border: scale unit direction to reach border
    const r = (halfWidth * halfHeight) /
      Math.sqrt((sin * halfWidth) ** 2 + (cos * halfHeight) ** 2 + 1e-9)
    return {
      x: centerX + r * cos,
      y: centerY - r * sin, // SVG y-down
    }
  }

  const start = borderPoint(outAngle)
  const end   = borderPoint(inAngle)

  // Distance between start and end points
  const dx = end.x - start.x, dy = end.y - start.y
  const dist = Math.sqrt(dx * dx + dy * dy)

  // TikZ to-path formula: arm = max(0.3915 × distance × looseness, minDistance)
  // For loops: looseness=8, min distance=5mm (14.17pt)
  const looseness = 8
  const minDistPx = ptToPx(5 * TIKZ_CONSTANTS.PT_PER_CM / 10) // 5mm
  const d = Math.max(TIKZ_CONSTANTS.TO_PATH_LOOSENESS * dist * looseness, minDistPx)

  // Control points extend from start/end in the out/in directions
  // TikZ places control points at shift=(angle:distance) from the endpoint
  const c1x = start.x + d * Math.cos(outAngle * DEG)
  const c1y = start.y - d * Math.sin(outAngle * DEG) // SVG y-down
  const c2x = end.x + d * Math.cos(inAngle * DEG)
  const c2y = end.y - d * Math.sin(inAngle * DEG)

  // Midpoint: apex of the loop (average of control points)
  const midX = (c1x + c2x) / 2
  const midY = (c1y + c2y) / 2

  return {
    d: `M ${start.x} ${start.y} C ${c1x} ${c1y} ${c2x} ${c2y} ${end.x} ${end.y}`,
    midpoint: { x: midX, y: midY },
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
  mathRenderer: MathRenderer,
  constants: SVGRenderingConstants = DEFAULT_CONSTANTS
): { el: Element; bbox: BoundingBox } | null {
  if (!label.text.trim()) return null

  try {
    const { svgString, widthPx, heightPx } = mathRenderer(label.text)
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g')

    const GAP_PX = constants.EDGE_LABEL_GAP_PX
    let cx: number
    let cy: number

    if (label.description) {
      // `description` style: label sits at the midpoint of the arrow, centered, with white background.
      cx = midpoint.x
      cy = midpoint.y
    } else if (label.placement) {
      // Absolute placement: above/below/left/right in TikZ/SVG coordinates.
      // "above" in TikZ = up = negative SVG y.
      switch (label.placement) {
        case 'above':
          cx = midpoint.x
          cy = midpoint.y - heightPx / 2 - GAP_PX
          break
        case 'below':
          cx = midpoint.x
          cy = midpoint.y + heightPx / 2 + GAP_PX
          break
        case 'left':
          cx = midpoint.x - widthPx / 2 - GAP_PX
          cy = midpoint.y
          break
        case 'right':
          cx = midpoint.x + widthPx / 2 + GAP_PX
          cy = midpoint.y
          break
      }
    } else {
      // Perpendicular placement relative to arrow direction (tikzcd-style).
      // Compute unit arrow direction vector in SVG coords (y-down)
      const adx = to.x - from.x
      const ady = to.y - from.y
      const len = Math.sqrt(adx * adx + ady * ady)
      const ux = len > 1e-9 ? adx / len : 1
      const uy = len > 1e-9 ? ady / len : 0

      // CW rotation in SVG y-down = "auto/above" for rightward arrow
      // auto (no swap) = (uy, -ux);  swap (prime) = (-uy, ux)
      const sign = label.swap ? -1 : 1
      const px = sign * uy
      const py = sign * (-ux)

      // Offset magnitude: half the label extent in the perp direction + gap
      const halfExtent = (Math.abs(px) * widthPx + Math.abs(py) * heightPx) / 2
      const offset = halfExtent + GAP_PX

      cx = midpoint.x + px * offset
      cy = midpoint.y + py * offset
    }

    const tlx = cx - widthPx / 2
    const tly = cy - heightPx / 2

    g.setAttribute('transform', `translate(${tlx},${tly})`)

    if (label.description) {
      // White background rectangle in g's local coordinate space (origin = top-left of label)
      const PAD = constants.EDGE_LABEL_DESCRIPTION_PAD_PX
      const rectSvg = `<rect x="${-PAD}" y="${-PAD}" width="${widthPx + 2 * PAD}" height="${heightPx + 2 * PAD}" fill="#fff"/>`
      g.innerHTML = rectSvg + svgString
    } else {
      g.innerHTML = svgString
    }

    return { el: g, bbox: fromCorners(tlx, tly, tlx + widthPx, tly + heightPx) }
  } catch {
    return null
  }
}
