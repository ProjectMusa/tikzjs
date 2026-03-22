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
import type { MathRenderer } from '../../math/index.js'
import type { SVGGeneratorOptions } from '../svg/index.js'
import { renderDiagram } from './renderer.js'
import { setupDrag, setupSelection, injectStyles } from './interactions.js'

// ── Public API ───────────────────────────────────────────────────────────────

export interface D3EditorOptions {
  /** Called after each IR mutation (e.g., drag end). */
  onIRChange?: (diagram: IRDiagram) => void
  /** Disable editing — render-only mode. */
  readOnly?: boolean
  /** SVG generator options (math renderer, constants, etc.). */
  svgOptions?: SVGGeneratorOptions
}

export interface D3EditorController {
  /** Re-render the diagram from the current IR state. */
  render(): void
  /** Replace the IR and re-render. */
  setDiagram(diagram: IRDiagram): void
  /** Get the current (possibly mutated) IR. */
  getDiagram(): IRDiagram
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

    // Attach interactions unless read-only
    if (!opts.readOnly) {
      setupSelection(result.svgElement, result.elementMap, controller)
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
    destroy() {
      container.innerHTML = ''
      styleElement = null
    },
  }

  // Initial render
  render()

  return controller
}
