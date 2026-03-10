/**
 * Bounding box utilities for SVG generation.
 * Migrated from src/generators/utils.ts and generalized.
 */

export interface BoundingBox {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export interface AbsoluteCoordinate {
  x: number
  y: number
}

/** Create an empty (degenerate) bounding box. */
export function emptyBBox(): BoundingBox {
  return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
}

/** Create a bounding box from a single point. */
export function pointBBox(x: number, y: number): BoundingBox {
  return { minX: x, minY: y, maxX: x, maxY: y }
}

/** Create a bounding box from two corner points. */
export function fromCorners(x0: number, y0: number, x1: number, y1: number): BoundingBox {
  return {
    minX: Math.min(x0, x1),
    minY: Math.min(y0, y1),
    maxX: Math.max(x0, x1),
    maxY: Math.max(y0, y1),
  }
}

/** Expand a bounding box to include a point. */
export function expandPoint(bb: BoundingBox, x: number, y: number): BoundingBox {
  return {
    minX: Math.min(bb.minX, x),
    minY: Math.min(bb.minY, y),
    maxX: Math.max(bb.maxX, x),
    maxY: Math.max(bb.maxY, y),
  }
}

/** Merge multiple bounding boxes into one. */
export function mergeBBoxes(boxes: BoundingBox[]): BoundingBox {
  const valid = boxes.filter((b) => isFinite(b.minX))
  if (valid.length === 0) return { minX: -50, minY: -50, maxX: 50, maxY: 50 }
  return valid.reduce((acc, b) => ({
    minX: Math.min(acc.minX, b.minX),
    minY: Math.min(acc.minY, b.minY),
    maxX: Math.max(acc.maxX, b.maxX),
    maxY: Math.max(acc.maxY, b.maxY),
  }))
}

/** Add padding uniformly around a bounding box. */
export function padBBox(bb: BoundingBox, padding: number): BoundingBox {
  return {
    minX: bb.minX - padding,
    minY: bb.minY - padding,
    maxX: bb.maxX + padding,
    maxY: bb.maxY + padding,
  }
}

/** Width of a bounding box. */
export function bboxWidth(bb: BoundingBox): number {
  return bb.maxX - bb.minX
}

/** Height of a bounding box. */
export function bboxHeight(bb: BoundingBox): number {
  return bb.maxY - bb.minY
}

/** Convert bounding box to SVG viewBox string "minX minY width height". */
export function toViewBox(bb: BoundingBox): string {
  return `${bb.minX} ${bb.minY} ${bboxWidth(bb)} ${bboxHeight(bb)}`
}

/** True if the bounding box has finite, non-degenerate extents. */
export function isValidBBox(bb: BoundingBox): boolean {
  return isFinite(bb.minX) && isFinite(bb.maxX) && bb.maxX > bb.minX
}
