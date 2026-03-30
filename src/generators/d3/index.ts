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
 * - EditorStore holds persistent state (undo/redo, zoom, selection) that
 *   survives full SVG re-renders
 */

import * as d3 from 'd3-selection'
import { zoom as d3Zoom, zoomIdentity, type ZoomBehavior } from 'd3-zoom'
import type { IRDiagram } from '../../ir/types.js'
import type { SVGGeneratorOptions } from '../svg/index.js'
import { NodeGeometryRegistry } from '../core/coordResolver.js'
import { renderDiagram } from './renderer.js'
import { insertGrid } from './grid.js'
import { highlightElement as _highlightElement } from './highlight.js'
import { setupDrag, setupSelection, setupControlPointDrag, setupKeyboard, injectStyles, setShortcutHelp } from './interactions.js'
import { EditorStore } from './editorStore.js'

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
  /** Provide an external EditorStore to persist state across editor recreations. */
  store?: EditorStore
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
  /** Undo the last IR mutation. Returns true if undo was performed. */
  undo(): boolean
  /** Redo the last undone mutation. Returns true if redo was performed. */
  redo(): boolean
  /** Reset zoom/pan to fit the content in the viewport. */
  resetZoom(): void
  /** Zoom in by a fixed step. */
  zoomIn(): void
  /** Zoom out by a fixed step. */
  zoomOut(): void
  /** Show or hide the keyboard shortcut help overlay. */
  setShowHelp(show: boolean): void
  /** Whether the help overlay is currently visible. */
  getShowHelp(): boolean
  /** The backing store (undo/redo, zoom, diagram state). */
  store: EditorStore
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
  const store = opts.store ?? new EditorStore(diagram, opts.showGrid !== false)
  // If no external store was provided, initialize with the given diagram.
  // If an external store was provided, it already has the correct state.
  if (!opts.store) {
    store.diagram = diagram
  }

  let styleElement: HTMLStyleElement | null = null
  let currentElementMap: Map<string, SVGElement> = new Map()
  let currentNodeRegistry: NodeGeometryRegistry = new NodeGeometryRegistry()
  let zoomBehavior: ZoomBehavior<SVGSVGElement, unknown> | null = null
  let keyboardCleanup: (() => void) | null = null

  /** Common handler for IR mutations: snapshot, update, re-render, notify. */
  function handleMutation(updatedDiagram: IRDiagram, forceSnapshot = false) {
    store.applyMutation(updatedDiagram, forceSnapshot)
    render()
    // Re-apply highlight after re-render so selection persists visually
    if (store.highlightedId) {
      const svg = container.querySelector('svg') as SVGSVGElement | null
      if (svg) applyHighlight(svg, store.highlightedId)
    }
    if (opts.onIRChange) opts.onIRChange(store.diagram)
  }

  /** Apply highlight overlay + control point drag to the live SVG. */
  function applyHighlight(svg: SVGSVGElement, id: string | null) {
    _highlightElement(svg, id, currentElementMap, currentNodeRegistry, store.diagram)
    if (id && !opts.readOnly) {
      const el = currentElementMap.get(id)
      if (el?.getAttribute('data-ir-kind') === 'path') {
        setupControlPointDrag(svg, store.diagram, (d) => handleMutation(d, true))
      }
    }
  }

  function render() {
    // Clean up previous keyboard listener
    if (keyboardCleanup) { keyboardCleanup(); keyboardCleanup = null }

    // Clear previous content
    container.innerHTML = ''

    // Inject interaction styles
    styleElement = injectStyles(container)

    // Render SVG from IR
    const svgOpts: SVGGeneratorOptions = {
      document: container.ownerDocument,
      ...opts.svgOptions,
    }
    const result = renderDiagram(container, store.diagram, svgOpts)

    if (!result.svgElement) return

    currentElementMap = result.elementMap
    currentNodeRegistry = result.nodeRegistry

    const svgEl = result.svgElement
    const doc = svgEl.ownerDocument

    // Wrap all SVG children in a zoom group
    const zoomGroup = doc.createElementNS('http://www.w3.org/2000/svg', 'g')
    zoomGroup.setAttribute('class', 'd3-zoom-group')
    while (svgEl.firstChild) {
      zoomGroup.appendChild(svgEl.firstChild)
    }
    svgEl.appendChild(zoomGroup)

    // Insert coordinate grid inside the zoom group (so it pans/zooms with content)
    insertGrid(svgEl, store.gridVisible)
    // Move the grid group into the zoom group (insertGrid appends to svgEl)
    const gridGroup = svgEl.querySelector('.d3-grid')
    if (gridGroup) {
      zoomGroup.insertBefore(gridGroup, zoomGroup.firstChild)
    }

    // Build click zones — invisible padded rects/paths over each element so
    // clicks don't fight with the zoom/pan layer.  Placed inside the zoom group
    // so they pan/zoom together with the content.
    // Edge/path zones use thin padding (stroke only); labels/nodes use wider padding.
    // Labels are rendered on top so they're not obscured by edge zones.
    const clickZoneGroup = doc.createElementNS('http://www.w3.org/2000/svg', 'g')
    clickZoneGroup.setAttribute('class', 'd3-click-zones')
    const NODE_CLICK_PADDING = 6
    const EDGE_CLICK_STROKE = 12 // transparent stroke width for path/edge click zones
    const clickZoneMap = new Map<string, SVGElement>()

    // Two passes: edges/paths first (bottom), then nodes/labels on top
    const edgeIds: string[] = []
    const labelIds: string[] = []
    const nodeIds: string[] = []
    for (const [id, el] of result.elementMap) {
      const kind = el.getAttribute('data-ir-kind')
      if (kind === 'edge' || kind === 'path') edgeIds.push(id)
      else if (kind === 'edge-label') labelIds.push(id)
      else nodeIds.push(id)
    }

    for (const id of [...edgeIds, ...nodeIds, ...labelIds]) {
      const el = result.elementMap.get(id)!
      const kind = el.getAttribute('data-ir-kind')
      const isEdge = kind === 'edge' || kind === 'path'

      try {
        if (isEdge) {
          // For edges/paths: clone <path> elements with a thick transparent stroke
          // so the click zone follows the curve shape instead of a large bbox rect
          const paths = el.querySelectorAll('path')
          if (paths.length === 0) continue
          const g = doc.createElementNS('http://www.w3.org/2000/svg', 'g')
          g.setAttribute('class', 'd3-click-zone')
          g.setAttribute('data-zone-id', id)
          g.style.cursor = 'pointer'
          for (const p of Array.from(paths)) {
            const clone = p.cloneNode(false) as SVGPathElement
            clone.setAttribute('stroke', 'transparent')
            clone.setAttribute('stroke-width', String(EDGE_CLICK_STROKE))
            clone.setAttribute('fill', 'none')
            clone.removeAttribute('marker-start')
            clone.removeAttribute('marker-end')
            clone.removeAttribute('stroke-dasharray')
            g.appendChild(clone)
          }
          clickZoneGroup.appendChild(g)
          clickZoneMap.set(id, g)
        } else {
          // For nodes/labels: use bbox rect as before
          const pad = NODE_CLICK_PADDING
          const bbox = (el as SVGGraphicsElement).getBBox()
          if (bbox.width === 0 && bbox.height === 0) continue
          const rect = doc.createElementNS('http://www.w3.org/2000/svg', 'rect')
          rect.setAttribute('x', String(bbox.x - pad))
          rect.setAttribute('y', String(bbox.y - pad))
          rect.setAttribute('width', String(bbox.width + pad * 2))
          rect.setAttribute('height', String(bbox.height + pad * 2))
          rect.setAttribute('fill', 'transparent')
          rect.setAttribute('class', 'd3-click-zone')
          rect.setAttribute('data-zone-id', id)
          rect.style.cursor = 'pointer'
          clickZoneGroup.appendChild(rect)
          clickZoneMap.set(id, rect)
        }
      } catch { /* getBBox can throw for hidden elements */ }
    }
    zoomGroup.appendChild(clickZoneGroup)

    // Set up zoom/pan — remove fixed width/height so SVG fills its container.
    // Use xMinYMin so content anchors to top-left and doesn't shift when
    // the container resizes (e.g., sidebar toggle).
    svgEl.removeAttribute('width')
    svgEl.removeAttribute('height')
    svgEl.setAttribute('preserveAspectRatio', 'xMinYMin meet')

    // Preserve viewBox across re-renders so the image doesn't shift when
    // IR edits (control point drag, node drag) change the bounding box.
    if (store.viewBox) {
      svgEl.setAttribute('viewBox', store.viewBox)
    } else {
      store.viewBox = svgEl.getAttribute('viewBox')
    }
    svgEl.style.width = '100%'
    svgEl.style.height = '100%'

    zoomBehavior = d3Zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 20])
      .filter((event: any) => {
        // Allow wheel zoom always. For mouse/touch: only pan if no element drag is active.
        // Middle mouse button or ctrl+wheel for zoom, plain wheel for zoom too.
        if (event.type === 'wheel') return true
        // Right click: don't pan
        if (event.button) return false
        // Don't hijack clicks/drags on interactive elements or click zones
        const target = event.target as Element
        if (target.closest?.('.d3-draggable, .d3-click-zone, [data-d3-role="cp-handle"]')) return false
        return true
      })
      .on('zoom', (event) => {
        store.zoomTransform = event.transform
        zoomGroup.setAttribute('transform', event.transform.toString())
      })

    d3.select(svgEl).call(zoomBehavior)
    // Disable d3-zoom's dblclick-to-zoom so dblclick can be used for label editing
    d3.select(svgEl).on('dblclick.zoom', null)
    // Restore previous zoom transform across re-renders
    if (store.zoomTransform !== zoomIdentity) {
      d3.select(svgEl).call(zoomBehavior.transform, store.zoomTransform)
    }

    // Attach interactions unless read-only
    if (!opts.readOnly) {
      setupSelection(svgEl, result.elementMap, controller, store.diagram, opts.onElementSelect, handleMutation, clickZoneMap, currentNodeRegistry)
      setupDrag(svgEl, result.elementMap, store.diagram, controller, handleMutation, clickZoneMap)
      keyboardCleanup = setupKeyboard(
        svgEl, store.diagram, controller,
        () => store.highlightedId, handleMutation, opts.onElementSelect,
        currentNodeRegistry,
      )
    }
  }

  const controller: D3EditorController = {
    render,
    setDiagram(diagram: IRDiagram) {
      store.setDiagram(diagram)
      render()
    },
    getDiagram() {
      return store.diagram
    },
    setShowGrid(show: boolean) {
      store.gridVisible = show
      const svg = container.querySelector('svg')
      if (svg) {
        const gridGroup = svg.querySelector('.d3-grid') as SVGElement | null
        if (gridGroup) {
          gridGroup.style.display = show ? '' : 'none'
        }
      }
    },
    getShowGrid() {
      return store.gridVisible
    },
    highlightElement(id: string | null) {
      store.highlightedId = id
      const svg = container.querySelector('svg') as SVGSVGElement | null
      if (!svg) return
      applyHighlight(svg, id)
    },
    undo() {
      const restored = store.undo()
      if (!restored) return false
      render()
      if (opts.onElementSelect) opts.onElementSelect(null)
      if (opts.onIRChange) opts.onIRChange(store.diagram)
      return true
    },
    redo() {
      const restored = store.redo()
      if (!restored) return false
      render()
      if (opts.onElementSelect) opts.onElementSelect(null)
      if (opts.onIRChange) opts.onIRChange(store.diagram)
      return true
    },
    resetZoom() {
      const svg = container.querySelector('svg') as SVGSVGElement | null
      if (!svg || !zoomBehavior) return
      store.zoomTransform = zoomIdentity
      d3.select(svg).call(zoomBehavior.transform, zoomIdentity)
    },
    zoomIn() {
      const svg = container.querySelector('svg') as SVGSVGElement | null
      if (!svg || !zoomBehavior) return
      zoomBehavior.scaleBy(d3.select(svg), 1.3)
    },
    zoomOut() {
      const svg = container.querySelector('svg') as SVGSVGElement | null
      if (!svg || !zoomBehavior) return
      zoomBehavior.scaleBy(d3.select(svg), 1 / 1.3)
    },
    setShowHelp(show: boolean) {
      const svg = container.querySelector('svg') as SVGSVGElement | null
      if (!svg) return
      setShortcutHelp(svg, show)
    },
    getShowHelp() {
      return !!container.querySelector('.d3-shortcut-help')
    },
    store,
    destroy() {
      if (keyboardCleanup) { keyboardCleanup(); keyboardCleanup = null }
      container.innerHTML = ''
      styleElement = null
    },
  }

  // Initial render
  render()

  return controller
}
