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
import { DEFAULT_CONSTANTS, TIKZ_CONSTANTS } from '../svg/constants.js'
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

// ── Grid ──────────────────────────────────────────────────────────────────────

/**
 * Insert a coordinate grid into the SVG that shows TikZ pt unit positions.
 * Grid lines are drawn at 1cm intervals (28.4528 pt) with lighter lines
 * at 0.5cm. Labels show pt values along axes.
 */
export function insertGrid(svgElement: SVGSVGElement, visible = true): void {
  if (!svgElement) return

  const viewBox = svgElement.getAttribute('viewBox')
  if (!viewBox) return

  const [vbX, vbY, vbW, vbH] = viewBox.split(/\s+/).map(Number)

  // 1cm in px (the viewBox is in px units)
  const cmPx = DEFAULT_CONSTANTS.CM_TO_PX
  // Minor grid: 0.5cm
  const minorPx = cmPx / 2

  const ns = 'http://www.w3.org/2000/svg'
  const doc = svgElement.ownerDocument

  const gridGroup = doc.createElementNS(ns, 'g')
  gridGroup.setAttribute('class', 'd3-grid')
  if (!visible) gridGroup.style.display = 'none'

  // Extend grid well beyond the viewBox
  const margin = cmPx * 4
  const left = vbX - margin
  const right = vbX + vbW + margin
  const top = vbY - margin
  const bottom = vbY + vbH + margin

  // Minor grid lines (0.5cm intervals)
  const startXMinor = Math.floor(left / minorPx) * minorPx
  const startYMinor = Math.floor(top / minorPx) * minorPx

  for (let x = startXMinor; x <= right; x += minorPx) {
    const line = doc.createElementNS(ns, 'line')
    line.setAttribute('x1', String(x))
    line.setAttribute('y1', String(top))
    line.setAttribute('x2', String(x))
    line.setAttribute('y2', String(bottom))
    line.setAttribute('stroke', '#ccc')
    line.setAttribute('stroke-width', '0.3')
    line.setAttribute('stroke-opacity', '0.3')
    gridGroup.appendChild(line)
  }

  for (let y = startYMinor; y <= bottom; y += minorPx) {
    const line = doc.createElementNS(ns, 'line')
    line.setAttribute('x1', String(left))
    line.setAttribute('y1', String(y))
    line.setAttribute('x2', String(right))
    line.setAttribute('y2', String(y))
    line.setAttribute('stroke', '#ccc')
    line.setAttribute('stroke-width', '0.3')
    line.setAttribute('stroke-opacity', '0.3')
    gridGroup.appendChild(line)
  }

  // Major grid lines (1cm intervals) — thicker
  const startXMajor = Math.floor(left / cmPx) * cmPx
  const startYMajor = Math.floor(top / cmPx) * cmPx

  for (let x = startXMajor; x <= right; x += cmPx) {
    const line = doc.createElementNS(ns, 'line')
    line.setAttribute('x1', String(x))
    line.setAttribute('y1', String(top))
    line.setAttribute('x2', String(x))
    line.setAttribute('y2', String(bottom))
    line.setAttribute('stroke', '#999')
    line.setAttribute('stroke-width', '0.5')
    line.setAttribute('stroke-opacity', '0.4')
    gridGroup.appendChild(line)
  }

  for (let y = startYMajor; y <= bottom; y += cmPx) {
    const line = doc.createElementNS(ns, 'line')
    line.setAttribute('x1', String(left))
    line.setAttribute('y1', String(y))
    line.setAttribute('x2', String(right))
    line.setAttribute('y2', String(y))
    line.setAttribute('stroke', '#999')
    line.setAttribute('stroke-width', '0.5')
    line.setAttribute('stroke-opacity', '0.4')
    gridGroup.appendChild(line)
  }

  // Origin axes (x=0, y=0) — more prominent
  const originLine = (x1: number, y1: number, x2: number, y2: number) => {
    const line = doc.createElementNS(ns, 'line')
    line.setAttribute('x1', String(x1))
    line.setAttribute('y1', String(y1))
    line.setAttribute('x2', String(x2))
    line.setAttribute('y2', String(y2))
    line.setAttribute('stroke', '#666')
    line.setAttribute('stroke-width', '1')
    line.setAttribute('stroke-opacity', '0.6')
    return line
  }
  // x-axis at SVG y=0 (TikZ y=0)
  gridGroup.appendChild(originLine(left, 0, right, 0))
  // y-axis at SVG x=0 (TikZ x=0)
  gridGroup.appendChild(originLine(0, top, 0, bottom))

  // Labels on major gridlines — show TikZ pt values
  const ptPerCm = TIKZ_CONSTANTS.PT_PER_CM
  const labelSize = Math.max(3, vbW * 0.012)

  for (let x = startXMajor; x <= right; x += cmPx) {
    // SVG x in px → TikZ x in pt: px / PT_TO_PX
    const tikzPt = Math.round(x / DEFAULT_CONSTANTS.PT_TO_PX)
    if (tikzPt === 0) continue // skip origin label on x-axis
    const label = doc.createElementNS(ns, 'text')
    label.setAttribute('x', String(x))
    label.setAttribute('y', String(Math.min(labelSize + 1, vbY + vbH - 1)))
    label.setAttribute('fill', '#888')
    label.setAttribute('font-size', String(labelSize))
    label.setAttribute('text-anchor', 'middle')
    label.setAttribute('font-family', 'monospace')
    label.textContent = String(tikzPt)
    gridGroup.appendChild(label)
  }

  for (let y = startYMajor; y <= bottom; y += cmPx) {
    // SVG y in px → TikZ y in pt: -py / PT_TO_PX (y inverted)
    const tikzPt = Math.round(-y / DEFAULT_CONSTANTS.PT_TO_PX)
    if (tikzPt === 0) continue
    const label = doc.createElementNS(ns, 'text')
    label.setAttribute('x', String(vbX + 2))
    label.setAttribute('y', String(y - 1))
    label.setAttribute('fill', '#888')
    label.setAttribute('font-size', String(labelSize))
    label.setAttribute('text-anchor', 'start')
    label.setAttribute('font-family', 'monospace')
    label.textContent = String(tikzPt)
    gridGroup.appendChild(label)
  }

  // Insert grid as first child so it renders behind everything
  if (svgElement.firstChild) {
    svgElement.insertBefore(gridGroup, svgElement.firstChild)
  } else {
    svgElement.appendChild(gridGroup)
  }
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
