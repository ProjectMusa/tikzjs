/**
 * Path emitter: converts IRPath segments to SVG <path> elements.
 *
 * Bezier curve geometry uses bezier-js (migrated from TikzSubPathCurveToElement).
 * Line clipping to node boundaries uses coordResolver.clipToNodeBoundary().
 */

import { IRPath, IRNode, PathSegment, CoordRef, ResolvedStyle } from '../../ir/types.js'
import { CoordResolver, NodeGeometryRegistry, clipToNodeBoundary, ptToPx } from './coordResolver.js'
import { TIKZ_CONSTANTS } from './constants.js'
import { BoundingBox, emptyBBox, expandPoint, mergeBBoxes, fromCorners, transformBBox } from './boundingBox.js'
import { buildPathAttrs, applyAttrs, buildTransform } from './styleEmitter.js'
import { parseDimensionPt } from '../../parser/optionParser.js'
import { ensureMarker, MarkerRegistry } from './markerDefs.js'
import { AbsoluteCoordinate } from './boundingBox.js'

// bezier-js for curve bounding box calculation
const Bezier = (() => {
  try {
    return require('bezier-js')
  } catch {
    return null
  }
})()

export interface PathRenderResult {
  elements: Element[]
  bbox: BoundingBox
}

/**
 * Render an IRPath to SVG elements.
 */
