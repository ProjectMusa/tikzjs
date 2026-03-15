/**
 * SVGRendererRegistry — per-kind handler table for the two-pass SVG rendering loop.
 *
 * Each handler receives a narrowed IR element and a RenderContext, and returns
 * an ElementRenderResult (or null if the element produces no output in this pass).
 *
 * The default registry wraps the existing emitter functions. Consumers can
 * override individual kinds by spreading: { ...defaultSVGRegistry, node: myHandler }
 */

import {
  IRNode,
  IRPath,
  IREdge,
  IRMatrix,
  IRScope,
  IRNamedCoordinate,
} from '../../ir/types.js'
import { ElementRenderResult, RenderContext } from './renderContext.js'
import { mergeStyles } from './styleEmitter.js'
import { emitNode } from './nodeEmitter.js'
import { emitPath } from './pathEmitter.js'
import { emitEdge } from './edgeEmitter.js'
import { emitMatrix } from './matrixEmitter.js'
import { ensurePattern } from './patternDefs.js'
import { mathModeRenderer } from '../../math/index.js'

// ── Handler type aliases ──────────────────────────────────────────────────────

export type NodeHandler       = (el: IRNode,            ctx: RenderContext) => ElementRenderResult | null
export type PathHandler       = (el: IRPath,            ctx: RenderContext) => ElementRenderResult | null
export type EdgeHandler       = (el: IREdge,            ctx: RenderContext) => ElementRenderResult | null
export type MatrixHandler     = (el: IRMatrix,          ctx: RenderContext) => ElementRenderResult | null
export type ScopeHandler      = (el: IRScope,           ctx: RenderContext) => ElementRenderResult | null
export type CoordinateHandler = (el: IRNamedCoordinate, ctx: RenderContext) => ElementRenderResult | null

// ── Registry interface ────────────────────────────────────────────────────────

/**
 * One typed handler per IR element kind.
 * Handlers return null when the element has no output in the current pass.
 */
export interface SVGRendererRegistry {
  node:            NodeHandler
  path:            PathHandler
  edge:            EdgeHandler
  'tikzcd-arrow':  EdgeHandler
  matrix:          MatrixHandler
  scope:           ScopeHandler
  coordinate:      CoordinateHandler
}

// ── Default handlers (wrap existing emitter functions) ────────────────────────

const defaultNodeHandler: NodeHandler = (el, ctx) => {
  if (ctx.pass !== 1) return null
  const merged = { ...el, style: mergeStyles(ctx.inheritedStyle, el.style) }
  const result = emitNode(merged, ctx.document, ctx.coordResolver, ctx.nodeRegistry, ctx.mathRenderer, ctx.constants)
  return { pathElements: [], nodeElements: [result.element], bboxes: [result.bbox] }
}

const defaultMatrixHandler: MatrixHandler = (el, ctx) => {
  if (ctx.pass !== 1) return null
  const result = emitMatrix(el, ctx.document, ctx.coordResolver, ctx.nodeRegistry, mathModeRenderer, ctx.constants)
  return { pathElements: [], nodeElements: result.elements, bboxes: [result.bbox] }
}

const defaultPathHandler: PathHandler = (el, ctx) => {
  if (ctx.pass === 1) {
    // Pass 1: register inline nodes so their geometry is available for anchor resolution in pass 2.
    if (el.inlineNodes.length === 0) return null
    const acc: ElementRenderResult = { pathElements: [], nodeElements: [], bboxes: [] }
    for (const node of el.inlineNodes) {
      const merged = { ...node, style: mergeStyles(ctx.inheritedStyle, node.style) }
      const r = emitNode(merged, ctx.document, ctx.coordResolver.clone(), ctx.nodeRegistry, ctx.mathRenderer, ctx.constants)
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
  const result = emitEdge(merged, ctx.document, ctx.nodeRegistry, ctx.markerRegistry, ctx.mathRenderer, ctx.constants)
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
  const accum: ElementRenderResult = { pathElements: [], nodeElements: [], bboxes: [] }
  for (const child of el.children) {
    const handler = childCtx.registry[child.kind as keyof SVGRendererRegistry]
    if (!handler) continue
    const result = (handler as (el: typeof child, ctx: RenderContext) => ElementRenderResult | null)(child, childCtx)
    if (result) {
      accum.pathElements.push(...result.pathElements)
      accum.nodeElements.push(...result.nodeElements)
      accum.bboxes.push(...result.bboxes)
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
  return null  // coordinates contribute no visible elements
}

// ── Inline-node handling for paths ────────────────────────────────────────────

/**
 * The path handler above only handles pass 2. Inline nodes (nodes declared
 * inside a path) must be registered in pass 1. This is handled separately in
 * the renderPass loop in index.ts, which peeks at path.inlineNodes in pass 1.
 */

// ── Default registry export ───────────────────────────────────────────────────

export const defaultSVGRegistry: SVGRendererRegistry = {
  node:           defaultNodeHandler,
  path:           defaultPathHandler,
  edge:           defaultEdgeHandler,
  'tikzcd-arrow': defaultEdgeHandler,
  matrix:         defaultMatrixHandler,
  scope:          defaultScopeHandler,
  coordinate:     defaultCoordinateHandler,
}
