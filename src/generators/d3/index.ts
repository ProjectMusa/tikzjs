/**
 * D3.js Interactive SVG Editor — renders IRDiagram as interactive SVG.
 *
 * User interactions (dragging nodes, selecting elements) mutate the IR directly.
 * The IR is the single source of truth.
 *
 * Architecture:
 * - Uses the existing SVG generator for high-quality rendering
 * - D3 adds interactivity (drag, select, hover) on top
 * - Drag end triggers full re-render to update connected edges
 * - onIRChange callback notifies the parent when IR is mutated
 */

import type { IRDiagram } from '../../ir/types.js'
import type { SVGGeneratorOptions } from '../svg/index.js'
import { NodeGeometryRegistry } from '../core/coordResolver.js'
import { renderDiagram } from './renderer.js'
import { insertGrid } from './grid.js'
import { highlightElement as _highlightElement } from './highlight.js'
import { setupDrag, setupSelection, setupControlPointDrag, injectStyles } from './interactions.js'

// ── Public API ───────────────────────────────────────────────────────────────

export interface D3EditorOptions {
  /** Called after each IR mutation (e.g., drag end). */
  onIRChange?: (diagram: IRDiagram) => void
  /** Called when user clicks an element on the canvas (or null on deselect). */
  onElementSelect?: (elementId: string | null) => void
  /** Disable editing — render-only mode. */
  readOnly?: boolean
  /** SVG generator options (math renderer, constants, etc.). */
  svgOptions?: SVGGeneratorOptions
  /** Show coordinate grid on initial render (default: true). */
  showGrid?: boolean
}

export interface D3EditorController {
  /** Re-render the diagram from the current IR state. */
  render(): void
  /** Replace the IR and re-render. */
  setDiagram(diagram: IRDiagram): void
  /** Get the current (possibly mutated) IR. */
  getDiagram(): IRDiagram
  /** Show or hide the coordinate grid. */
  setShowGrid(show: boolean): void
  /** Whether the grid is currently visible. */
  getShowGrid(): boolean
  /** Highlight an element on the canvas by its IR id. */
  highlightElement(id: string | null): void
  /** Clean up event listeners and DOM elements. */
  destroy(): void
}

/**
 * Create an interactive D3 editor in the given container.
 *
 * Usage:
 *   const controller = createD3Editor(containerEl, diagram, {
 *     onIRChange: (d) => updateSource(generateTikZ(d))
 *   })
 */
export function createD3Editor(
  container: HTMLElement,
  diagram: IRDiagram,
  opts: D3EditorOptions = {},
): D3EditorController {
  let currentDiagram = diagram
  let styleElement: HTMLStyleElement | null = null
  let gridVisible = opts.showGrid !== false // default true
  let currentElementMap: Map<string, SVGElement> = new Map()
  let currentNodeRegistry: NodeGeometryRegistry = new NodeGeometryRegistry()
  let lastHighlightedId: string | null = null

  /** Apply highlight overlay + control point drag to the live SVG. */
  function applyHighlight(svg: SVGSVGElement, id: string | null) {
    _highlightElement(svg, id, currentElementMap, currentNodeRegistry, currentDiagram)
    if (id && !opts.readOnly) {
      const el = currentElementMap.get(id)
      if (el?.getAttribute('data-ir-kind') === 'path') {
        setupControlPointDrag(svg, currentDiagram, onControlPointDragEnd)
      }
    }
  }

  function onControlPointDragEnd(updatedDiagram: IRDiagram) {
    currentDiagram = updatedDiagram
    render()
    // Re-apply highlight at new control point positions
    const svg = container.querySelector('svg') as SVGSVGElement | null
    if (svg && lastHighlightedId) applyHighlight(svg, lastHighlightedId)
    if (opts.onIRChange) opts.onIRChange(currentDiagram)
  }

  function render() {
    // Clear previous content
    container.innerHTML = ''

    // Inject interaction styles
    styleElement = injectStyles(container)

    // Render SVG from IR
    const svgOpts: SVGGeneratorOptions = {
      document: container.ownerDocument,
      ...opts.svgOptions,
    }
    const result = renderDiagram(container, currentDiagram, svgOpts)

    if (!result.svgElement) return

    currentElementMap = result.elementMap
    currentNodeRegistry = result.nodeRegistry

    // Insert coordinate grid
    insertGrid(result.svgElement, gridVisible)

    // Attach interactions unless read-only
    if (!opts.readOnly) {
      setupSelection(result.svgElement, result.elementMap, controller, opts.onElementSelect)
      setupDrag(
        result.svgElement,
        result.elementMap,
        currentDiagram,
        controller,
        (updatedDiagram) => {
          // On drag end: full re-render to update edges, then notify parent
          currentDiagram = updatedDiagram
          render()
          if (opts.onIRChange) opts.onIRChange(currentDiagram)
        },
      )
    }
  }

  const controller: D3EditorController = {
    render,
    setDiagram(diagram: IRDiagram) {
      currentDiagram = diagram
      render()
    },
    getDiagram() {
      return currentDiagram
    },
    setShowGrid(show: boolean) {
      gridVisible = show
      const svg = container.querySelector('svg')
      if (svg) {
        const gridGroup = svg.querySelector('.d3-grid') as SVGElement | null
        if (gridGroup) {
          gridGroup.style.display = show ? '' : 'none'
        }
      }
    },
    getShowGrid() {
      return gridVisible
    },
    highlightElement(id: string | null) {
      lastHighlightedId = id
      const svg = container.querySelector('svg') as SVGSVGElement | null
      if (!svg) return
      applyHighlight(svg, id)
    },
    destroy() {
      container.innerHTML = ''
      styleElement = null
    },
  }

  // Initial render
  render()

  return controller
}
