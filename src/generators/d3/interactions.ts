/**
 * D3 interaction handlers — drag, select, hover behaviors for the interactive editor.
 */

import * as d3 from 'd3-selection'
import { drag as d3Drag } from 'd3-drag'
import type { IRDiagram, IRNode } from '../../ir/types.js'
import { pxToPt, ptToPx } from '../core/coordResolver.js'
import { moveNode, findNode, isDraggable, updateCurveControl, type CpRole } from './irMutator.js'
import type { D3EditorController } from './index.js'

// ── Selection ────────────────────────────────────────────────────────────────

export function setupSelection(
  svgElement: SVGSVGElement,
  elementMap: Map<string, SVGElement>,
  controller: D3EditorController,
  onSelect?: (id: string | null) => void,
): void {
  // Click on element to select — call highlightElement immediately for instant feedback,
  // then notify parent via onSelect (which updates React state for the inspector)
  for (const [id, el] of elementMap) {
    d3.select(el).on('click', (event: MouseEvent) => {
      event.stopPropagation()
      controller.highlightElement(id)
      if (onSelect) onSelect(id)
    })
  }

  // Click on background to deselect
  d3.select(svgElement).on('click', () => {
    controller.highlightElement(null)
    if (onSelect) onSelect(null)
  })
}

// ── Drag ─────────────────────────────────────────────────────────────────────

interface DragState {
  startPtX: number
  startPtY: number
  startPxX: number
  startPxY: number
}

export function setupDrag(
  svgElement: SVGSVGElement,
  elementMap: Map<string, SVGElement>,
  diagram: IRDiagram,
  controller: D3EditorController,
  onIRChange?: (diagram: IRDiagram) => void,
): void {
  const draggables = svgElement.querySelectorAll('.d3-draggable')

  for (const el of Array.from(draggables)) {
    const irId = el.getAttribute('data-ir-id')
    if (!irId) continue

    const node = findNode(diagram, irId)
    if (!node || !isDraggable(node)) continue

    // Get the SVG coordinate transform (viewBox → screen pixels)
    const dragBehavior = d3Drag<SVGElement, unknown>()
      .on('start', function (event) {
        d3.select(this).classed('d3-dragging', true)
        // Store initial IR position
        const coord = node.position.coord
        if (coord.cs === 'xy') {
          const state: DragState = {
            startPtX: coord.x,
            startPtY: coord.y,
            startPxX: event.x,
            startPxY: event.y,
          }
          d3.select(this).datum(state)
        }
      })
      .on('drag', function (event) {
        const state = d3.select(this).datum() as DragState
        if (!state) return

        // Compute delta in SVG coordinates (which are already in px units from the viewBox)
        const dxPx = event.x - state.startPxX
        const dyPx = event.y - state.startPxY

        // Convert px delta to pt delta
        // Note: SVG y-axis is inverted relative to TikZ, so negate dy
        const dxPt = pxToPt(dxPx)
        const dyPt = -pxToPt(dyPx)

        const newXPt = state.startPtX + dxPt
        const newYPt = state.startPtY + dyPt

        // Update IR
        moveNode(diagram, irId, newXPt, newYPt)

        // Update SVG transform directly for immediate visual feedback
        const newPxX = ptToPx(newXPt)
        // Y is negated in SVG space
        const newPxY = -ptToPx(newYPt)

        // Find existing transform and update translate
        const transform = (this as SVGElement).getAttribute('transform') || ''
        const newTransform = transform.replace(
          /translate\([^)]*\)/,
          `translate(${newPxX.toFixed(2)}, ${newPxY.toFixed(2)})`,
        )
        ;(this as SVGElement).setAttribute('transform', newTransform)
      })
      .on('end', function () {
        d3.select(this).classed('d3-dragging', false)
        // Notify that IR has changed — triggers full re-render to update edges
        if (onIRChange) onIRChange(diagram)
      })

    d3.select(el as SVGElement).call(dragBehavior)
  }
}