export function emitPath(
  path: IRPath,
  document: Document,
  resolver: CoordResolver,
  nodeRegistry: NodeGeometryRegistry,
  markerRegistry: MarkerRegistry
): PathRenderResult {
  const elements: Element[] = []
  const bboxes: BoundingBox[] = []
  // Bboxes already in world space (circle/ellipse) — not passed through transformBBox
  const worldBboxes: BoundingBox[] = []

  // Track start-of-subpath position for close-path
  let subpathStart: AbsoluteCoordinate = { x: 0, y: 0 }

  // Build the SVG path d attribute
  let d = ''
  let lastPos: AbsoluteCoordinate = { x: 0, y: 0 }
  let lastCoordRef: CoordRef | null = null  // track last coord to enable from-side node clipping
  // Pending move: defer emitting M until first drawing segment so from-clipping can adjust it
  let pendingMove: AbsoluteCoordinate | null = null
  let hasStroke = path.style.draw !== undefined && path.style.draw !== 'none'
  let hasFill = path.style.fill !== undefined && path.style.fill !== 'none'

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const segs = path.segments as any[]

  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i]

    switch (seg.kind) {
      case 'move': {
        const pos = resolver.resolve(seg.to)
        pendingMove = pos  // defer M emission
        lastPos = pos
        lastCoordRef = seg.to
        subpathStart = pos
        bboxes.push(fromCorners(pos.x, pos.y, pos.x, pos.y))
        break
      }

      case 'line': {
        let to = resolver.resolve(seg.to)
        // Clip to-side if destination is a node
        const toGeo = getNodeGeoForCoord(seg.to, nodeRegistry)
        if (toGeo) {
          to = clipToNodeBoundary(lastPos, to, toGeo)
        }
        // Clip from-side if last coord was a node (adjusts the pending move if applicable)
        const fromGeo = lastCoordRef ? getNodeGeoForCoord(lastCoordRef, nodeRegistry) : null
        let from = lastPos
        if (fromGeo) {
          from = clipToNodeBoundary(to, lastPos, fromGeo)
        }
        // Emit M for the (possibly clipped) start position
        if (pendingMove) {
          d += `M ${from.x} ${from.y} `
          pendingMove = null
        } else if (from.x !== lastPos.x || from.y !== lastPos.y) {
          d += `M ${from.x} ${from.y} `
        }
        d += `L ${to.x} ${to.y} `
        lastPos = to
        lastCoordRef = seg.to
        bboxes.push(fromCorners(from.x, from.y, to.x, to.y))
        break
      }

      case 'hv-line': {
        if (pendingMove) { d += `M ${pendingMove.x} ${pendingMove.y} `; pendingMove = null }
        const to = resolver.resolve(seg.to)
        if (seg.hvFirst) {
          // horizontal then vertical: -|
          d += `L ${to.x} ${lastPos.y} L ${to.x} ${to.y} `
          bboxes.push(fromCorners(lastPos.x, lastPos.y, to.x, to.y))
        } else {
          // vertical then horizontal: |-
          d += `L ${lastPos.x} ${to.y} L ${to.x} ${to.y} `
          bboxes.push(fromCorners(lastPos.x, lastPos.y, to.x, to.y))
        }
        lastPos = to
        break
      }

      case 'curve': {
        if (pendingMove) { d += `M ${pendingMove.x} ${pendingMove.y} `; pendingMove = null }
        const to = resolver.resolve(seg.to)
        if (seg.controls.length === 1) {
          // TikZ `.. controls (c) ..` is cubic Bezier with both control points at c
          const c = resolver.resolve(seg.controls[0])
          d += `C ${c.x} ${c.y} ${c.x} ${c.y} ${to.x} ${to.y} `
          if (Bezier) {
            const curve = new Bezier.Bezier(lastPos.x, lastPos.y, c.x, c.y, c.x, c.y, to.x, to.y)
            const bb = curve.bbox()
            bboxes.push(fromCorners(bb.x.min, bb.y.min, bb.x.max, bb.y.max))
          } else {
            bboxes.push(fromCorners(
              Math.min(lastPos.x, c.x, to.x), Math.min(lastPos.y, c.y, to.y),
              Math.max(lastPos.x, c.x, to.x), Math.max(lastPos.y, c.y, to.y)
            ))
          }
        } else {
          const c0 = resolver.resolve(seg.controls[0])
          const c1 = resolver.resolve(seg.controls[1])
          d += `C ${c0.x} ${c0.y} ${c1.x} ${c1.y} ${to.x} ${to.y} `
          if (Bezier) {
            const curve = new Bezier.Bezier(lastPos.x, lastPos.y, c0.x, c0.y, c1.x, c1.y, to.x, to.y)
            const bb = curve.bbox()
            bboxes.push(fromCorners(bb.x.min, bb.y.min, bb.x.max, bb.y.max))
          } else {
            bboxes.push(fromCorners(
              Math.min(lastPos.x, c0.x, c1.x, to.x),
              Math.min(lastPos.y, c0.y, c1.y, to.y),
              Math.max(lastPos.x, c0.x, c1.x, to.x),
              Math.max(lastPos.y, c0.y, c1.y, to.y)
            ))
          }
        }
        lastPos = to
        break
      }

      case 'arc': {
        if (pendingMove) { d += `M ${pendingMove.x} ${pendingMove.y} `; pendingMove = null }
        // SVG arc command: A rx ry x-rotation large-arc-flag sweep-flag x y
        const { startAngle, endAngle, xRadius, yRadius } = seg
        const rx = ptToPx(xRadius * resolver.coordScale)
        const ry = yRadius !== undefined ? ptToPx(yRadius * resolver.coordScale) : rx
        const startRad = (startAngle * Math.PI) / 180
        const endRad = (endAngle * Math.PI) / 180
        const startX = lastPos.x
        const startY = lastPos.y
        // In SVG coords, y is inverted
        const endX = startX + rx * (Math.cos(endRad) - Math.cos(startRad))
        const endY = startY - ry * (Math.sin(endRad) - Math.sin(startRad))
        // TikZ angles increase CCW (y-up). The y-flip to SVG reverses rotation direction,
        // so TikZ CCW (endAngle > startAngle) maps to SVG sweep=0 (CCW in y-down).
        const sweep = endAngle > startAngle ? 0 : 1
        const largeArc = Math.abs(endAngle - startAngle) > 180 ? 1 : 0
        d += `A ${rx} ${ry} 0 ${largeArc} ${sweep} ${endX} ${endY} `
        lastPos = { x: endX, y: endY }
        // Correct arc bbox: arc center + check axis-aligned extremes within arc range
        const arcCx = startX - rx * Math.cos(startRad)
        const arcCy = startY + ry * Math.sin(startRad)
        let bMinX = Math.min(startX, endX), bMaxX = Math.max(startX, endX)
        let bMinY = Math.min(startY, endY), bMaxY = Math.max(startY, endY)
        // Check 4 axis-aligned extremes (0°, 90°, 180°, 270°)
        for (const θdeg of [0, 90, 180, 270]) {
          const inArc = endAngle < startAngle
            ? ((((θdeg - endAngle) % 360) + 360) % 360) <= ((((startAngle - endAngle) % 360) + 360) % 360)
            : ((((θdeg - startAngle) % 360) + 360) % 360) <= ((((endAngle - startAngle) % 360) + 360) % 360)
          if (inArc) {
            const θrad = (θdeg * Math.PI) / 180
            const px = arcCx + rx * Math.cos(θrad)
            const py = arcCy - ry * Math.sin(θrad)  // SVG y-down
            bMinX = Math.min(bMinX, px); bMaxX = Math.max(bMaxX, px)
            bMinY = Math.min(bMinY, py); bMaxY = Math.max(bMaxY, py)
          }
        }
        bboxes.push(fromCorners(bMinX, bMinY, bMaxX, bMaxY))
        break
      }

      case 'to': {
        let to = resolver.resolve(seg.to)
        // Clip to-side if destination is a node
        const toGeo = getNodeGeoForCoord(seg.to, nodeRegistry)
        if (toGeo) {
          to = clipToNodeBoundary(lastPos, to, toGeo)
        }
        // Clip from-side if last coord was a node (adjusts the pending move if applicable)
        const fromGeoTo = lastCoordRef ? getNodeGeoForCoord(lastCoordRef, nodeRegistry) : null
        let from = lastPos
        if (fromGeoTo) {
          from = clipToNodeBoundary(to, lastPos, fromGeoTo)
        }
        // Emit M for the (possibly clipped) start position
        if (pendingMove) {
          d += `M ${from.x} ${from.y} `
          pendingMove = null
        } else if (from.x !== lastPos.x || from.y !== lastPos.y) {
          d += `M ${from.x} ${from.y} `
        }
        // For 'to', handle bend/loop options to produce bezier approximation
        const bendPath = buildBendPath(from, to, seg.rawOptions)
        d += bendPath.d
        bboxes.push(bendPath.bbox)
        lastPos = to
        lastCoordRef = seg.to
        break
      }

      case 'rectangle': {
        if (pendingMove) { d += `M ${pendingMove.x} ${pendingMove.y} `; pendingMove = null }
        const to = resolver.resolve((seg as any).to)
        const rc = path.style.roundedCorners
        if (rc && rc > 0) {
          const r = Math.min(ptToPx(rc), Math.abs(to.x - lastPos.x) / 2, Math.abs(to.y - lastPos.y) / 2)
          const x0 = lastPos.x, y0 = lastPos.y, x1 = to.x, y1 = to.y
          // Signed offsets so arcs curve into the rectangle interior in both orientations.
          // SVG y-axis is inverted vs TikZ, so y1 < y0 when the rect extends "upward" in TikZ.
          const rx = x1 > x0 ? r : -r
          const ry = y1 > y0 ? r : -r
          d += `M ${x0 + rx} ${y0} `
          d += `L ${x1 - rx} ${y0} Q ${x1} ${y0} ${x1} ${y0 + ry} `
          d += `L ${x1} ${y1 - ry} Q ${x1} ${y1} ${x1 - rx} ${y1} `
          d += `L ${x0 + rx} ${y1} Q ${x0} ${y1} ${x0} ${y1 - ry} `
          d += `L ${x0} ${y0 + ry} Q ${x0} ${y0} ${x0 + rx} ${y0} Z `
        } else {
          d += `L ${to.x} ${lastPos.y} L ${to.x} ${to.y} L ${lastPos.x} ${to.y} L ${lastPos.x} ${lastPos.y} Z `
        }
        bboxes.push(fromCorners(
          Math.min(lastPos.x, to.x), Math.min(lastPos.y, to.y),
          Math.max(lastPos.x, to.x), Math.max(lastPos.y, to.y)
        ))
        lastPos = to
        break
      }

      case 'grid': {
        if (pendingMove) { d += `M ${pendingMove.x} ${pendingMove.y} `; pendingMove = null }
        // Grid: render as a series of lines. The grid is from lastPos to 'to'.
        const gridSeg = seg as any
        const to = resolver.resolve(gridSeg.to)
        // 'step'/'xstep'/'ystep' may be on the path-level \draw[...] options or on the grid[...] itself.
        // Path-level comes first; grid-level options override if present.
        const gridOpts = [...path.rawOptions, ...(gridSeg.rawOptions ?? [])]
        const gridPath = buildGridPath(lastPos, to, gridOpts)
        d += gridPath.d
        bboxes.push(fromCorners(
          Math.min(lastPos.x, to.x), Math.min(lastPos.y, to.y),
          Math.max(lastPos.x, to.x), Math.max(lastPos.y, to.y)
        ))
        lastPos = to
        break
      }

      case 'close':
        d += 'Z '
        lastPos = subpathStart
        break

      case 'circle': {
        const cx = pendingMove ? pendingMove.x : lastPos.x
        const cy = pendingMove ? pendingMove.y : lastPos.y
        pendingMove = null
        const r = ptToPx((seg as any).radius)
        d += `M ${cx - r} ${cy} A ${r} ${r} 0 1 0 ${cx + r} ${cy} A ${r} ${r} 0 1 0 ${cx - r} ${cy} Z `
        worldBboxes.push(rotatedEllipseBBox(cx, cy, r, r, path.style.rotate ?? 0))
        lastPos = { x: cx, y: cy }
        break
      }

      case 'ellipse': {
        const cx = pendingMove ? pendingMove.x : lastPos.x
        const cy = pendingMove ? pendingMove.y : lastPos.y
        pendingMove = null
        const rx = ptToPx((seg as any).xRadius)
        const ry = ptToPx((seg as any).yRadius)
        d += `M ${cx - rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx + rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx - rx} ${cy} Z `
        worldBboxes.push(rotatedEllipseBBox(cx, cy, rx, ry, path.style.rotate ?? 0))
        lastPos = { x: cx, y: cy }
        break
      }

      case 'parabola': {
        // Cubic Bézier coefficients matching pgfcorepathconstruct.code.tex ("found by trial and error")
        // Bend-at-start: C1=S+(dx/2,0),          C2=E-(0.1125*dx, 0.225*dy)
        // Bend-at-end:   C1=S+(0.1125*dx,0.225*dy), C2=(S.x+dx/2, E.y)
        // Explicit bend B: two segments — S→B uses bend-at-end formula, B→E uses bend-at-start formula
        if (pendingMove) { d += `M ${pendingMove.x} ${pendingMove.y} `; pendingMove = null }
        const to = resolver.resolve((seg as any).to)
        if ((seg as any).bend) {
          const b = resolver.resolve((seg as any).bend)
          // Segment 1: lastPos → b (approach bend like bend-at-end)
          const dx1 = b.x - lastPos.x, dy1 = b.y - lastPos.y
          const c1x1 = lastPos.x + 0.1125 * dx1, c1y1 = lastPos.y + 0.225 * dy1
          const c2x1 = lastPos.x + 0.5 * dx1,   c2y1 = b.y
          d += `C ${c1x1} ${c1y1} ${c2x1} ${c2y1} ${b.x} ${b.y} `
          bboxes.push(fromCorners(
            Math.min(lastPos.x, c1x1, c2x1, b.x), Math.min(lastPos.y, c1y1, c2y1, b.y),
            Math.max(lastPos.x, c1x1, c2x1, b.x), Math.max(lastPos.y, c1y1, c2y1, b.y)
          ))
          // Segment 2: b → to (depart bend like bend-at-start)
          const dx2 = to.x - b.x, dy2 = to.y - b.y
          const c1x2 = b.x + 0.5 * dx2,          c1y2 = b.y
          const c2x2 = to.x - 0.1125 * dx2,      c2y2 = to.y - 0.225 * dy2
          d += `C ${c1x2} ${c1y2} ${c2x2} ${c2y2} ${to.x} ${to.y} `
          bboxes.push(fromCorners(
            Math.min(b.x, c1x2, c2x2, to.x), Math.min(b.y, c1y2, c2y2, to.y),
            Math.max(b.x, c1x2, c2x2, to.x), Math.max(b.y, c1y2, c2y2, to.y)
          ))
        } else {
          const dx = to.x - lastPos.x, dy = to.y - lastPos.y
          let c1x: number, c1y: number, c2x: number, c2y: number
          if ((seg as any).bendAtEnd) {
            c1x = lastPos.x + 0.1125 * dx; c1y = lastPos.y + 0.225 * dy
            c2x = lastPos.x + 0.5 * dx;   c2y = to.y
          } else {
            // bend at start (default)
            c1x = lastPos.x + 0.5 * dx; c1y = lastPos.y
            c2x = to.x - 0.1125 * dx;  c2y = to.y - 0.225 * dy
          }
          d += `C ${c1x} ${c1y} ${c2x} ${c2y} ${to.x} ${to.y} `
          bboxes.push(fromCorners(
            Math.min(lastPos.x, c1x, c2x, to.x), Math.min(lastPos.y, c1y, c2y, to.y),
            Math.max(lastPos.x, c1x, c2x, to.x), Math.max(lastPos.y, c1y, c2y, to.y)
          ))
        }
        lastPos = to
        break
      }

      case 'sin': {
        if (pendingMove) { d += `M ${pendingMove.x} ${pendingMove.y} `; pendingMove = null }
        const to = resolver.resolve((seg as any).to)
        const dx = to.x - lastPos.x
        const dy = to.y - lastPos.y
        // Cubic Bézier approximating a quarter-period sine wave [0, π/2].
        // Reference: P0=(0,0), P1≈(0.6433,0.6433), P2≈(0.9275,1), P3=(π/2,1).
        // c1: angled departure (KX·dx, KY·dy). c2: horizontal arrival at peak (c2y=to.y).
        const KX = TIKZ_CONSTANTS.SIN_BEZIER_KX
        const KY = TIKZ_CONSTANTS.SIN_BEZIER_KY
        const c1x = lastPos.x + KX * dx
        const c1y = lastPos.y + KY * dy
        const c2x = to.x - KX * dx
        const c2y = to.y
        d += `C ${c1x} ${c1y} ${c2x} ${c2y} ${to.x} ${to.y} `
        bboxes.push(fromCorners(
          Math.min(lastPos.x, c1x, c2x, to.x), Math.min(lastPos.y, c1y, c2y, to.y),
          Math.max(lastPos.x, c1x, c2x, to.x), Math.max(lastPos.y, c1y, c2y, to.y)
        ))
        lastPos = to
        break
      }

      case 'cos': {
        if (pendingMove) { d += `M ${pendingMove.x} ${pendingMove.y} `; pendingMove = null }
        const to = resolver.resolve((seg as any).to)
        const dx = to.x - lastPos.x
        const dy = to.y - lastPos.y
        // Cubic Bézier approximating a quarter-period cosine wave [0, π/2].
        // Mirror of sin: c1 is horizontal departure from peak (c1y=lastPos.y). c2: angled arrival.
        const KX = TIKZ_CONSTANTS.SIN_BEZIER_KX
        const KY = TIKZ_CONSTANTS.SIN_BEZIER_KY
        const c1x = lastPos.x + KX * dx
        const c1y = lastPos.y
        const c2x = to.x - KX * dx
        const c2y = to.y - KY * dy
        d += `C ${c1x} ${c1y} ${c2x} ${c2y} ${to.x} ${to.y} `
        bboxes.push(fromCorners(
          Math.min(lastPos.x, c1x, c2x, to.x), Math.min(lastPos.y, c1y, c2y, to.y),
          Math.max(lastPos.x, c1x, c2x, to.x), Math.max(lastPos.y, c1y, c2y, to.y)
        ))
        lastPos = to
        break
      }

      case 'node-on-path':
        // Handled by nodeEmitter — no path contribution
        break
    }
  }

  if (d.trim()) {
    const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    pathEl.setAttribute('d', d.trim())

    // Determine marker IDs — resolve 'default' tip using arrowDefault if set
    const resolveDefaultTip = (tip: import('../../ir/types.js').ArrowTipSpec) =>
      tip.kind === 'default' && path.style.arrowDefault
        ? { ...tip, kind: path.style.arrowDefault }
        : tip
    const markerIds: { start?: string; end?: string } = {}
    if (path.style.arrowStart) {
      markerIds.start = ensureMarker(resolveDefaultTip(path.style.arrowStart), markerRegistry, path.style.draw ?? 'currentColor')
    }
    if (path.style.arrowEnd) {
      markerIds.end = ensureMarker(resolveDefaultTip(path.style.arrowEnd), markerRegistry, path.style.draw ?? 'currentColor')
    }

    applyAttrs(pathEl, buildPathAttrs(path.style, markerIds))

    const transform = buildTransform(path.style, 0, 0, resolver.coordScale)
    if (transform) pathEl.setAttribute('transform', transform)

    elements.push(pathEl)
  }

  const rawBBox = mergeBBoxes(bboxes)
  const transform = buildTransform(path.style, 0, 0, resolver.coordScale)

  // Expand bbox by half the stroke width so thick lines don't clip the viewBox.
  const strokeHalfPx = ptToPx(
    (path.style.drawWidth ?? TIKZ_CONSTANTS.DEFAULT_LINE_WIDTH_PT) / 2
  )
  const expandedBBox = rawBBox.minX <= rawBBox.maxX
    ? fromCorners(
        rawBBox.minX - strokeHalfPx, rawBBox.minY - strokeHalfPx,
        rawBBox.maxX + strokeHalfPx, rawBBox.maxY + strokeHalfPx
      )
    : rawBBox

  return {
    elements,
    bbox: mergeBBoxes([transformBBox(expandedBBox, transform), ...worldBboxes]),
  }
}

