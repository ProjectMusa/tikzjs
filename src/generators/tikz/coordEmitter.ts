/**
 * Emit CoordRef as a TikZ coordinate string.
 *
 * IR stores all coordinates in TeX points. TikZ defaults to cm,
 * so we divide by PT_PER_CM for XY and polar coordinates.
 * Node-anchor, calc, and node-placement are symbolic.
 */

import type { CoordRef, Coord, CalcExpr } from '../../ir/types.js'
import { TIKZ_CONSTANTS } from '../svg/constants.js'

const PT_PER_CM = TIKZ_CONSTANTS.PT_PER_CM

/** Format a number, dropping trailing zeros. */
function fmt(n: number): string {
  // Round to avoid floating point noise (e.g. 2.0000000001)
  const rounded = Math.round(n * 10000) / 10000
  return String(rounded)
}

function ptToCm(pt: number): string {
  return fmt(pt / PT_PER_CM)
}

function emitCoordInner(coord: Coord): string {
  switch (coord.cs) {
    case 'xy':
      return `(${ptToCm(coord.x)}, ${ptToCm(coord.y)})`
    case 'polar':
      return `(${fmt(coord.angle)}:${ptToCm(coord.radius)})`
    case 'node-anchor':
      if (coord.anchor === 'center') return `(${coord.nodeName})`
      return `(${coord.nodeName}.${coord.anchor})`
    case 'calc':
      return `($ ${emitCalcExpr(coord.expr)} $)`
    case 'node-placement':
      // Node-placement coords are not emitted as coordinates —
      // they become options on the node (e.g. below=of NODE).
      // But if we encounter one in a coord position, emit as the ref node.
      return `(${coord.refName})`
  }
}

function emitCalcExpr(expr: CalcExpr): string {
  switch (expr.kind) {
    case 'coord':
      return emitCoordInner(expr.ref.coord)
    case 'add':
      return `${emitCalcExpr(expr.a)} + ${emitCalcExpr(expr.b)}`
    case 'sub':
      return `${emitCalcExpr(expr.a)} - ${emitCalcExpr(expr.b)}`
    case 'scale':
      return `${fmt(expr.factor)} * ${emitCalcExpr(expr.expr)}`
    case 'midpoint':
      return `${emitCalcExpr(expr.a)} !${fmt(expr.t)}! ${emitCalcExpr(expr.b)}`
    case 'perpendicular':
      return `${emitCalcExpr(expr.a)} !${emitCalcExpr(expr.through)}! ${emitCalcExpr(expr.b)}`
  }
}

/**
 * Emit a CoordRef as a TikZ coordinate string.
 * Handles mode prefixes: absolute → none, relative → ++, relative-pass → +
 */
export function emitCoord(ref: CoordRef): string {
  const inner = emitCoordInner(ref.coord)
  switch (ref.mode) {
    case 'absolute':
      return inner
    case 'relative':
      return `++${inner}`
    case 'relative-pass':
      return `+${inner}`
  }
}
