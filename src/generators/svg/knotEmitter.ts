/**
 * Knot emitter: renders IRKnot elements with over/under crossing effects.
 *
 * Technique (mirrors the `knots` TikZ library):
 *   1. Draw all strands in black.
 *   2. For each crossing, determine the over-strand (first strand by default;
 *      flipped if the crossing index is in flipCrossings).
 *   3. At each crossing, clip a thick white stroke over the over-strand's bezier
 *      (erasing both strands in that region), then clip a thin black stroke to
 *      restore the over-strand — leaving a gap in the under-strand.
 *
 * Clip regions are SVG <clipPath> circles centred on the crossing point.
 */

import { IRKnot, IRKnotBezier, IRKnotStrand } from '../../ir/types.js'
import { ptToPx } from './coordResolver.js'
import { ResolvedStyle } from '../../ir/types.js'
import { BoundingBox, mergeBBoxes, fromCorners } from './boundingBox.js'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface KnotRenderResult {
  /** Path-layer elements (strands + clip effects). */
  elements: Element[]
  /** <clipPath> defs elements — must be inserted into <defs>. */
  clipDefs: Element[]
  bbox: BoundingBox
}

// ── Cubic bezier utilities ────────────────────────────────────────────────────

/** Flat representation: [x0,y0, cx1,cy1, cx2,cy2, x3,y3] */
type CubicPts = [number, number, number, number, number, number, number, number]

/** Evaluate point on cubic bezier at t ∈ [0,1]. */
function cubicAt(p: CubicPts, t: number): { x: number; y: number } {
  const mt = 1 - t
  const mt2 = mt * mt, t2 = t * t
  const mt3 = mt2 * mt, t3 = t2 * t
  return {
    x: mt3 * p[0] + 3 * mt2 * t * p[2] + 3 * mt * t2 * p[4] + t3 * p[6],
    y: mt3 * p[1] + 3 * mt2 * t * p[3] + 3 * mt * t2 * p[5] + t3 * p[7],
  }
}

