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

import {
  IRDiagram,
  IRElement,
  IRNode,
  IRPath,
  IRScope,
  IRMatrix,
  IREdge,
  IRTikzcdArrow,
  IRNamedCoordinate,
} from '../../ir/types.js'
import { CoordResolver, NodeGeometryRegistry } from './coordResolver.js'
import { MarkerRegistry, renderMarkerDefs } from './markerDefs.js'
import { emitNode } from './nodeEmitter.js'
import { emitPath } from './pathEmitter.js'
import { emitEdge } from './edgeEmitter.js'
import { emitMatrix } from './matrixEmitter.js'
import { BoundingBox, mergeBBoxes, padBBox, toViewBox, isValidBBox } from './boundingBox.js'

const { JSDOM } = require('jsdom')

/** Padding around the diagram content (px). */
const PADDING_PX = 20

export interface SVGGeneratorOptions {
  padding?: number
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

  const allElements: Element[] = []
  const allBBoxes: BoundingBox[] = []

  // Two-pass rendering:
  // Pass 1: render matrices and standalone nodes (populates nodeRegistry)
  // Pass 2: render paths and edges (use nodeRegistry for anchor resolution)

  renderElements_pass1(
    diagram.elements,
    document,
    coordResolver,
    nodeRegistry,
    markerRegistry,
    allElements,
    allBBoxes
  )

  renderElements_pass2(
    diagram.elements,
    document,
    coordResolver,
    nodeRegistry,
    markerRegistry,
    allElements,
    allBBoxes
  )

  // Compute viewBox
  const padding = opts.padding ?? PADDING_PX
  const rawBBox = mergeBBoxes(allBBoxes)
  const viewBox = isValidBBox(rawBBox)
    ? toViewBox(padBBox(rawBBox, padding))
    : `-${padding} -${padding} ${padding * 2 + 100} ${padding * 2 + 100}`

  // Build SVG root
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  svg.setAttribute('viewBox', viewBox)

  // Add <defs> with marker definitions if any
  if (markerRegistry.size > 0) {
    const defs = renderMarkerDefs(document, markerRegistry)
    svg.appendChild(defs)
  }

  // Append all rendered elements in order
  for (const el of allElements) {
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
  markerRegistry: MarkerRegistry,
  outElements: Element[],
  outBBoxes: BoundingBox[]
): void {
  for (const el of elements) {
    switch (el.kind) {
      case 'matrix': {
        const result = emitMatrix(el, document, resolver, nodeRegistry)
        outElements.push(...result.elements)
        outBBoxes.push(result.bbox)
        break
      }

      case 'node': {
        const result = emitNode(el, document, resolver, nodeRegistry)
        outElements.push(result.element)
        outBBoxes.push(result.bbox)
        break
      }

      case 'scope': {
        // Recurse into scope children for pass 1
        renderElements_pass1(
          el.children,
          document,
          resolver.clone(),
          nodeRegistry,
          markerRegistry,
          outElements,
          outBBoxes
        )
        break
      }

      case 'coordinate': {
        // Named coordinates: resolve and register but don't emit anything
        resolver.resolve(el.position)
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
  outElements: Element[],
  outBBoxes: BoundingBox[]
): void {
  for (const el of elements) {
    switch (el.kind) {
      case 'path': {
        const result = emitPath(el, document, resolver.clone(), nodeRegistry, markerRegistry)
        // Insert paths BEFORE nodes (so nodes appear on top)
        // We'll manage ordering by inserting at start
        outElements.unshift(...result.elements)
        outBBoxes.push(result.bbox)
        break
      }

      case 'edge': {
        const result = emitEdge(el, document, nodeRegistry, markerRegistry)
        outElements.unshift(...result.elements)
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
          outElements,
          outBBoxes
        )
        break
      }
    }
  }
}
