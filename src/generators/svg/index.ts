/**
 * SVG generator entrypoint.
 *
 * Takes an IRDiagram and produces an SVG string.
 *
 * Rendering pipeline:
 * 1. Walk the element list in document order
 * 2. For each IRMatrix: render via matrixEmitter (also populates nodeRegistry)
 * 3. For each IRNode: render via nodeEmitter (populates nodeRegistry)
 * 4. For each IRPath: render via pathEmitter
 * 5. For each IREdge/IRTikzcdArrow: render via edgeEmitter
 * 6. For each IRScope: recurse into children
 * 7. Compute bounding box from all elements
 * 8. Emit <defs> with marker definitions
 * 9. Wrap in <svg> with viewBox
 */

import { IRDiagram, IRElement, ResolvedStyle } from '../../ir/types.js'
import { CoordResolver, NodeGeometryRegistry, ptToPx, pxToPt, DEFAULT_NODE_DISTANCE_PT } from './coordResolver.js'
import { MarkerRegistry, renderMarkerDefs } from './markerDefs.js'
import { BoundingBox, mergeBBoxes, padBBox, toViewBox, isValidBBox } from './boundingBox.js'
import { MathRenderer, defaultMathRenderer } from '../../math/index.js'
import { DEFAULT_CONSTANTS, SVGRenderingConstants } from './constants.js'
import { RenderContext, ElementRenderResult } from './renderContext.js'
import { SVGRendererRegistry, defaultSVGRegistry } from './rendererRegistry.js'

const { JSDOM } = require('jsdom')

export interface SVGGeneratorOptions {
  padding?: number
  /** Custom math renderer. Defaults to MathJax server-side rendering. */
  mathRenderer?: MathRenderer
  /** Override generator-level rendering constants (scale, gaps, padding, etc.). */
  constants?: Partial<SVGRenderingConstants>
  /** Override individual element-kind handlers. */
  registry?: Partial<SVGRendererRegistry>
}

/**
 * Generate an SVG string from an IRDiagram.
 */
export function generateSVG(diagram: IRDiagram, opts: SVGGeneratorOptions = {}): string {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>')
  const document = dom.window.document

  const C: SVGRenderingConstants = { ...DEFAULT_CONSTANTS, ...(opts.constants ?? {}) }
  const nodeRegistry = new NodeGeometryRegistry()
  const markerRegistry: MarkerRegistry = new Map()
  const mathRenderer = opts.mathRenderer ?? defaultMathRenderer
  const registry: SVGRendererRegistry = { ...defaultSVGRegistry, ...(opts.registry ?? {}) }

  const globalStyle: ResolvedStyle = diagram.globalStyle ?? {}

  // The tikzpicture-level `scale` is a coordinate transform (scales all positions),
  // not a visual node scale. Extract it for the CoordResolver and strip it from the
  // inherited style so it doesn't bleed into per-node visual scaling.
  const coordScale = globalStyle.scale ?? 1
  const inheritedStyle: ResolvedStyle = coordScale !== 1
    ? { ...globalStyle, scale: undefined }
    : globalStyle

  const nodeDistancePt = globalStyle.nodeDistance ?? DEFAULT_NODE_DISTANCE_PT
  const coordResolver = new CoordResolver(nodeRegistry, coordScale, nodeDistancePt)

  const baseCtx: RenderContext = {
    document,
    coordResolver,
    nodeRegistry,
    markerRegistry,
    mathRenderer,
    constants: C,
    inheritedStyle,
    registry,
    pass: 1,
  }

  const r1 = renderPass(diagram.elements, { ...baseCtx, pass: 1 })
  const r2 = renderPass(diagram.elements, { ...baseCtx, pass: 2 })

  // Compute viewBox
  const padding = opts.padding ?? ptToPx(C.DIAGRAM_PADDING_PT)
  const allBBoxes: BoundingBox[] = [...r1.bboxes, ...r2.bboxes]
  const rawBBox = mergeBBoxes(allBBoxes)
  const viewBox = isValidBBox(rawBBox)
    ? toViewBox(padBBox(rawBBox, padding))
    : `-${padding} -${padding} ${padding * 2 + 100} ${padding * 2 + 100}`

  // Build SVG root — set width/height in pt so browsers render at the same physical
  // size as dvisvgm output (which also uses pt), enabling fair side-by-side comparison.
  const [, , vwStr, vhStr] = viewBox.split(' ')
  const widthPt  = pxToPt(parseFloat(vwStr))
  const heightPt = pxToPt(parseFloat(vhStr))

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  svg.setAttribute('width',   `${widthPt}pt`)
  svg.setAttribute('height',  `${heightPt}pt`)
  svg.setAttribute('viewBox', viewBox)

  // Add <defs> with marker definitions if any
  if (markerRegistry.size > 0) {
    const defs = renderMarkerDefs(document, markerRegistry)
    svg.appendChild(defs)
  }

  // Paths first (behind), then node groups (on top)
  for (const el of [...r2.pathElements, ...r1.nodeElements, ...r2.nodeElements]) {
    svg.appendChild(el)
  }

  return svg.outerHTML
}

// ── Unified render pass ───────────────────────────────────────────────────────

/**
 * Run one pass over the element list, dispatching each element to its registered handler.
 * Returns accumulated path elements, node elements, and bounding boxes.
 */
export function renderPass(elements: IRElement[], ctx: RenderContext): ElementRenderResult {
  const accum: ElementRenderResult = { pathElements: [], nodeElements: [], bboxes: [] }
  for (const el of elements) {
    const handler = ctx.registry[el.kind as keyof SVGRendererRegistry]
    if (!handler) continue
    const result = (handler as (el: IRElement, ctx: RenderContext) => ElementRenderResult | null)(el, ctx)
    if (result) {
      accum.pathElements.push(...result.pathElements)
      accum.nodeElements.push(...result.nodeElements)
      accum.bboxes.push(...result.bboxes)
    }
  }
  return accum
}
