/**
 * RenderContext — bundles all per-render state passed through the two-pass rendering loop.
 *
 * Replacing the 8-parameter function signatures in renderElements_pass1/pass2.
 * Handlers in SVGRendererRegistry receive a RenderContext and return an ElementRenderResult.
 */

import { ResolvedStyle } from '../../ir/types.js'
import { CoordResolver } from '../core/coordResolver.js'
import { NodeGeometryRegistry } from '../core/coordResolver.js'
import { BoundingBox } from '../core/boundingBox.js'
import { MarkerRegistry } from './markerDefs.js'
import { PatternRegistry } from './patternDefs.js'
import { MathRenderer } from '../../math/index.js'
import { SVGRenderingConstants } from './constants.js'
import type { SVGRendererRegistry } from './rendererRegistry.js'

// ── Output type ───────────────────────────────────────────────────────────────

/**
 * The output of a single IR element handler.
 * Elements are split into two layers matching SVG render order:
 *   pathElements — rendered first (behind nodes)
 *   nodeElements — rendered last (in front)
 */
export interface ElementRenderResult {
  /** SVG elements for the path layer (arrows, stroked paths, edges). */
  pathElements: Element[]
  /** SVG elements for the node layer (shapes, labels). */
  nodeElements: Element[]
  /** Bounding boxes of all rendered geometry (for viewBox computation). */
  bboxes: BoundingBox[]
  /** <clipPath> elements that must be placed inside <defs>. */
  clipDefs?: Element[]
}

// ── Context type ──────────────────────────────────────────────────────────────

/**
 * All state needed to render one IR element.
 * Passed by the rendering loop to each handler in SVGRendererRegistry.
 */
export interface RenderContext {
  document: Document
  coordResolver: CoordResolver
  nodeRegistry: NodeGeometryRegistry
  markerRegistry: MarkerRegistry
  patternRegistry: PatternRegistry
  mathRenderer: MathRenderer
  constants: SVGRenderingConstants
  /** Style inherited from enclosing scopes. */
  inheritedStyle: ResolvedStyle
  /** Handler registry — allows per-kind rendering to be overridden. */
  registry: SVGRendererRegistry
  /** Current rendering pass (1 = nodes/matrices, 2 = paths/edges). */
  pass: 1 | 2
}
