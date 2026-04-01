/**
 * SVGRendererRegistry — per-kind handler table for the two-pass SVG rendering loop.
 *
 * Each handler receives a narrowed IR element and a RenderContext, and returns
 * an ElementRenderResult (or null if the element produces no output in this pass).
 *
 * The default registry wraps the existing emitter functions. Consumers can
 * override individual kinds by spreading: { ...defaultSVGRegistry, node: myHandler }
 */

import { IRNode, IRPath, IREdge, IRMatrix, IRScope, IRNamedCoordinate, IRKnot, CoordRef } from '../../ir/types.js'
import { ElementRenderResult, RenderContext } from './renderContext.js'
import { mergeStyles } from './styleEmitter.js'
import { emitNode } from './nodeEmitter.js'
import { emitPath } from './pathEmitter.js'
import { emitEdge } from './edgeEmitter.js'
import { emitMatrix } from './matrixEmitter.js'
import { emitKnot } from './knotEmitter.js'
import { ensurePattern } from './patternDefs.js'
import { clipToNodeBoundary, ptToPx } from './coordResolver.js'

// ── Handler type aliases ──────────────────────────────────────────────────────

export type KnotHandler = (el: IRKnot, ctx: RenderContext) => ElementRenderResult | null
export type NodeHandler = (el: IRNode, ctx: RenderContext) => ElementRenderResult | null
export type PathHandler = (el: IRPath, ctx: RenderContext) => ElementRenderResult | null
export type EdgeHandler = (el: IREdge, ctx: RenderContext) => ElementRenderResult | null
export type MatrixHandler = (el: IRMatrix, ctx: RenderContext) => ElementRenderResult | null
export type ScopeHandler = (el: IRScope, ctx: RenderContext) => ElementRenderResult | null
export type CoordinateHandler = (el: IRNamedCoordinate, ctx: RenderContext) => ElementRenderResult | null

// ── Registry interface ────────────────────────────────────────────────────────

/**
 * One typed handler per IR element kind.
 * Handlers return null when the element has no output in the current pass.
 */
export interface SVGRendererRegistry {
  node: NodeHandler
  path: PathHandler
  edge: EdgeHandler
  'tikzcd-arrow': EdgeHandler
  matrix: MatrixHandler
  scope: ScopeHandler
  coordinate: CoordinateHandler
  knot: KnotHandler
}

// ── Default handlers (wrap existing emitter functions) ────────────────────────

const defaultNodeHandler: NodeHandler = (el, ctx) => {
  if (ctx.pass !== 1) return null
  const merged = { ...el, style: mergeStyles(ctx.inheritedStyle, el.style) }
  const result = emitNode(
    merged,
    ctx.document,
    ctx.coordResolver,
    ctx.nodeRegistry,
    ctx.mathRenderer,
    ctx.constants,
    ctx.textMeasurer,
  )
  return { pathElements: [], nodeElements: [result.element], bboxes: [result.bbox] }
}

const defaultMatrixHandler: MatrixHandler = (el, ctx) => {
  if (ctx.pass !== 1) return null
  const result = emitMatrix(el, ctx.document, ctx.coordResolver, ctx.nodeRegistry, ctx.mathModeRenderer, ctx.constants)
  return { pathElements: [], nodeElements: result.elements, bboxes: [result.bbox] }
}

// ── Inline node position adjustment ──────────────────────────────────────────

/**
 * For inline nodes on straight-line paths (move → node-on-path → line),
 * recompute the node position as the midpoint of the clipped (boundary)
 * endpoints rather than the midpoint of node centers.
 *
 * This ensures labels like "g ∘ f" sit in the middle of the visible arrow
 * rather than being shifted toward the larger node.
 */
