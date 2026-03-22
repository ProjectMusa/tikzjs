/**
 * D3 SVG renderer — renders IRDiagram to interactive SVG using the SVG generator's
 * DOM output directly (no serialization roundtrip).
 *
 * The SVG generator creates DOM elements with `data-ir-id` and `data-ir-kind`
 * attributes already set. We use `generateSVGElement` to get the live DOM tree,
 * insert it into the container, and build an element map for interactivity.
 */

import type { IRDiagram, IRNode } from '../../ir/types.js'
import { generateSVGElement, SVGGeneratorOptions } from '../svg/index.js'
import { CoordResolver, NodeGeometryRegistry } from '../core/coordResolver.js'
import { collectNodes, isDraggable } from './irMutator.js'

export interface RenderResult {
  /** The SVG element inserted into the container. */
  svgElement: SVGSVGElement
  /** Map from IR element id to SVG element. */
  elementMap: Map<string, SVGElement>
  /** CoordResolver used (for px↔pt conversion during drag). */
  coordResolver: CoordResolver
  /** Node geometry registry populated during SVG Pass 1. */
  nodeRegistry: NodeGeometryRegistry
}

/**
 * Render an IRDiagram into the given container using the SVG generator's
 * live DOM output. All elements already have data-ir-id attributes.
 */
export function renderDiagram(
  container: HTMLElement,
  diagram: IRDiagram,
  svgOpts: SVGGeneratorOptions = {},
): RenderResult {
  // Generate SVG DOM element directly — no string serialization
  const document = svgOpts.document ?? container.ownerDocument
  const { svg, coordResolver, nodeRegistry } = generateSVGElement(diagram, { ...svgOpts, document })

  // Insert the live DOM element — no innerHTML parse roundtrip
  container.innerHTML = ''
  const svgElement = svg as unknown as SVGSVGElement
  svgElement.style.width = '100%'
  svgElement.style.height = '100%'
  container.appendChild(svgElement)

  // Build element map from data-ir-id attributes already on the DOM elements
  const elementMap = new Map<string, SVGElement>()
  buildElementMap(svgElement, diagram, elementMap)

  return { svgElement, elementMap, coordResolver, nodeRegistry }
}

// ── Element map ─────────────────────────────────────────────────────────────

/**
 * Build the element map from data-ir-id attributes set by the SVG generator,
 * and add drag/lock CSS classes to node elements.
 */
function buildElementMap(
  svgElement: SVGSVGElement,
  diagram: IRDiagram,
  elementMap: Map<string, SVGElement>,
): void {
  if (!svgElement) return

  const allNodes = collectNodes(diagram.elements)
  const nodeById = new Map<string, IRNode>()
  for (const node of allNodes) nodeById.set(node.id, node)

  // Collect all elements tagged by the SVG generator
  const taggedEls = svgElement.querySelectorAll('[data-ir-id]')
  for (const el of Array.from(taggedEls)) {
    const irId = el.getAttribute('data-ir-id')!
    const irKind = el.getAttribute('data-ir-kind')

    // First occurrence wins (e.g., a node <g> over its child shapes)
    if (!elementMap.has(irId)) {
      elementMap.set(irId, el as SVGElement)
    }

    // Add drag/lock classes to nodes
    if (irKind === 'node') {
      const node = nodeById.get(irId)
      if (node) {
        if (isDraggable(node)) {
          el.classList.add('d3-draggable')
        } else {
          el.classList.add('d3-locked')
        }
      }
    }
  }
}
