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
import { CoordResolver, NodeGeometryRegistry, ptToPx, pxToPt } from './coordResolver.js'
import { MarkerRegistry, renderMarkerDefs } from './markerDefs.js'
import { emitNode } from './nodeEmitter.js'
import { emitPath } from './pathEmitter.js'
import { emitEdge } from './edgeEmitter.js'
import { emitMatrix } from './matrixEmitter.js'
import { BoundingBox, mergeBBoxes, padBBox, toViewBox, isValidBBox } from './boundingBox.js'
import { MathRenderer, defaultMathRenderer, mathModeRenderer } from '../../math/index.js'
import { mergeStyles } from './styleEmitter.js'

const { JSDOM } = require('jsdom')

/** Padding around the diagram content in px. ~2.4pt matches dvisvgm default margin. */
const PADDING_PX = ptToPx(2.4)

export interface SVGGeneratorOptions {
  padding?: number
  /** Custom math renderer. Defaults to MathJax server-side rendering. */
  mathRenderer?: MathRenderer
}

/**
 * Generate an SVG string from an IRDiagram.
 */
export function generateSVG(diagram: IRDiagram, opts: SVGGeneratorOptions = {}): string {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>')
  const document = dom.window.document

  const nodeRegistry = new NodeGeometryRegistry()
  const markerRegistry: MarkerRegistry = new Map()
  const coordResolver = new CoordResolver(nodeRegistry)
  const mathRenderer = opts.mathRenderer ?? defaultMathRenderer

  // Paths go first (behind), node groups go last (on top)
  const pathElements: Element[] = []
  const nodeElements: Element[] = []
  const allBBoxes: BoundingBox[] = []

  // Two-pass rendering:
  // Pass 1: render matrices and standalone/inline nodes → populate nodeRegistry
  // Pass 2: render paths and edges → use nodeRegistry for anchor resolution

  const globalStyle: ResolvedStyle = diagram.globalStyle ?? {}

  renderElements_pass1(
    diagram.elements,
    document,
    coordResolver,
    nodeRegistry,
    nodeElements,
    allBBoxes,
    mathRenderer,
    globalStyle
  )

  renderElements_pass2(
    diagram.elements,
    document,
    coordResolver,
    nodeRegistry,
    markerRegistry,
    pathElements,
    nodeElements,
    allBBoxes,
    mathRenderer,
    globalStyle
  )

  // Compute viewBox
  const padding = opts.padding ?? PADDING_PX
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
  for (const el of [...pathElements, ...nodeElements]) {
    svg.appendChild(el)
  }

  return svg.outerHTML
}

// ── Pass 1: matrices and standalone nodes ─────────────────────────────────────

function renderElements_pass1(
  elements: IRElement[],
  document: Document,
  resolver: CoordResolver,
  nodeRegistry: NodeGeometryRegistry,
  outNodeElements: Element[],
  outBBoxes: BoundingBox[],
  mathRenderer: MathRenderer,
  inherited: ResolvedStyle = {}
): void {
  for (const el of elements) {
    switch (el.kind) {
      case 'matrix': {
        const result = emitMatrix(el, document, resolver, nodeRegistry, mathModeRenderer)
        outNodeElements.push(...result.elements)
        outBBoxes.push(result.bbox)
        break
      }

      case 'node': {
        const merged = { ...el, style: mergeStyles(inherited, el.style) }
        const result = emitNode(merged, document, resolver, nodeRegistry, mathRenderer)
        outNodeElements.push(result.element)
        outBBoxes.push(result.bbox)
        break
      }

      case 'path': {
        // Register inline nodes so their geometry is available when paths reference their anchors.
        for (const node of el.inlineNodes) {
          const merged = { ...node, style: mergeStyles(inherited, node.style) }
          const result = emitNode(merged, document, resolver.clone(), nodeRegistry, mathRenderer)
          outNodeElements.push(result.element)
          outBBoxes.push(result.bbox)
        }
        break
      }

      case 'scope': {
        renderElements_pass1(
          el.children,
          document,
          resolver.clone(),
          nodeRegistry,
          outNodeElements,
          outBBoxes,
          mathRenderer,
          mergeStyles(inherited, el.style)
        )
        break
      }

      case 'coordinate': {
        const pt = resolver.resolve(el.position)
        // Register as zero-size point so (name) references in paths resolve correctly.
        nodeRegistry.register(el.id, el.name, {
          centerX: pt.x,
          centerY: pt.y,
          halfWidth: 0,
          halfHeight: 0,
          bbox: { minX: pt.x, minY: pt.y, maxX: pt.x, maxY: pt.y },
        })
        break
      }
    }
  }
}

// ── Pass 2: paths and edges ───────────────────────────────────────────────────

function renderElements_pass2(
  elements: IRElement[],
  document: Document,
  resolver: CoordResolver,
  nodeRegistry: NodeGeometryRegistry,
  markerRegistry: MarkerRegistry,
  outPathElements: Element[],
  outNodeElements: Element[],
  outBBoxes: BoundingBox[],
  mathRenderer: MathRenderer,
  inherited: ResolvedStyle = {}
): void {
  for (const el of elements) {
    switch (el.kind) {
      case 'path': {
        const merged = { ...el, style: mergeStyles(inherited, el.style) }
        const result = emitPath(merged, document, resolver.clone(), nodeRegistry, markerRegistry)
        outPathElements.push(...result.elements)
        outBBoxes.push(result.bbox)
        break
      }

      case 'edge': {
        const merged = { ...el, style: mergeStyles(inherited, el.style) }
        const result = emitEdge(merged, document, nodeRegistry, markerRegistry, mathRenderer)
        outPathElements.push(...result.elements)
        outBBoxes.push(result.bbox)
        break
      }

      case 'scope': {
        renderElements_pass2(
          el.children,
          document,
          resolver.clone(),
          nodeRegistry,
          markerRegistry,
          outPathElements,
          outNodeElements,
          outBBoxes,
          mathRenderer,
          mergeStyles(inherited, el.style)
        )
        break
      }
    }
  }
}
