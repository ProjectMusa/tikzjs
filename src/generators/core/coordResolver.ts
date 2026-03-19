/**
 * Coordinate resolver — target-agnostic, no SVG DOM dependencies.
 *
 * Converts symbolic CoordRef values from the IR into absolute pixel coordinates.
 * All coordinates in the IR are stored in TeX points (pt).
 * The resolver converts to pixels using the configured scale factor.
 *
 * This module is shared between the SVG generator and future renderers (D3, canvas, etc.).
 */

import {
  CoordRef,
  Coord,
  XYCoord,
  PolarCoord,
  NodeAnchorCoord,
  CalcCoord,
  NodePlacementCoord,
  CalcExpr,
  IRNode,
  IRMatrix,
  ResolvedStyle,
} from '../../ir/types.js'
import { AbsoluteCoordinate, BoundingBox, fromCorners } from './boundingBox.js'
import { DEFAULT_CONSTANTS } from '../svg/constants.js'

// ── Scale helpers ─────────────────────────────────────────────────────────────

/** 1 pt (TeX point) in SVG pixels at the default scale. See DEFAULT_CONSTANTS.PT_TO_PX. */
export const PT_TO_PX = DEFAULT_CONSTANTS.PT_TO_PX

/** Convert TeX points to SVG pixels (using default scale). */
export function ptToPx(pt: number): number {
  return pt * DEFAULT_CONSTANTS.PT_TO_PX
}

/** Convert SVG pixels to TeX points (using default scale). */
export function pxToPt(px: number): number {
  return px / DEFAULT_CONSTANTS.PT_TO_PX
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

  const nx = dx / len
  const ny = dy / len

  const candidates: AbsoluteCoordinate[] = []

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

  return candidates.reduce((best, c) => {
    const dBest = (best.x - from.x) ** 2 + (best.y - from.y) ** 2
    const dC    = (c.x - from.x) ** 2 + (c.y - from.y) ** 2
    return dC < dBest ? c : best
  })
}

// ── Main resolver ─────────────────────────────────────────────────────────────

/** Default node distance for `below=of` positioning (1cm in pt). */
export const DEFAULT_NODE_DISTANCE_PT = 28.4528

export class CoordResolver {
  private _nodeRegistry: NodeGeometryRegistry
  /** Global coordinate scale from \begin{tikzpicture}[scale=...]. */
  private _coordScale: number
  /** node distance (pt) for positioning library: `below=of NODE` etc. */
  private _nodeDistancePt: number
  /** Current absolute position (updated as we move along a path). */
  private _currentX = 0
  private _currentY = 0

  constructor(nodeRegistry: NodeGeometryRegistry, coordScale = 1, nodeDistancePt = DEFAULT_NODE_DISTANCE_PT) {
    this._nodeRegistry = nodeRegistry
    this._coordScale = coordScale
    this._nodeDistancePt = nodeDistancePt
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
        return { x: ptToPx(coord.x * this._coordScale), y: -ptToPx(coord.y * this._coordScale) } // SVG y-axis is inverted

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
          return { x: 0, y: 0 }
        }
        return getAnchorPosition(geo, coord.anchor)
      }

      case 'node-placement': {
        // TikZ positioning library: below=of NODE, above=of NODE, etc.
        // Returns the anchor position (e.g. the 'north' point for below=of).
        // The new node's center is then computed by nodeEmitter via anchorOffsetFromAnchor.
        const refGeo = this._nodeRegistry.getByName(coord.refName)
        if (!refGeo) return { x: 0, y: 0 }
        const distPx = ptToPx(coord.distancePt > 0 ? coord.distancePt : this._nodeDistancePt)
        const { centerX: cx, centerY: cy, halfWidth: hw, halfHeight: hh } = refGeo
        switch (coord.direction) {
          case 'below':       return { x: cx,          y: cy + hh + distPx }
          case 'above':       return { x: cx,          y: cy - hh - distPx }
          case 'right':       return { x: cx + hw + distPx, y: cy }
          case 'left':        return { x: cx - hw - distPx, y: cy }
          // Diagonal: both axes offset by distPx; anchor matches anchorFromPlacement
          case 'above left':  return { x: cx - hw - distPx, y: cy - hh - distPx }
          case 'above right': return { x: cx + hw + distPx, y: cy - hh - distPx }
          case 'below left':  return { x: cx - hw - distPx, y: cy + hh + distPx }
          case 'below right': return { x: cx + hw + distPx, y: cy + hh + distPx }
        }
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

  /** The coordinate scale factor (from tikzpicture-level scale=...). */
  get coordScale(): number { return this._coordScale }

  /** Create a clone for sub-path processing. */
  clone(): CoordResolver {
    const c = new CoordResolver(this._nodeRegistry, this._coordScale, this._nodeDistancePt)
    c._currentX = this._currentX
    c._currentY = this._currentY
    return c
  }
}
