/**
 * Coordinate resolver: converts symbolic CoordRef values from the IR
 * into absolute pixel coordinates for SVG rendering.
 *
 * All coordinates in the IR are stored in TeX points (pt).
 * The resolver converts to pixels using the configured scale factor.
 *
 * This is the only place in the generator layer that knows about
 * the pt → px conversion. All other emitters work in pixels.
 */

import {
  CoordRef,
  Coord,
  XYCoord,
  PolarCoord,
  NodeAnchorCoord,
  CalcCoord,
  CalcExpr,
  IRNode,
  IRMatrix,
  ResolvedStyle,
} from '../../ir/types.js'
import { AbsoluteCoordinate, BoundingBox, fromCorners } from './boundingBox.js'

// ── Scale constants ───────────────────────────────────────────────────────────

/** Default: 1 cm = 52 px (as in the original implementation). */
const CM_TO_PX = 52
/** 1 pt (TeX point) = cm/28.45 ≈ 1.828 px at default scale. */
export const PT_TO_PX = CM_TO_PX / 28.4528

/** Convert TeX points to SVG pixels. */
export function ptToPx(pt: number): number {
  return pt * PT_TO_PX
}

/** Convert SVG pixels to TeX points. */
export function pxToPt(px: number): number {
  return px / PT_TO_PX
}

// ── Node geometry registry ────────────────────────────────────────────────────

/** Resolved node geometry: absolute pixel position and bounding box. */
export interface NodeGeometry {
  /** Center position in SVG pixels. */
  centerX: number
  centerY: number
  /** Half-width for anchor computation. */
  halfWidth: number
  /** Half-height for anchor computation. */
  halfHeight: number
  /** Full bounding box in SVG pixels. */
  bbox: BoundingBox
}

/**
 * Registry of resolved node geometries, populated during rendering.
 * The coordinate resolver uses this to resolve NodeAnchorCoord references.
 */
export class NodeGeometryRegistry {
  private _byId = new Map<string, NodeGeometry>()
  private _byName = new Map<string, string>() // name → id

  register(id: string, name: string | undefined, geo: NodeGeometry): void {
    this._byId.set(id, geo)
    if (name) this._byName.set(name, id)
  }

  getById(id: string): NodeGeometry | undefined {
    return this._byId.get(id)
  }

  getByName(name: string): NodeGeometry | undefined {
    const id = this._byName.get(name)
    return id ? this._byId.get(id) : undefined
  }

  has(name: string): boolean {
    return this._byName.has(name)
  }
}

// ── Anchor computation ────────────────────────────────────────────────────────

/**
 * Get the pixel position of a named anchor on a node.
 * Migrated from TikzNodeElement.getAnchor().
 */
export function getAnchorPosition(geo: NodeGeometry, anchor: string): AbsoluteCoordinate {
  const { centerX, centerY, halfWidth, halfHeight } = geo

  switch (anchor) {
    case 'center': return { x: centerX, y: centerY }
    case 'north':  return { x: centerX, y: centerY - halfHeight }
    case 'south':  return { x: centerX, y: centerY + halfHeight }
    case 'east':   return { x: centerX + halfWidth, y: centerY }
    case 'west':   return { x: centerX - halfWidth, y: centerY }
    case 'north east': return { x: centerX + halfWidth, y: centerY - halfHeight }
    case 'north west': return { x: centerX - halfWidth, y: centerY - halfHeight }
    case 'south east': return { x: centerX + halfWidth, y: centerY + halfHeight }
    case 'south west': return { x: centerX - halfWidth, y: centerY + halfHeight }
    case 'mid':    return { x: centerX, y: centerY }
    case 'base':   return { x: centerX, y: centerY + halfHeight * 0.3 }
    case 'mid east':   return { x: centerX + halfWidth, y: centerY }
    case 'mid west':   return { x: centerX - halfWidth, y: centerY }
    case 'base east':  return { x: centerX + halfWidth, y: centerY + halfHeight * 0.3 }
    case 'base west':  return { x: centerX - halfWidth, y: centerY + halfHeight * 0.3 }
    default:       return { x: centerX, y: centerY }
  }
}

/**
 * Clip a line endpoint to the boundary of a node's bounding box.
 * Used to ensure arrows start/end at node edges, not centers.
 * Migrated from TikzSubPathLineToElement._clipToNodeBoundaries().
 */
