/**
 * D3 Element Handler Registry — maps IR element kinds to their handlers.
 *
 * Each handler centralizes all D3 editor behavior for one IR kind:
 * click zones, highlights, drag preview, mutations, inspector UI.
 */

import type { IRNode, IRPath, IREdge, IRMatrix, IRScope, IRNamedCoordinate, IRKnot } from '../../../ir/types.js'
import type { D3ElementHandler } from './types.js'
import { nodeHandler } from './nodeHandler.js'
import { pathHandler } from './pathHandler.js'
import { edgeHandler } from './edgeHandler.js'
import { matrixHandler, scopeHandler, coordinateHandler, knotHandler } from './simpleHandlers.js'

// ── Registry Interface ───────────────────────────────────────────────────────

export interface D3ElementHandlerRegistry {
  node: D3ElementHandler<IRNode>
  path: D3ElementHandler<IRPath>
  edge: D3ElementHandler<IREdge>
  matrix: D3ElementHandler<IRMatrix>
  scope: D3ElementHandler<IRScope>
  coordinate: D3ElementHandler<IRNamedCoordinate>
  knot: D3ElementHandler<IRKnot>
}

// ── Default Registry ─────────────────────────────────────────────────────────

export const defaultD3Registry: D3ElementHandlerRegistry = {
  node: nodeHandler,
  path: pathHandler,
  edge: edgeHandler,
  matrix: matrixHandler,
  scope: scopeHandler,
  coordinate: coordinateHandler,
  knot: knotHandler,
}