/**
 * Analytically compute the axis-aligned bounding box of an ellipse with semi-axes (rx, ry)
 * centered at (cx, cy) after a rotation of `rotateDeg` degrees around the SVG origin (0,0).
 * SVG uses negative rotation (TikZ CCW = SVG CW), so we negate here to match buildTransform.
 */
function rotatedEllipseBBox(cx: number, cy: number, rx: number, ry: number, rotateDeg: number): BoundingBox {
  const θ = (-rotateDeg * Math.PI) / 180
  const cosθ = Math.cos(θ)
  const sinθ = Math.sin(θ)
  // Rotate center around origin
  const rcx = cx * cosθ - cy * sinθ
  const rcy = cx * sinθ + cy * cosθ
  // Half-extents of rotated ellipse AABB
  const hw = Math.sqrt((rx * cosθ) ** 2 + (ry * sinθ) ** 2)
  const hh = Math.sqrt((rx * sinθ) ** 2 + (ry * cosθ) ** 2)
  return fromCorners(rcx - hw, rcy - hh, rcx + hw, rcy + hh)
}

/** Build a bend/arc path for 'to' operations with bend options. */
function buildBendPath(
  from: AbsoluteCoordinate,
  to: AbsoluteCoordinate,
  rawOptions: any[]
): { d: string; bbox: BoundingBox } {
  let bendAngle = 0
  let bendDir = 0 // +1 = left, -1 = right

  for (const opt of rawOptions) {
    if (opt.key === 'bend left') {
      bendAngle = opt.value ? parseFloat(opt.value) : 30
      bendDir = 1
    }
    if (opt.key === 'bend right') {
      bendAngle = opt.value ? parseFloat(opt.value) : 30
      bendDir = -1
    }
  }

  if (bendDir === 0) {
    // Straight line
    return {
      d: `L ${to.x} ${to.y} `,
      bbox: fromCorners(from.x, from.y, to.x, to.y),
    }
  }

  // TikZ topaths formula (tikzlibrarytopaths.code.tex):
  //   d = 0.3915 × dist × looseness
  //   C1 = from + d × dir(out_angle)
  //   C2 = to   + d × dir(in_angle)
  // For bend left=θ:  tikzOut=+θ, tikzIn=180°-θ  (relative to line direction)
  // For bend right=θ: tikzOut=-θ, tikzIn=180°+θ
  // SVG has y-down, so TikZ CCW = SVG CW — negate TikZ relative angles.
  const dx = to.x - from.x
  const dy = to.y - from.y
  const len = Math.sqrt(dx * dx + dy * dy)
  const lineAngle = Math.atan2(dy, dx)

  const d = TIKZ_CONSTANTS.TO_PATH_LOOSENESS * len // looseness=1
  const tikzOut = bendDir * bendAngle // degrees in TikZ relative frame
  const DEG = Math.PI / 180
  const svgOutAngle = lineAngle - tikzOut * DEG
  const svgInAngle  = lineAngle - (180 - tikzOut) * DEG

  const c1x = from.x + d * Math.cos(svgOutAngle)
  const c1y = from.y + d * Math.sin(svgOutAngle)
  const c2x = to.x   + d * Math.cos(svgInAngle)
  const c2y = to.y   + d * Math.sin(svgInAngle)
  return {
    d: `C ${c1x} ${c1y} ${c2x} ${c2y} ${to.x} ${to.y} `,
    bbox: fromCorners(
      Math.min(from.x, c1x, c2x, to.x), Math.min(from.y, c1y, c2y, to.y),
      Math.max(from.x, c1x, c2x, to.x), Math.max(from.y, c1y, c2y, to.y)
    ),
  }
}

