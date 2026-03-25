/**
 * D3 interaction handlers — drag, select, hover behaviors for the interactive editor.
 */

import * as d3 from 'd3-selection'
import { drag as d3Drag } from 'd3-drag'
import type { IRDiagram, IRNode } from '../../ir/types.js'
import { pxToPt, ptToPx } from '../core/coordResolver.js'
import { moveNode, findNode, findElement, isDraggable, updateCurveControl, type CpRole } from './irMutator.js'
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

    // Use the zoom group as the drag container so d3-drag computes
    // coordinates in the zoom group's local (pre-zoom) coordinate space.
    const zoomGroup = svgElement.querySelector('.d3-zoom-group') as SVGGElement | null
    const dragBehavior = d3Drag<SVGElement, unknown>()
      .container(zoomGroup ?? svgElement as any)
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

        const translate = `translate(${newPxX.toFixed(2)}, ${newPxY.toFixed(2)})`
        const transform = (this as SVGElement).getAttribute('transform') || ''
        const newTransform = /translate\([^)]*\)/.test(transform)
          ? transform.replace(/translate\([^)]*\)/, translate)
          : translate + (transform ? ' ' + transform : '')
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
  /** Original path `d` attribute for live preview. */
  originalD: string
  /** The `<path>` SVG element being previewed. */
  pathEl: SVGPathElement | null
  /** Parsed cubic command offsets within the `d` string for targeted replacement. */
  cubicIndex: number
  /** True when the curve segment has only one control point (cp1 === cp2 in SVG). */
  singleControl: boolean
}

/**
 * Update a point in an SVG path `d` string for live curve preview.
 *
 * Supports:
 * - 'move': updates the M command (start point)
 * - 'cp1'/'cp2'/'to': updates the Nth C command (0-indexed by `cubicIndex`)
 *
 * C command structure: C cx1 cy1 cx2 cy2 x y
 *   - cp1 = positions 0,1 (cx1, cy1)
 *   - cp2 = positions 2,3 (cx2, cy2)
 *   - to  = positions 4,5 (x, y)
 */
function updatePathD(d: string, cubicIndex: number, cpRole: CpRole, newX: number, newY: number, singleControl = false): string {
  // Move command: update M x y
  if (cpRole === 'move') {
    return d.replace(
      /^M\s+([-\d.e]+)\s+([-\d.e]+)/i,
      `M ${newX.toFixed(2)} ${newY.toFixed(2)}`,
    )
  }

  // Cubic commands: find the Nth C command
  const cubicRegex = /C\s+([-\d.e]+)\s+([-\d.e]+)\s+([-\d.e]+)\s+([-\d.e]+)\s+([-\d.e]+)\s+([-\d.e]+)/gi
  let match: RegExpExecArray | null
  let idx = 0

  while ((match = cubicRegex.exec(d)) !== null) {
    if (idx === cubicIndex) {
      const args = [match[1], match[2], match[3], match[4], match[5], match[6]]
      if (cpRole === 'cp1') {
        args[0] = newX.toFixed(2)
        args[1] = newY.toFixed(2)
        // Single-control curves use the same point for both cp1 and cp2
        if (singleControl) {
          args[2] = newX.toFixed(2)
          args[3] = newY.toFixed(2)
        }
      } else if (cpRole === 'cp2') {
        args[2] = newX.toFixed(2)
        args[3] = newY.toFixed(2)
      } else {
        args[4] = newX.toFixed(2)
        args[5] = newY.toFixed(2)
      }
      const replacement = `C ${args.join(' ')}`
      return d.slice(0, match.index) + replacement + d.slice(match.index + match[0].length)
    }
    idx++
  }
  return d
}

/**
 * Find the `<path>` element for a given IR path id and count which cubic command
 * corresponds to the given segment index.
 */
function findPathElAndCubicIndex(
  svg: SVGSVGElement,
  pathId: string,
  segIdx: number,
  diagram: IRDiagram,
): { pathEl: SVGPathElement | null; cubicIndex: number; singleControl: boolean } {
  // Find the <path> element via data-ir-id
  const container = svg.querySelector(`[data-ir-id="${pathId}"]`)
  const pathEl = container?.tagName.toLowerCase() === 'path'
    ? container as SVGPathElement
    : container?.querySelector('path') as SVGPathElement | null

  // Count which C command this segIdx maps to: curve segments produce C commands
  // in order, so count how many curve segments precede this one.
  const el = findElement(diagram.elements, pathId)
  let cubicIndex = 0
  let singleControl = false
  if (el && el.kind === 'path') {
    for (let i = 0; i < el.segments.length && i < segIdx; i++) {
      if (el.segments[i].kind === 'curve') cubicIndex++
    }
    const seg = el.segments[segIdx]
    if (seg && seg.kind === 'curve') {
      singleControl = seg.controls.length === 1
    }
  }

  return { pathEl, cubicIndex, singleControl }
}

