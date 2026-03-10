/**
 * Path emitter: converts IRPath segments to SVG <path> elements.
 *
 * Bezier curve geometry uses bezier-js (migrated from TikzSubPathCurveToElement).
 * Line clipping to node boundaries uses coordResolver.clipToNodeBoundary().
 */

import { IRPath, IRNode, PathSegment, CoordRef, ResolvedStyle } from '../../ir/types.js'
import { CoordResolver, NodeGeometryRegistry, clipToNodeBoundary, ptToPx } from './coordResolver.js'
import { BoundingBox, emptyBBox, expandPoint, mergeBBoxes, fromCorners } from './boundingBox.js'
import { buildPathAttrs, applyAttrs, buildTransform } from './styleEmitter.js'
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

  // Track start-of-subpath position for close-path
  let subpathStart: AbsoluteCoordinate = { x: 0, y: 0 }

  // Build the SVG path d attribute
  let d = ''
  let lastPos: AbsoluteCoordinate = { x: 0, y: 0 }
  let hasStroke = path.style.draw !== undefined && path.style.draw !== 'none'
  let hasFill = path.style.fill !== undefined && path.style.fill !== 'none'

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const segs = path.segments as any[]

  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i]

    switch (seg.kind) {
      case 'move': {
        const pos = resolver.resolve(seg.to)
        d += `M ${pos.x} ${pos.y} `
        lastPos = pos
        subpathStart = pos
        bboxes.push(fromCorners(pos.x, pos.y, pos.x, pos.y))
        break
      }

      case 'line': {
        let to = resolver.resolve(seg.to)
        // Clip to node boundary if destination is a node
        const toGeo = getNodeGeoForCoord(seg.to, nodeRegistry)
        if (toGeo) {
          to = clipToNodeBoundary(lastPos, to, toGeo)
        }
        const fromGeo = getNodeGeoForLastPos(lastPos, nodeRegistry)
        let from = lastPos
        if (fromGeo) {
          from = clipToNodeBoundary(to, lastPos, fromGeo)
        }
        if (from !== lastPos) {
          d += `M ${from.x} ${from.y} `
        }
        d += `L ${to.x} ${to.y} `
        lastPos = resolver.resolve(seg.to)
        bboxes.push(fromCorners(from.x, from.y, to.x, to.y))
        break
      }

      case 'hv-line': {
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
        const to = resolver.resolve(seg.to)
        if (seg.controls.length === 1) {
          const c = resolver.resolve(seg.controls[0])
          d += `Q ${c.x} ${c.y} ${to.x} ${to.y} `
          if (Bezier) {
            const curve = new Bezier.Bezier(lastPos.x, lastPos.y, c.x, c.y, to.x, to.y)
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
        // SVG arc command: A rx ry x-rotation large-arc-flag sweep-flag x y
        const { startAngle, endAngle, xRadius, yRadius } = seg
        const rx = ptToPx(xRadius)
        const ry = yRadius !== undefined ? ptToPx(yRadius) : rx
        const startRad = (startAngle * Math.PI) / 180
        const endRad = (endAngle * Math.PI) / 180
        // In SVG coords, y is inverted
        const endX = lastPos.x + rx * (Math.cos(endRad) - Math.cos(startRad))
        const endY = lastPos.y - ry * (Math.sin(endRad) - Math.sin(startRad))
        const sweep = endAngle > startAngle ? 1 : 0
        const largeArc = Math.abs(endAngle - startAngle) > 180 ? 1 : 0
        d += `A ${rx} ${ry} 0 ${largeArc} ${sweep} ${endX} ${endY} `
        lastPos = { x: endX, y: endY }
        bboxes.push(fromCorners(
          Math.min(lastPos.x, endX) - rx,
          Math.min(lastPos.y, endY) - ry,
          Math.max(lastPos.x, endX) + rx,
          Math.max(lastPos.y, endY) + ry
        ))
        break
      }

      case 'to': {
        const to = resolver.resolve(seg.to)
        // For 'to', handle bend/loop options to produce bezier approximation
        const bendPath = buildBendPath(lastPos, to, seg.rawOptions)
        d += bendPath.d
        bboxes.push(bendPath.bbox)
        lastPos = to
        break
      }

      case 'rectangle': {
        const to = resolver.resolve((seg as any).to)
        d += `L ${to.x} ${lastPos.y} L ${to.x} ${to.y} L ${lastPos.x} ${to.y} L ${lastPos.x} ${lastPos.y} Z `
        bboxes.push(fromCorners(
          Math.min(lastPos.x, to.x), Math.min(lastPos.y, to.y),
          Math.max(lastPos.x, to.x), Math.max(lastPos.y, to.y)
        ))
        lastPos = to
        break
      }

      case 'grid': {
        // Grid: render as a series of lines. The grid is from lastPos to 'to'.
        const gridSeg = seg as any
        const to = resolver.resolve(gridSeg.to)
        const gridPath = buildGridPath(lastPos, to)
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

      case 'node-on-path':
        // Handled by nodeEmitter — no path contribution
        break
    }
  }

  if (d.trim()) {
    const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    pathEl.setAttribute('d', d.trim())

    // Determine marker IDs
    const markerIds: { start?: string; end?: string } = {}
    if (path.style.arrowStart) {
      markerIds.start = ensureMarker(path.style.arrowStart, markerRegistry, path.style.draw ?? 'currentColor')
    }
    if (path.style.arrowEnd) {
      markerIds.end = ensureMarker(path.style.arrowEnd, markerRegistry, path.style.draw ?? 'currentColor')
    }

    applyAttrs(pathEl, buildPathAttrs(path.style, markerIds))

    const transform = buildTransform(path.style)
    if (transform) pathEl.setAttribute('transform', transform)

    elements.push(pathEl)
  }

  return {
    elements,
    bbox: mergeBBoxes(bboxes),
  }
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

  // Compute control point for bend
  const mx = (from.x + to.x) / 2
  const my = (from.y + to.y) / 2
  const dx = to.x - from.x
  const dy = to.y - from.y
  const len = Math.sqrt(dx * dx + dy * dy)
  const perpX = -dy / len
  const perpY = dx / len
  const bendDist = (len / 2) * Math.tan((bendAngle * Math.PI) / 180)
  const cx = mx + bendDir * perpX * bendDist
  const cy = my + bendDir * perpY * bendDist

  return {
    d: `Q ${cx} ${cy} ${to.x} ${to.y} `,
    bbox: fromCorners(
      Math.min(from.x, cx, to.x), Math.min(from.y, cy, to.y),
      Math.max(from.x, cx, to.x), Math.max(from.y, cy, to.y)
    ),
  }
}

/** Build SVG path data for a grid from (fromX,fromY) to (toX,toY). */
function buildGridPath(from: AbsoluteCoordinate, to: AbsoluteCoordinate): { d: string } {
  const minX = Math.min(from.x, to.x)
  const maxX = Math.max(from.x, to.x)
  const minY = Math.min(from.y, to.y)
  const maxY = Math.max(from.y, to.y)

  // Default grid step: 52px (1cm)
  const step = ptToPx(28.45) // 1cm in pt

  let d = ''

  // Vertical lines
  for (let x = minX; x <= maxX + 0.01; x += step) {
    const xr = Math.round(x * 100) / 100
    d += `M ${xr} ${minY} L ${xr} ${maxY} `
  }
  // Horizontal lines
  for (let y = minY; y <= maxY + 0.01; y += step) {
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

/** Get node geometry for the last rendered position (heuristic). */
function getNodeGeoForLastPos(_pos: AbsoluteCoordinate, _registry: NodeGeometryRegistry) {
  return null // Position-based lookup not feasible without reverse map
}