// ── Visual Styles ────────────────────────────────────────────────────────────

/**
 * Inject CSS styles for interactive elements.
 */
export function injectStyles(container: HTMLElement): HTMLStyleElement {
  const doc = container.ownerDocument
  const style = doc.createElement('style')
  style.textContent = `
    .d3-draggable { cursor: grab; }
    .d3-draggable:hover { filter: brightness(1.1); }
    .d3-dragging { cursor: grabbing !important; opacity: 0.8; }
    .d3-locked { cursor: not-allowed; opacity: 0.9; }
  `
  container.prepend(style)
  return style
}

// ── Control point drag ────────────────────────────────────────────────────────

interface CPDragState {
  startPtX: number
  startPtY: number
  startPxX: number
  startPxY: number
  pathId: string
  segIdx: number
  cpRole: CpRole
  handleLineId: string
}

/**
 * Set up drag behavior on bezier curve control point handles rendered by highlight.ts.
 * Handles are `<circle data-d3-role="cp-handle">` elements inside the highlight group.
 *
 * During drag: the circle and its handle line update for visual feedback.
 * On drag end: the IR curve segment is mutated and onIRChange is called.
 */
export function setupControlPointDrag(
  svg: SVGSVGElement,
  diagram: IRDiagram,
  onIRChange: (diagram: IRDiagram) => void,
): void {
  const handles = Array.from(svg.querySelectorAll('[data-d3-role="cp-handle"]')) as SVGCircleElement[]

  for (const handle of handles) {
    const pathId = handle.getAttribute('data-ir-path-id') ?? ''
    const segIdx = parseInt(handle.getAttribute('data-seg-idx') ?? '0', 10)
    const cpRole = (handle.getAttribute('data-cp-role') ?? 'cp1') as CpRole
    const origPtX = parseFloat(handle.getAttribute('data-orig-pt-x') ?? '0')
    const origPtY = parseFloat(handle.getAttribute('data-orig-pt-y') ?? '0')
    const handleLineId = handle.getAttribute('data-handle-line-id') ?? ''

    const dragBehavior = d3Drag<SVGCircleElement, unknown>()
      .on('start', function (event) {
        event.sourceEvent?.stopPropagation()
        d3.select(this).attr('cursor', 'grabbing')
        const state: CPDragState = {
          startPtX: origPtX,
          startPtY: origPtY,
          startPxX: event.x,
          startPxY: event.y,
          pathId,
          segIdx,
          cpRole,
          handleLineId,
        }
        d3.select(this).datum(state)
      })
      .on('drag', function (event) {
        const state = d3.select(this).datum() as CPDragState
        if (!state) return

        // Move the dot
        const newCx = event.x
        const newCy = event.y
        ;(this as SVGCircleElement).setAttribute('cx', String(newCx))
        ;(this as SVGCircleElement).setAttribute('cy', String(newCy))

        // Update the handle line's moveable endpoint
        if (state.handleLineId) {
          const line = svg.querySelector(`#${CSS.escape(state.handleLineId)}`)
          if (line) {
            line.setAttribute('x2', String(newCx))
            line.setAttribute('y2', String(newCy))
          }
        }
      })
      .on('end', function (event) {
        d3.select(this).attr('cursor', 'grab')
        const state = d3.select(this).datum() as CPDragState
        if (!state) return

        // Convert SVG px delta to TikZ pt, accounting for y-axis inversion
        const dxPt = pxToPt(event.x - state.startPxX)
        const dyPt = -pxToPt(event.y - state.startPxY)

        const newXPt = state.startPtX + dxPt
        const newYPt = state.startPtY + dyPt

        updateCurveControl(diagram, state.pathId, state.segIdx, state.cpRole, newXPt, newYPt)
        onIRChange(diagram)
      })

    // Prevent click-through to SVG background (which would deselect)
    d3.select(handle).on('click', (e: MouseEvent) => e.stopPropagation())
    d3.select(handle).call(dragBehavior)
  }
}