/**
 * Set up drag behavior on bezier curve control point handles rendered by highlight.ts.
 * Handles are elements with `data-d3-role="cp-handle"` — circles for control points,
 * rects for endpoints/start points.
 *
 * During drag: the handle, handle line, and curve path update for live visual feedback.
 * On drag end: the IR curve segment is mutated and onIRChange is called.
 */
export function setupControlPointDrag(
  svg: SVGSVGElement,
  diagram: IRDiagram,
  onIRChange: (diagram: IRDiagram) => void,
): void {
  const handles = Array.from(svg.querySelectorAll('[data-d3-role="cp-handle"]')) as SVGElement[]

  for (const handle of handles) {
    const pathId = handle.getAttribute('data-ir-path-id') ?? ''
    const segIdx = parseInt(handle.getAttribute('data-seg-idx') ?? '0', 10)
    const cpRole = (handle.getAttribute('data-cp-role') ?? 'cp1') as CpRole
    const origPtX = parseFloat(handle.getAttribute('data-orig-pt-x') ?? '0')
    const origPtY = parseFloat(handle.getAttribute('data-orig-pt-y') ?? '0')
    const handleLineId = handle.getAttribute('data-handle-line-id') ?? ''
    const isRect = handle.tagName.toLowerCase() === 'rect'

    const zoomGroup = svg.querySelector('.d3-zoom-group') as SVGGElement | null
    const dragBehavior = d3Drag<SVGElement, unknown>()
      .container(zoomGroup ?? svg as any)
      .on('start', function (event) {
        event.sourceEvent?.stopPropagation()
        d3.select(this).attr('cursor', 'grabbing')

        const { pathEl, cubicIndex, singleControl } = findPathElAndCubicIndex(svg, pathId, segIdx, diagram)

        const state: CPDragState = {
          startPtX: origPtX,
          startPtY: origPtY,
          startPxX: event.x,
          startPxY: event.y,
          pathId,
          segIdx,
          cpRole,
          handleLineId,
          originalD: pathEl?.getAttribute('d') ?? '',
          pathEl,
          cubicIndex,
          singleControl,
        }
        d3.select(this).datum(state)
      })
      .on('drag', function (event) {
        const state = d3.select(this).datum() as CPDragState
        if (!state) return

        const newCx = event.x
        const newCy = event.y

        // Move the handle (circle uses cx/cy, rect uses x/y centered)
        if (isRect) {
          const size = parseFloat((this as SVGElement).getAttribute('width') ?? '7')
          ;(this as SVGElement).setAttribute('x', String(newCx - size / 2))
          ;(this as SVGElement).setAttribute('y', String(newCy - size / 2))
        } else {
          ;(this as SVGElement).setAttribute('cx', String(newCx))
          ;(this as SVGElement).setAttribute('cy', String(newCy))
        }

        // Update the handle line's moveable endpoint (for control point handles)
        if (state.handleLineId) {
          const line = svg.querySelector(`#${CSS.escape(state.handleLineId)}`)
          if (line) {
            line.setAttribute('x2', String(newCx))
            line.setAttribute('y2', String(newCy))
          }
        }

        // Update handle lines anchored at this endpoint (for move/to handles)
        if (state.cpRole === 'move' || state.cpRole === 'to') {
          const anchored = svg.querySelectorAll(
            `line[data-anchor-seg="${state.segIdx}"][data-anchor-role="${state.cpRole}"]`,
          )
          for (const line of Array.from(anchored)) {
            line.setAttribute('x1', String(newCx))
            line.setAttribute('y1', String(newCy))
          }
        }

        // Live preview: update the curve path's d attribute
        if (state.pathEl && state.originalD) {
          const updatedD = updatePathD(state.originalD, state.cubicIndex, state.cpRole, newCx, newCy, state.singleControl)
          state.pathEl.setAttribute('d', updatedD)
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
