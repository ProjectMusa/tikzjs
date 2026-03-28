/**
 * D3 interaction handlers — drag, select, hover behaviors for the interactive editor.
 */

import * as d3 from 'd3-selection'
import { drag as d3Drag } from 'd3-drag'
import type { IRDiagram, IRNode } from '../../ir/types.js'
import { pxToPt, ptToPx } from '../core/coordResolver.js'
import { moveNode, findNode, findElement, isDraggable, updateCurveControl, moveSegmentEndpoint, updateNodeLabel, type CpRole } from './irMutator.js'
import type { D3EditorController } from './index.js'

// ── Selection ────────────────────────────────────────────────────────────────

export function setupSelection(
  svgElement: SVGSVGElement,
  elementMap: Map<string, SVGElement>,
  controller: D3EditorController,
  diagram: IRDiagram,
  onSelect?: (id: string | null) => void,
  onLabelEdit?: (diagram: IRDiagram) => void,
  clickZoneMap?: Map<string, SVGRectElement>,
): void {
  // Track last click time per element for double-click detection
  // (native dblclick doesn't fire reliably when d3-drag is active)
  const lastClickTime = new Map<string, number>()
  const DBLCLICK_THRESHOLD = 400 // ms

  function handleClick(id: string, event: MouseEvent) {
    event.stopPropagation()

    const now = Date.now()
    const lastTime = lastClickTime.get(id) ?? 0

    if (now - lastTime < DBLCLICK_THRESHOLD && onLabelEdit) {
      // Double-click detected — open label editor for nodes
      lastClickTime.delete(id)
      const el = elementMap.get(id)
      const node = findNode(diagram, id)
      if (node && el) {
        openLabelEditor(svgElement, el, node, id, diagram, onLabelEdit)
        return
      }
    }

    lastClickTime.set(id, now)
    controller.highlightElement(id)
    if (onSelect) onSelect(id)
  }

  // Attach click handlers to click zones (padded invisible rects)
  if (clickZoneMap) {
    for (const [id, zone] of clickZoneMap) {
      d3.select(zone).on('click', (event: MouseEvent) => handleClick(id, event))
    }
  }

  // Also attach to the elements themselves as fallback
  for (const [id, el] of elementMap) {
    d3.select(el).on('click', (event: MouseEvent) => handleClick(id, event))
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
    .d3-label-input {
      position: absolute;
      border: 1.5px solid #f59e0b;
      border-radius: 3px;
      background: rgba(0, 0, 0, 0.85);
      color: #fff;
      font-family: monospace;
      font-size: 13px;
      padding: 2px 6px;
      outline: none;
      min-width: 40px;
      z-index: 1000;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    }
    .d3-label-input:focus {
      border-color: #fbbf24;
      box-shadow: 0 0 0 2px rgba(245, 158, 11, 0.3);
    }
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

        // Determine which mutation to use based on segment kind and cpRole
        const el = findElement(diagram.elements, state.pathId)
        const seg = el && el.kind === 'path' ? el.segments[state.segIdx] : null
        const isCurveCP = seg?.kind === 'curve' && (state.cpRole === 'cp1' || state.cpRole === 'cp2')
        const isCurveTo = seg?.kind === 'curve' && state.cpRole === 'to'

        if (isCurveCP || isCurveTo) {
          updateCurveControl(diagram, state.pathId, state.segIdx, state.cpRole, newXPt, newYPt)
        } else {
          // move, line-to, hv-line-to: use moveSegmentEndpoint
          moveSegmentEndpoint(diagram, state.pathId, state.segIdx, newXPt, newYPt)
        }
        onIRChange(diagram)
      })

    // Prevent click-through to SVG background (which would deselect)
    d3.select(handle).on('click', (e: MouseEvent) => e.stopPropagation())
    d3.select(handle).call(dragBehavior)
  }
}

// ── Label editing ───────────────────────────────────────────────────────────

/**
 * Open an inline text input over a node to edit its label.
 * Called from setupSelection when a double-click is detected.
 */
function openLabelEditor(
  svgElement: SVGSVGElement,
  el: SVGElement,
  node: IRNode,
  id: string,
  diagram: IRDiagram,
  onIRChange: (diagram: IRDiagram) => void,
): void {
  const container = svgElement.closest('.editor-overlay') as HTMLElement
    ?? svgElement.parentElement
  if (!container) return

  // Remove any existing label input
  const existing = container.querySelector('.d3-label-input')
  if (existing) existing.remove()

  // Position the input over the node's bounding box
  const bbox = (el as SVGGraphicsElement).getBoundingClientRect()
  const containerRect = container.getBoundingClientRect()

  const input = document.createElement('input')
  input.type = 'text'
  input.className = 'd3-label-input'
  input.value = node.label
  input.style.left = `${bbox.left - containerRect.left + bbox.width / 2}px`
  input.style.top = `${bbox.top - containerRect.top + bbox.height / 2}px`
  input.style.transform = 'translate(-50%, -50%)'

  // Size the input to fit the content
  const charWidth = 8
  input.style.width = `${Math.max(60, node.label.length * charWidth + 20)}px`

  let committed = false
  function commit() {
    if (committed) return
    committed = true
    const newLabel = input.value
    input.remove()
    if (newLabel !== node.label) {
      updateNodeLabel(diagram, id, newLabel)
      onIRChange(diagram)
    }
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      commit()
    } else if (e.key === 'Escape') {
      committed = true
      input.remove()
    }
  })
  input.addEventListener('blur', commit)

  // Auto-resize as user types
  input.addEventListener('input', () => {
    input.style.width = `${Math.max(60, input.value.length * charWidth + 20)}px`
  })

  container.appendChild(input)
  input.focus()
  input.select()
}