/** Tight axis-aligned bounding box of a cubic bezier (uses convex hull property). */
function cubicBBox(p: CubicPts): { minX: number; maxX: number; minY: number; maxY: number } {
  // Sample 16 points for a fast tight bbox (good enough for intersection)
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (let i = 0; i <= 16; i++) {
    const { x, y } = cubicAt(p, i / 16)
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  return { minX, maxX, minY, maxY }
}

/** Subdivide cubic bezier at t=0.5 using de Casteljau. Returns [left, right]. */
function subdivide(p: CubicPts): [CubicPts, CubicPts] {
  const [x0, y0, x1, y1, x2, y2, x3, y3] = p
  const mx01x = (x0 + x1) / 2, mx01y = (y0 + y1) / 2
  const mx12x = (x1 + x2) / 2, mx12y = (y1 + y2) / 2
  const mx23x = (x2 + x3) / 2, mx23y = (y2 + y3) / 2
  const mx012x = (mx01x + mx12x) / 2, mx012y = (mx01y + mx12y) / 2
  const mx123x = (mx12x + mx23x) / 2, mx123y = (mx12y + mx23y) / 2
  const mx0123x = (mx012x + mx123x) / 2, mx0123y = (mx012y + mx123y) / 2
  return [
    [x0, y0, mx01x, mx01y, mx012x, mx012y, mx0123x, mx0123y],
    [mx0123x, mx0123y, mx123x, mx123y, mx23x, mx23y, x3, y3],
  ]
}

/** Recursive subdivision intersection finder.
 *  Returns t-values on curve a where it intersects curve b. */
function findIntersections(
  a: CubicPts, b: CubicPts,
  t0 = 0, t1 = 1,
  depth = 0,
  results: Array<{ t: number; x: number; y: number }> = [],
  epsilon = 0.5,   // px: stop when bbox diagonal < this
): Array<{ t: number; x: number; y: number }> {
  const ba = cubicBBox(a), bb = cubicBBox(b)
  // Bail if bboxes don't overlap
  if (ba.maxX < bb.minX || bb.maxX < ba.minX || ba.maxY < bb.minY || bb.maxY < ba.minY) return results
  // Converged: record midpoint
  const sizeA = Math.hypot(ba.maxX - ba.minX, ba.maxY - ba.minY)
  const sizeB = Math.hypot(bb.maxX - bb.minX, bb.maxY - bb.minY)
  if (depth > 20 || (sizeA < epsilon && sizeB < epsilon)) {
    const tMid = (t0 + t1) / 2
    const pt = cubicAt(a, 0.5)
    // Deduplicate: skip if we already have a close result
    for (const r of results) {
      if (Math.abs(r.t - tMid) < 0.01 || Math.hypot(r.x - pt.x, r.y - pt.y) < epsilon * 2) return results
    }
    results.push({ t: tMid, x: pt.x, y: pt.y })
    return results
  }
  const [aL, aR] = subdivide(a)
  const [bL, bR] = subdivide(b)
  const tM = (t0 + t1) / 2
  findIntersections(aL, bL, t0, tM, depth + 1, results, epsilon)
  findIntersections(aL, bR, t0, tM, depth + 1, results, epsilon)
  findIntersections(aR, bL, tM, t1, depth + 1, results, epsilon)
  findIntersections(aR, bR, tM, t1, depth + 1, results, epsilon)
  return results
}

/** Convert IRKnotBezier to flat pixel-space CubicPts. */
function toCubicPts(seg: IRKnotBezier, scale: number, xOff: number, yOff: number): CubicPts {
  return [
    ptToPx(seg.x0  * scale) + xOff, -ptToPx(seg.y0  * scale) + yOff,
    ptToPx(seg.cx1 * scale) + xOff, -ptToPx(seg.cy1 * scale) + yOff,
    ptToPx(seg.cx2 * scale) + xOff, -ptToPx(seg.cy2 * scale) + yOff,
    ptToPx(seg.x3  * scale) + xOff, -ptToPx(seg.y3  * scale) + yOff,
  ]
}

// ── SVG helpers ───────────────────────────────────────────────────────────────

let _clipId = 0

const SVG_NS = 'http://www.w3.org/2000/svg'

function makeClipCircle(document: Document, cx: number, cy: number, r: number): { id: string; el: Element } {
  const id = `tikzjs-knot-clip-${_clipId++}`
  const clipPath = document.createElementNS(SVG_NS, 'clipPath')
  clipPath.setAttribute('id', id)
  const circle = document.createElementNS(SVG_NS, 'circle')
  circle.setAttribute('cx', String(cx))
  circle.setAttribute('cy', String(cy))
  circle.setAttribute('r', String(r))
  clipPath.appendChild(circle)
  return { id, el: clipPath }
}

function makeSVGPath(document: Document, d: string, stroke: string, strokeWidth: number, clipId?: string): Element {
  const el = document.createElementNS(SVG_NS, 'path')
  el.setAttribute('d', d)
  el.setAttribute('stroke', stroke)
  el.setAttribute('stroke-width', String(strokeWidth))
  el.setAttribute('fill', 'none')
  el.setAttribute('stroke-miterlimit', '10')
  if (clipId) el.setAttribute('clip-path', `url(#${clipId})`)
  return el
}

/** Convert one IRKnotBezier (pt) to an SVG cubic bezier path string. */
function bezToD(seg: IRKnotBezier, scale: number, xOff: number, yOff: number): string {
  const x0  = ptToPx(seg.x0  * scale) + xOff, y0  = -ptToPx(seg.y0  * scale) + yOff
  const cx1 = ptToPx(seg.cx1 * scale) + xOff, cy1 = -ptToPx(seg.cy1 * scale) + yOff
  const cx2 = ptToPx(seg.cx2 * scale) + xOff, cy2 = -ptToPx(seg.cy2 * scale) + yOff
  const x3  = ptToPx(seg.x3  * scale) + xOff, y3  = -ptToPx(seg.y3  * scale) + yOff
  return `M ${x0} ${y0} C ${cx1} ${cy1} ${cx2} ${cy2} ${x3} ${y3}`
}

// ── Main emitter ──────────────────────────────────────────────────────────────

export function emitKnot(
  knot: IRKnot,
  document: Document,
  inheritedStyle: ResolvedStyle,
  coordScale: number,
): KnotRenderResult {
  const elements: Element[] = []
  const clipDefs: Element[] = []
  const bboxes: BoundingBox[] = []

  // Coordinate offsets from scope xshift/yshift (already scaled by coordScale
  // in buildTransform, so we apply the same formula here).
  const xOff = ptToPx((inheritedStyle.xshift ?? 0) * coordScale)
  const yOff = -ptToPx((inheritedStyle.yshift ?? 0) * coordScale)

  // ── Step 1: draw all strands in black ────────────────────────────────────

  for (const strand of knot.strands) {
    const sw = ptToPx(strand.drawWidth)   // stroke width not scaled by coordScale (TikZ behaviour)
    for (const seg of strand.segments) {
      const d = bezToD(seg, coordScale, xOff, yOff)
      elements.push(makeSVGPath(document, d, 'currentColor', sw))
      // Approximate bbox from endpoints
      const x0 = ptToPx(seg.x0 * coordScale) + xOff, y0 = -ptToPx(seg.y0 * coordScale) + yOff
      const x3 = ptToPx(seg.x3 * coordScale) + xOff, y3 = -ptToPx(seg.y3 * coordScale) + yOff
      bboxes.push(fromCorners(Math.min(x0, x3) - sw, Math.min(y0, y3) - sw,
                               Math.max(x0, x3) + sw, Math.max(y0, y3) + sw))
    }
  }

  // ── Step 2: crossing effects ──────────────────────────────────────────────

  let crossingIndex = 0

  for (let i = 0; i < knot.strands.length; i++) {
    for (let j = i + 1; j < knot.strands.length; j++) {
      for (const segI of knot.strands[i].segments) {
        for (const segJ of knot.strands[j].segments) {
          const ptsI = toCubicPts(segI, coordScale, xOff, yOff)
          const ptsJ = toCubicPts(segJ, coordScale, xOff, yOff)

          const intersections = findIntersections(ptsI, ptsJ)
          if (intersections.length === 0) continue

          for (const isect of intersections) {
            // Determine over-strand: first strand (i) by default; flip if flagged.
            const flipped = knot.flipCrossings.includes(crossingIndex)
            const overStrand: IRKnotStrand = flipped ? knot.strands[j] : knot.strands[i]
            const overSeg: IRKnotBezier   = flipped ? segJ : segI

            const sw      = ptToPx(overStrand.drawWidth)
            const whiteSW = sw * knot.clipWidth          // thick white erases the crossing gap
            const innerR  = whiteSW * 2.5                // clip for white stroke
            const outerR  = whiteSW * 3.0                // clip for black restore

            const overD = bezToD(overSeg, coordScale, xOff, yOff)

            const inner = makeClipCircle(document, isect.x, isect.y, innerR)
            const outer = makeClipCircle(document, isect.x, isect.y, outerR)
            clipDefs.push(inner.el, outer.el)

            // White stroke (erase both strands at crossing)
            elements.push(makeSVGPath(document, overD, '#ffffff', whiteSW, inner.id))
            // Black stroke (restore over-strand)
            elements.push(makeSVGPath(document, overD, 'currentColor', sw, outer.id))

            crossingIndex++
          }
        }
      }
    }
  }

  // Wrap all elements in a group tagged for D3 interactivity
  const g = document.createElementNS(SVG_NS, 'g')
  g.setAttribute('data-ir-id', knot.id)
  g.setAttribute('data-ir-kind', 'knot')
  for (const el of elements) g.appendChild(el)

  return { elements: [g], clipDefs, bbox: mergeBBoxes(bboxes) }
}