function computeClippedInlinePositions(path: IRPath, ctx: RenderContext): Map<string, CoordRef> {
  const result = new Map<string, CoordRef>()
  const segs = path.segments

  for (let i = 0; i < segs.length; i++) {
    if (segs[i].kind !== 'node-on-path') continue
    const nodeId = (segs[i] as { kind: 'node-on-path'; nodeId: string }).nodeId

    // Find preceding move/line segment and following line segment
    const prevSeg = i > 0 ? segs[i - 1] : null
    const nextSeg = i < segs.length - 1 ? segs[i + 1] : null
    if (!prevSeg || !nextSeg) continue

    // Get the from/to coordinates from adjacent segments
    const fromCoord = 'to' in prevSeg ? (prevSeg as { to: CoordRef }).to : null
    const toCoord = 'to' in nextSeg ? (nextSeg as { to: CoordRef }).to : null
    if (!fromCoord || !toCoord) continue

    // Resolve to pixel positions
    const resolver = ctx.coordResolver.clone()
    const fromPx = resolver.resolve(fromCoord)
    const toPx = resolver.resolve(toCoord)

    // Check if from/to reference named nodes and clip to boundaries
    const fromNodeName = fromCoord.coord && 'nodeName' in fromCoord.coord ? fromCoord.coord.nodeName : null
    const toNodeName = toCoord.coord && 'nodeName' in toCoord.coord ? toCoord.coord.nodeName : null

    let clippedFrom = fromPx
    let clippedTo = toPx

    if (fromNodeName) {
      const geo = ctx.nodeRegistry.getByName(fromNodeName)
      if (geo) clippedFrom = clipToNodeBoundary(toPx, fromPx, geo)
    }
    if (toNodeName) {
      const geo = ctx.nodeRegistry.getByName(toNodeName)
      if (geo) clippedTo = clipToNodeBoundary(fromPx, toPx, geo)
    }

    // Only adjust if clipping actually changed anything
    if (clippedFrom !== fromPx || clippedTo !== toPx) {
      const midX = (clippedFrom.x + clippedTo.x) / 2
      const midY = (clippedFrom.y + clippedTo.y) / 2
      // Convert pixel coords back to TikZ pt coords (reverse of resolveCoord for cs:'xy')
      // px = ptToPx(pt * coordScale * scale), so pt = px / ptToPx(1) / coordScale / scale
      // SVG y is inverted: pxY = -ptToPx(ptY * ...), so ptY = -pxY / ptToPx(1) / ...
      const pxPerPt = ptToPx(1)
      const cs = resolver.coordScale
      const xs = resolver.xScale
      const ys = resolver.yScale
      result.set(nodeId, {
        mode: 'absolute' as const,
        coord: {
          cs: 'xy' as const,
          x: midX / pxPerPt / cs / xs,
          y: -midY / pxPerPt / cs / ys,
        },
      })
    }
  }

  return result
}

const defaultPathHandler: PathHandler = (el, ctx) => {
  if (ctx.pass === 1) {
    // Pass 1: register inline nodes so their geometry is available for anchor resolution in pass 2.
    if (el.inlineNodes.length === 0) return null
    const acc: ElementRenderResult = { pathElements: [], nodeElements: [], bboxes: [] }

    // Build a map from nodeId → adjusted position (clipped midpoint instead of center midpoint)
    const adjustedPositions = computeClippedInlinePositions(el, ctx)

    for (const node of el.inlineNodes) {
      const adjustedPos = adjustedPositions.get(node.id)
      const adjustedNode = adjustedPos ? { ...node, position: adjustedPos } : node
      const merged = { ...adjustedNode, style: mergeStyles(ctx.inheritedStyle, adjustedNode.style) }
      const r = emitNode(
        merged,
        ctx.document,
        ctx.coordResolver.clone(),
        ctx.nodeRegistry,
        ctx.mathRenderer,
        ctx.constants,
        ctx.textMeasurer,
      )
      acc.nodeElements.push(r.element)
      acc.bboxes.push(r.bbox)
    }
    return acc
  }
  // Pass 2: render the path geometry.
  let mergedStyle = mergeStyles(ctx.inheritedStyle, el.style)

  // If a fill pattern is specified, register it and replace the fill with url(#id)
  const patternName = mergedStyle.extra?.['pattern']
  if (patternName) {
    const patId = ensurePattern(patternName, ctx.patternRegistry)
    if (patId) {
      mergedStyle = { ...mergedStyle, fill: `url(#${patId})` }
    }
  }

  const merged = { ...el, style: mergedStyle }
  const result = emitPath(merged, ctx.document, ctx.coordResolver.clone(), ctx.nodeRegistry, ctx.markerRegistry)
  return { pathElements: result.elements, nodeElements: [], bboxes: [result.bbox] }
}

