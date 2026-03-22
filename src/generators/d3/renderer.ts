/**
 * D3 SVG renderer — renders IRDiagram to interactive SVG using the existing SVG generator,
 * then enhances it with D3 data binding for interactivity.
 *
 * Strategy: instead of reimplementing all the rendering logic (node shapes, math labels,
 * edge routing, etc.), we reuse the existing SVG generator's string output, inject it
 * into the DOM, and attach `data-ir-id` attributes to enable D3 interactions.
 *
 * The existing SVG generator already produces high-quality output; the D3 layer adds
 * selection, dragging, and mutation on top.
 */

import * as d3 from 'd3-selection'
import type { IRDiagram, IRNode, ResolvedStyle } from '../../ir/types.js'
import { generateSVG, SVGGeneratorOptions } from '../svg/index.js'
import { CoordResolver, NodeGeometryRegistry, ptToPx, pxToPt, DEFAULT_NODE_DISTANCE_PT, DEFAULT_COORD_UNIT_PT } from '../core/coordResolver.js'
import { DEFAULT_CONSTANTS } from '../svg/constants.js'
import { collectNodes, isDraggable } from './irMutator.js'

export interface RenderResult {
  /** The SVG element inserted into the container. */
  svgElement: SVGSVGElement
  /** Map from IR element id to SVG element. */
  elementMap: Map<string, SVGElement>
  /** CoordResolver used (for px↔pt conversion during drag). */
  coordResolver: CoordResolver
}

/**
 * Render an IRDiagram into the given container using the existing SVG generator,
 * then tag each element with `data-ir-id` for D3 interactivity.
 */
export function renderDiagram(
  container: HTMLElement,
  diagram: IRDiagram,
  svgOpts: SVGGeneratorOptions = {},
): RenderResult {
  // Generate SVG string using the standard generator
  const document = svgOpts.document ?? container.ownerDocument
  const svgString = generateSVG(diagram, { ...svgOpts, document })

  // Insert into container
  container.innerHTML = svgString

  const svgElement = container.querySelector('svg') as SVGSVGElement

  // Make SVG fill container
  if (svgElement) {
    svgElement.style.width = '100%'
    svgElement.style.height = '100%'
  }

  // Build element map by tagging SVG groups with IR element ids.
  // The SVG generator emits nodes as <g> elements. We can correlate them
  // by matching node labels or positions.
  const elementMap = new Map<string, SVGElement>()
  tagElements(svgElement, diagram, elementMap)

  // Build a CoordResolver for px↔pt conversion during drag
  const globalStyle: ResolvedStyle = diagram.globalStyle ?? {}
  const coordScale = globalStyle.scale ?? 1
  const xScale = globalStyle.xUnit !== undefined ? globalStyle.xUnit / DEFAULT_COORD_UNIT_PT : 1
  const yScale = globalStyle.yUnit !== undefined ? globalStyle.yUnit / DEFAULT_COORD_UNIT_PT : 1
  const coordXScale = (globalStyle.xscale ?? 1) * xScale
  const coordYScale = (globalStyle.yscale ?? 1) * yScale
  const nodeDistancePt = globalStyle.nodeDistance ?? DEFAULT_NODE_DISTANCE_PT
  const nodeRegistry = new NodeGeometryRegistry()
  const coordResolver = new CoordResolver(nodeRegistry, coordScale, nodeDistancePt, coordXScale, coordYScale)

  return { svgElement, elementMap, coordResolver }
}

/**
 * Tag SVG elements with data-ir-id attributes by correlating
 * positions with the node geometry from the IR.
 *
 * The SVG generator renders nodes as <g> groups containing shapes + text.
 * We identify them by examining the transform attribute and matching
 * against resolved node positions.
 */
function tagElements(
  svgElement: SVGSVGElement,
  diagram: IRDiagram,
  elementMap: Map<string, SVGElement>,
): void {
  if (!svgElement) return

  const allNodes = collectNodes(diagram.elements)

  // Build a temporary coord resolver to get pixel positions
  const globalStyle: ResolvedStyle = diagram.globalStyle ?? {}
  const coordScale = globalStyle.scale ?? 1
  const xScale = globalStyle.xUnit !== undefined ? globalStyle.xUnit / DEFAULT_COORD_UNIT_PT : 1
  const yScale = globalStyle.yUnit !== undefined ? globalStyle.yUnit / DEFAULT_COORD_UNIT_PT : 1
  const coordXScale = (globalStyle.xscale ?? 1) * xScale
  const coordYScale = (globalStyle.yscale ?? 1) * yScale
  const nodeDistancePt = globalStyle.nodeDistance ?? DEFAULT_NODE_DISTANCE_PT
  const nodeRegistry = new NodeGeometryRegistry()
  const resolver = new CoordResolver(nodeRegistry, coordScale, nodeDistancePt, coordXScale, coordYScale)

  // Collect expected pixel positions for each node
  const nodePositions: Array<{ node: IRNode; px: number; py: number }> = []
  for (const node of allNodes) {
    if (node.position.coord.cs === 'xy') {
      try {
        const pt = resolver.resolve(node.position)
        nodePositions.push({ node, px: pt.x, py: pt.y })
      } catch {
        // Skip nodes with unresolvable coordinates
      }
    }
  }

  // Find all <g> elements with translate transforms and match to nodes
  const gElements = svgElement.querySelectorAll('g[transform]')
  for (const g of Array.from(gElements)) {
    const transform = g.getAttribute('transform') || ''
    const match = transform.match(/translate\(\s*([+-]?[\d.]+)\s*,\s*([+-]?[\d.]+)\s*\)/)
    if (!match) continue
    const gx = parseFloat(match[1])
    const gy = parseFloat(match[2])

    // Find the closest matching node
    let bestDist = 1.5 // tolerance in pixels
    let bestNode: IRNode | null = null
    for (const { node, px, py } of nodePositions) {
      const dist = Math.sqrt((gx - px) ** 2 + (gy - py) ** 2)
      if (dist < bestDist) {
        bestDist = dist
        bestNode = node
      }
    }
    if (bestNode) {
      const svgG = g as SVGElement
      svgG.setAttribute('data-ir-id', bestNode.id)
      svgG.setAttribute('data-ir-kind', 'node')
      if (isDraggable(bestNode)) {
        svgG.classList.add('d3-draggable')
      } else {
        svgG.classList.add('d3-locked')
      }
      elementMap.set(bestNode.id, svgG)
    }
  }
}
