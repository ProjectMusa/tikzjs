/**
 * D3 Element Handlers — per-IR-kind handler architecture barrel export.
 */

export type { D3ElementHandler, HighlightContext, HighlightResult, DragDelta, MutationDef, KeyAction, ListSummary, TreeChild, EditorField } from './types.js'
export type { D3ElementHandlerRegistry } from './registry.js'
export { defaultD3Registry } from './registry.js'
export { nodeHandler } from './nodeHandler.js'
export { pathHandler } from './pathHandler.js'
export { edgeHandler } from './edgeHandler.js'
export { matrixHandler, scopeHandler, coordinateHandler, knotHandler } from './simpleHandlers.js'