const defaultEdgeHandler: EdgeHandler = (el, ctx) => {
  if (ctx.pass !== 2) return null
  const merged = { ...el, style: mergeStyles(ctx.inheritedStyle, el.style) }
  const result = emitEdge(
    merged,
    ctx.document,
    ctx.nodeRegistry,
    ctx.markerRegistry,
    ctx.mathRenderer,
    ctx.constants,
    ctx.scriptMathModeRenderer,
    ctx.textMeasurer,
  )
  return { pathElements: result.elements, nodeElements: [], bboxes: [result.bbox] }
}

/**
 * Scope handler: recurses into children with merged inherited style.
 * The accumulated result of all children is returned as a flat list.
 */
const defaultScopeHandler: ScopeHandler = (el, ctx) => {
  // Import renderPass lazily to avoid circular import (rendererRegistry ↔ index.ts)
  // The registry is used by index.ts which defines renderPass — inject via ctx.registry
  // We call the loop directly on ctx with updated inherited style and cloned resolver.
  const childCtx: RenderContext = {
    ...ctx,
    coordResolver: ctx.coordResolver.clone(),
    inheritedStyle: mergeStyles(ctx.inheritedStyle, el.style),
  }
  // We need access to the renderPass loop. Since renderPass is in index.ts, we store
  // the loop function in a registry-accessible way. For now, inline the loop here.
  const accum: ElementRenderResult = { pathElements: [], nodeElements: [], bboxes: [], clipDefs: [] }
  for (const child of el.children) {
    const handler = childCtx.registry[child.kind as keyof SVGRendererRegistry]
    if (!handler) continue
    const result = (handler as (el: typeof child, ctx: RenderContext) => ElementRenderResult | null)(child, childCtx)
    if (result) {
      accum.pathElements.push(...result.pathElements)
      accum.nodeElements.push(...result.nodeElements)
      accum.bboxes.push(...result.bboxes)
      if (result.clipDefs) accum.clipDefs!.push(...result.clipDefs)
    }
  }
  return accum
}

const defaultCoordinateHandler: CoordinateHandler = (el, ctx) => {
  if (ctx.pass !== 1) return null
  const pt = ctx.coordResolver.resolve(el.position)
  ctx.nodeRegistry.register(el.id, el.name, {
    centerX: pt.x,
    centerY: pt.y,
    halfWidth: 0,
    halfHeight: 0,
    bbox: { minX: pt.x, minY: pt.y, maxX: pt.x, maxY: pt.y },
  })
  return null // coordinates contribute no visible elements
}

// ── Inline-node handling for paths ────────────────────────────────────────────

/**
 * The path handler above only handles pass 2. Inline nodes (nodes declared
 * inside a path) must be registered in pass 1. This is handled separately in
 * the renderPass loop in index.ts, which peeks at path.inlineNodes in pass 1.
 */

const defaultKnotHandler: KnotHandler = (el, ctx) => {
  if (ctx.pass !== 2) return null
  const merged = { ...el, style: mergeStyles(ctx.inheritedStyle, el.style) }
  const result = emitKnot(merged, ctx.document, ctx.inheritedStyle, ctx.coordResolver.coordScale)
  return { pathElements: result.elements, nodeElements: [], bboxes: [result.bbox], clipDefs: result.clipDefs }
}

// ── Default registry export ───────────────────────────────────────────────────

export const defaultSVGRegistry: SVGRendererRegistry = {
  node: defaultNodeHandler,
  path: defaultPathHandler,
  edge: defaultEdgeHandler,
  'tikzcd-arrow': defaultEdgeHandler,
  matrix: defaultMatrixHandler,
  scope: defaultScopeHandler,
  coordinate: defaultCoordinateHandler,
  knot: defaultKnotHandler,
}