/** Build SVG path data for a grid from (fromX,fromY) to (toX,toY). */
function buildGridPath(
  from: AbsoluteCoordinate,
  to: AbsoluteCoordinate,
  rawOptions: { key: string; value?: string }[]
): { d: string } {
  const minX = Math.min(from.x, to.x)
  const maxX = Math.max(from.x, to.x)
  const minY = Math.min(from.y, to.y)
  const maxY = Math.max(from.y, to.y)

  const getOpt = (key: string) => rawOptions.find(o => o.key === key)?.value

  const stepOpt  = getOpt('step')
  const xstepOpt = getOpt('xstep')
  const ystepOpt = getOpt('ystep')

  const xstep = ptToPx(parseDimensionPt(xstepOpt ?? stepOpt) || TIKZ_CONSTANTS.DEFAULT_GRID_STEP_PT)
  const ystep = ptToPx(parseDimensionPt(ystepOpt ?? stepOpt) || TIKZ_CONSTANTS.DEFAULT_GRID_STEP_PT)

  let d = ''

  // Vertical lines
  for (let x = minX; x <= maxX + 0.01; x += xstep) {
    const xr = Math.round(x * 100) / 100
    d += `M ${xr} ${minY} L ${xr} ${maxY} `
  }
  // Horizontal lines
  for (let y = minY; y <= maxY + 0.01; y += ystep) {
    const yr = Math.round(y * 100) / 100
    d += `M ${minX} ${yr} L ${maxX} ${yr} `
  }

  return { d }
}

/** Get node geometry for a coordinate that references a node. */
function getNodeGeoForCoord(ref: CoordRef, registry: NodeGeometryRegistry) {
  if (ref.coord.cs === 'node-anchor') {
    return registry.getByName(ref.coord.nodeName) ?? null
  }
  return null
}