export function clipToNodeBoundary(
  from: AbsoluteCoordinate,
  to: AbsoluteCoordinate,
  geo: NodeGeometry
): AbsoluteCoordinate {
  const { centerX, centerY, halfWidth, halfHeight } = geo
  const dx = to.x - from.x
  const dy = to.y - from.y
  const len = Math.sqrt(dx * dx + dy * dy)
  if (len < 1e-9) return to

  // Find where the line from 'from' toward center exits the bounding box
  const nx = dx / len
  const ny = dy / len

  // Candidate intersections with the 4 sides
  const candidates: AbsoluteCoordinate[] = []

  // Left / right sides
  if (Math.abs(nx) > 1e-9) {
    const tL = (centerX - halfWidth - from.x) / nx
    const tR = (centerX + halfWidth - from.x) / nx
    for (const t of [tL, tR]) {
      if (t > 0) {
        const y = from.y + t * ny
        if (y >= centerY - halfHeight && y <= centerY + halfHeight) {
          candidates.push({ x: from.x + t * nx, y })
        }
      }
    }
  }

  // Top / bottom sides
  if (Math.abs(ny) > 1e-9) {
    const tT = (centerY - halfHeight - from.y) / ny
    const tB = (centerY + halfHeight - from.y) / ny
    for (const t of [tT, tB]) {
      if (t > 0) {
        const x = from.x + t * nx
        if (x >= centerX - halfWidth && x <= centerX + halfWidth) {
          candidates.push({ x, y: from.y + t * ny })
        }
      }
    }
  }

  if (candidates.length === 0) return to

  // Pick the closest intersection to 'from'
  return candidates.reduce((best, c) => {
    const dBest = (best.x - from.x) ** 2 + (best.y - from.y) ** 2
    const dC    = (c.x - from.x) ** 2 + (c.y - from.y) ** 2
    return dC < dBest ? c : best
  })
}

// ── Main resolver ─────────────────────────────────────────────────────────────

export class CoordResolver {
  private _nodeRegistry: NodeGeometryRegistry
  /** Current absolute position (updated as we move along a path). */
  private _currentX = 0
  private _currentY = 0

  constructor(nodeRegistry: NodeGeometryRegistry) {
    this._nodeRegistry = nodeRegistry
  }

  /**
   * Resolve a CoordRef to an absolute pixel position.
   * Updates the internal current position for relative coordinate resolution.
   */
  resolve(ref: CoordRef): AbsoluteCoordinate {
    const raw = this.resolveCoord(ref.coord)

    let x: number
    let y: number

    switch (ref.mode) {
      case 'absolute':
        x = raw.x
        y = raw.y
        this._currentX = x
        this._currentY = y
        break
      case 'relative':
        x = this._currentX + raw.x
        y = this._currentY + raw.y
        this._currentX = x
        this._currentY = y
        break
      case 'relative-pass':
        x = this._currentX + raw.x
        y = this._currentY + raw.y
        // Do NOT update _currentX/_currentY
        break
    }

    return { x: x!, y: y! }
  }

  /**
   * Resolve a Coord (without mode) to a pixel position.
   * Does not modify the current position.
   */
  resolveCoord(coord: Coord): AbsoluteCoordinate {
    switch (coord.cs) {
      case 'xy':
        return { x: ptToPx(coord.x), y: -ptToPx(coord.y) } // SVG y-axis is inverted

      case 'polar': {
        const rad = (coord.angle * Math.PI) / 180
        return {
          x: ptToPx(coord.radius) * Math.cos(rad),
          y: -ptToPx(coord.radius) * Math.sin(rad),
        }
      }

      case 'node-anchor': {
        const geo = this._nodeRegistry.getByName(coord.nodeName)
        if (!geo) {
          // Node not yet rendered — return origin as fallback
          return { x: 0, y: 0 }
        }
        return getAnchorPosition(geo, coord.anchor)
      }

      case 'calc':
        return this.resolveCalc(coord.expr)
    }
  }

  private resolveCalc(expr: CalcExpr): AbsoluteCoordinate {
    switch (expr.kind) {
      case 'coord':
        return this.resolveCoord(expr.ref.coord)

      case 'add': {
        const a = this.resolveCalc(expr.a)
        const b = this.resolveCalc(expr.b)
        return { x: a.x + b.x, y: a.y + b.y }
      }

      case 'sub': {
        const a = this.resolveCalc(expr.a)
        const b = this.resolveCalc(expr.b)
        return { x: a.x - b.x, y: a.y - b.y }
      }

      case 'scale': {
        const p = this.resolveCalc(expr.expr)
        return { x: p.x * expr.factor, y: p.y * expr.factor }
      }

      case 'midpoint': {
        const a = this.resolveCalc(expr.a)
        const b = this.resolveCalc(expr.b)
        const t = expr.t
        return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) }
      }

      case 'perpendicular': {
        const a = this.resolveCalc(expr.a)
        const b = this.resolveCalc(expr.b)
        // Perpendicular from a to line through b and expr.through
        return { x: a.x, y: b.y }
      }
    }
  }

  /** Get current position without modifying it. */
  getCurrent(): AbsoluteCoordinate {
    return { x: this._currentX, y: this._currentY }
  }

  /** Explicitly set current position (e.g. after a move). */
  setCurrent(x: number, y: number): void {
    this._currentX = x
    this._currentY = y
  }

  /** Create a clone for sub-path processing. */
  clone(): CoordResolver {
    const c = new CoordResolver(this._nodeRegistry)
    c._currentX = this._currentX
    c._currentY = this._currentY
    return c
  }
}
