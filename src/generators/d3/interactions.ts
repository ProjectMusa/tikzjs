/**
 * D3 interaction handlers — drag, select, hover behaviors for the interactive editor.
 */

import * as d3 from 'd3-selection'
import { drag as d3Drag } from 'd3-drag'
import type { IRDiagram, IRNode } from '../../ir/types.js'
import { pxToPt, ptToPx, NodeGeometryRegistry } from '../core/coordResolver.js'
import { moveNode, findNode, findElement, isDraggable, updateCurveControl, moveSegmentEndpoint, updateNodeLabel, updateEdgeLabel, removeElement, addNode, duplicateElement, type CpRole } from './irMutator.js'
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
  nodeRegistry?: NodeGeometryRegistry,
): void {
  const DBLCLICK_THRESHOLD = 400 // ms

  function handleClick(id: string, event: MouseEvent) {
    event.stopPropagation()

    // For edge labels, highlight the parent edge
    const edgeLabelMatch = id.match(/^(.+):label:(\d+)$/)
    const highlightId = edgeLabelMatch ? edgeLabelMatch[1] : id
    controller.highlightElement(highlightId)
    if (onSelect) onSelect(highlightId)
  }

  // Use mousedown timing to detect double-clicks, since d3-drag may prevent
  // native click/dblclick events from firing reliably.
  const lastMousedownTime = new Map<string, number>()
  const lastMousedownPos = new Map<string, { x: number; y: number }>()
  const DBLCLICK_MOVE_THRESHOLD = 5 // px — mouse must not move more than this between clicks

  function handleMousedown(id: string, event: MouseEvent) {
    const now = Date.now()
    const lastTime = lastMousedownTime.get(id) ?? 0
    const lastPos = lastMousedownPos.get(id)

    // Check if this is a double-click: two mousedowns within threshold,
    // mouse didn't move much between them
    const moved = lastPos ? Math.hypot(event.clientX - lastPos.x, event.clientY - lastPos.y) : 0
    if (now - lastTime < DBLCLICK_THRESHOLD && moved < DBLCLICK_MOVE_THRESHOLD && onLabelEdit) {
      lastMousedownTime.delete(id)
      lastMousedownPos.delete(id)

      // Open label editor — prevent d3-drag from starting
      event.stopImmediatePropagation()
      event.preventDefault()

      const el = elementMap.get(id)

      // Check if this is an edge label
      const edgeLabelMatch = id.match(/^(.+):label:(\d+)$/)
      if (edgeLabelMatch && el) {
        const edgeId = edgeLabelMatch[1]
        const labelIdx = parseInt(edgeLabelMatch[2], 10)
        const edge = findElement(diagram.elements, edgeId)
        if (edge && edge.kind === 'edge' && labelIdx < edge.labels.length) {
          openEdgeLabelEditor(svgElement, el, edge.labels[labelIdx].text, edgeId, labelIdx, diagram, onLabelEdit)
          return
        }
      }

      // Check if this is a node
      const node = findNode(diagram, id)
      if (node && el) {
        openLabelEditor(svgElement, el, node, id, diagram, onLabelEdit, nodeRegistry)
        return
      }

      // Check if this is an edge with labels — open the first label
      const edgeEl = findElement(diagram.elements, id)
      if (edgeEl && edgeEl.kind === 'edge' && edgeEl.labels.length > 0) {
        const labelId = `${id}:label:0`
        const labelSvg = svgElement.querySelector(`[data-ir-id="${CSS.escape(labelId)}"]`) as SVGElement | null
        if (labelSvg) {
          openEdgeLabelEditor(svgElement, labelSvg, edgeEl.labels[0].text, id, 0, diagram, onLabelEdit)
          return
        }
      }
    }

    lastMousedownTime.set(id, now)
    lastMousedownPos.set(id, { x: event.clientX, y: event.clientY })
  }

  // Attach mousedown handlers for double-click detection BEFORE d3-drag
  // (uses native addEventListener to fire before d3's event handlers)
  if (clickZoneMap) {
    for (const [id, zone] of clickZoneMap) {
      zone.addEventListener('mousedown', (event: MouseEvent) => handleMousedown(id, event))
    }
  }
  for (const [id, el] of elementMap) {
    (el as SVGElement).addEventListener('mousedown', (event: MouseEvent) => handleMousedown(id, event))
  }

  // Attach click handlers to click zones for single-click selection
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

  // Double-click on background to add a new node at that position
  if (onLabelEdit) {
    d3.select(svgElement).on('dblclick', (event: MouseEvent) => {
      // Only add node if clicking on the SVG background, not on an element or click zone
      const target = event.target as Element
      if (target.closest?.('.d3-click-zone, [data-ir-id]')) return

      // Convert screen coords to SVG user units (inside zoom group)
      const zoomGroup = svgElement.querySelector('.d3-zoom-group') as SVGGraphicsElement | null
      if (!zoomGroup) return

      const pt = svgElement.createSVGPoint()
      pt.x = event.clientX
      pt.y = event.clientY
      const ctm = zoomGroup.getScreenCTM()
      if (!ctm) return
      const svgPt = pt.matrixTransform(ctm.inverse())

      // Convert SVG px to TikZ pt, with y-axis inversion
      const xPt = pxToPt(svgPt.x)
      const yPt = -pxToPt(svgPt.y) // SVG y is inverted vs TikZ

      const newId = addNode(diagram, xPt, yPt)
      onLabelEdit(diagram)
      // Select the new node and open label editor
      controller.highlightElement(newId)
      if (onSelect) onSelect(newId)
      // Wait for re-render, then open label editor on the new node
      setTimeout(() => {
        const newEl = svgElement.querySelector(`[data-ir-id="${CSS.escape(newId)}"]`) as SVGElement | null
        const node = findNode(diagram, newId)
        if (newEl && node) {
          openLabelEditor(svgElement, newEl, node, newId, diagram, onLabelEdit, nodeRegistry)
        }
      }, 50)
    })
  }
}

// ── Keyboard ─────────────────────────────────────────────────────────────────

/**
 * Set up keyboard shortcuts for the D3 editor.
 * - Delete/Backspace: remove selected element
 * - Escape: deselect
 * - Home/0: reset zoom to fit content
 * - +/=: zoom in, -: zoom out
 * - Arrow keys: nudge selected node by 1pt (Shift: 5pt)
 *
 * Returns a cleanup function to remove the listener.
 */
export function setupKeyboard(
  svgElement: SVGSVGElement,
  diagram: IRDiagram,
  controller: D3EditorController,
  getSelectedId: () => string | null,
  onIRChange: (diagram: IRDiagram) => void,
  onSelect?: (id: string | null) => void,
  nodeRegistry?: NodeGeometryRegistry,
): () => void {
  const NUDGE_PT = 1       // 1pt per arrow key press
  const NUDGE_SHIFT_PT = 5 // 5pt with Shift held

  function handleKeyDown(e: KeyboardEvent) {
    // Don't intercept when user is typing in an input
    if ((e.target as Element)?.tagName === 'INPUT' || (e.target as Element)?.tagName === 'TEXTAREA') return

    const selectedId = getSelectedId()

    // F2 or Enter: edit label of selected element (like spreadsheets)
    if ((e.key === 'F2' || e.key === 'Enter') && selectedId) {
      e.preventDefault()
      // Check if it's an edge label
      const edgeLabelMatch = selectedId.match(/^(.+):label:(\d+)$/)
      if (edgeLabelMatch) {
        const edgeId = edgeLabelMatch[1]
        const labelIdx = parseInt(edgeLabelMatch[2], 10)
        const edge = findElement(diagram.elements, edgeId)
        const el = svgElement.querySelector(`[data-ir-id="${CSS.escape(selectedId)}"]`) as SVGElement | null
        if (edge && edge.kind === 'edge' && labelIdx < edge.labels.length && el) {
          openEdgeLabelEditor(svgElement, el, edge.labels[labelIdx].text, edgeId, labelIdx, diagram, onIRChange)
          return
        }
      }
      // Check if it's a node
      const node = findNode(diagram, selectedId)
      const el = svgElement.querySelector(`[data-ir-id="${CSS.escape(selectedId)}"]`) as SVGElement | null
      if (node && el) {
        openLabelEditor(svgElement, el, node, selectedId, diagram, onIRChange, nodeRegistry)
        return
      }
      // Check if it's an edge with labels — open the first label for editing
      const edgeEl = findElement(diagram.elements, selectedId)
      if (edgeEl && edgeEl.kind === 'edge' && edgeEl.labels.length > 0) {
        const labelId = `${selectedId}:label:0`
        const labelEl = svgElement.querySelector(`[data-ir-id="${CSS.escape(labelId)}"]`) as SVGElement | null
        if (labelEl) {
          openEdgeLabelEditor(svgElement, labelEl, edgeEl.labels[0].text, selectedId, 0, diagram, onIRChange)
          return
        }
      }
    }

    if (e.key === 'Escape') {
      controller.highlightElement(null)
      if (onSelect) onSelect(null)
      return
    }

    // Home or 0: reset zoom to fit content
    if (e.key === 'Home' || (e.key === '0' && !e.ctrlKey && !e.metaKey && !selectedId)) {
      e.preventDefault()
      controller.resetZoom()
      return
    }

    // +/= to zoom in, - to zoom out
    if ((e.key === '+' || e.key === '=') && !e.ctrlKey && !e.metaKey) {
      e.preventDefault()
      controller.zoomIn()
      return
    }
    if (e.key === '-' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault()
      controller.zoomOut()
      return
    }

    // Undo: Ctrl+Z (or Cmd+Z on Mac)
    if (e.key === 'z' && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
      e.preventDefault()
      controller.undo()
      return
    }

    // Redo: Ctrl+Y or Ctrl+Shift+Z (or Cmd+Shift+Z on Mac)
    if ((e.key === 'y' && (e.ctrlKey || e.metaKey)) ||
        (e.key === 'z' && (e.ctrlKey || e.metaKey) && e.shiftKey)) {
      e.preventDefault()
      controller.redo()
      return
    }

    // Ctrl+D: duplicate selected element
    if (e.key === 'd' && (e.ctrlKey || e.metaKey) && selectedId) {
      e.preventDefault()
      const newId = duplicateElement(diagram, selectedId)
      if (newId) {
        onIRChange(diagram)
        // Select the new duplicate after re-render
        setTimeout(() => {
          controller.highlightElement(newId)
          if (onSelect) onSelect(newId)
        }, 0)
      }
      return
    }

    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
      e.preventDefault()
      if (removeElement(diagram, selectedId)) {
        controller.highlightElement(null)
        if (onSelect) onSelect(null)
        onIRChange(diagram)
      }
      return
    }

    // Tab: cycle selection through elements (Shift+Tab: reverse)
    if (e.key === 'Tab') {
      e.preventDefault()
      const allIds = Array.from(svgElement.querySelectorAll('[data-ir-id]'))
        .map(el => el.getAttribute('data-ir-id')!)
        .filter(id => id && !id.includes(':label:')) // skip edge labels for Tab cycling
      if (allIds.length === 0) return
      const currentIdx = selectedId ? allIds.indexOf(selectedId) : -1
      const next = e.shiftKey
        ? (currentIdx <= 0 ? allIds.length - 1 : currentIdx - 1)
        : (currentIdx < 0 || currentIdx >= allIds.length - 1 ? 0 : currentIdx + 1)
      const nextId = allIds[next]
      controller.highlightElement(nextId)
      if (onSelect) onSelect(nextId)
      return
    }

    // Arrow key nudge for selected nodes
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) && selectedId) {
      const node = findNode(diagram, selectedId)
      if (!node || !isDraggable(node)) return
      const coord = node.position.coord
      if (coord.cs !== 'xy') return

      e.preventDefault()
      const delta = e.shiftKey ? NUDGE_SHIFT_PT : NUDGE_PT
      let newX = coord.x
      let newY = coord.y
      if (e.key === 'ArrowLeft')  newX -= delta
      if (e.key === 'ArrowRight') newX += delta
      if (e.key === 'ArrowUp')    newY += delta // TikZ y increases upward
      if (e.key === 'ArrowDown')  newY -= delta
      moveNode(diagram, selectedId, newX, newY)
      onIRChange(diagram)
    }
  }

  svgElement.ownerDocument.addEventListener('keydown', handleKeyDown)
  return () => svgElement.ownerDocument.removeEventListener('keydown', handleKeyDown)
}

// ── Snap helper ──────────────────────────────────────────────────────────────

const PT_PER_CM = 28.4528

/** Snap a pt value to the nearest cm boundary (28.4528pt grid). */
function snapToCm(pt: number): number {
  return Math.round(pt / PT_PER_CM) * PT_PER_CM
}

// ── Guide line for axis-constrained drag ─────────────────────────────────────

const GUIDE_LINE_NS = 'http://www.w3.org/2000/svg'

/** Show or update a dashed guide line through the drag origin along the constrained axis. */
function updateGuideLine(
  state: DragState,
  altKey: boolean,
  currentPxX: number,
  currentPxY: number,
  container: SVGElement | SVGSVGElement,
): void {
  if (!altKey) {
    if (state.guideLine) { state.guideLine.remove(); state.guideLine = undefined }
    return
  }

  const startPxX = ptToPx(state.startPtX)
  const startPxY = -ptToPx(state.startPtY)
  const isHorizontal = currentPxY === startPxY // vertical locked → moving horizontally

  if (!state.guideLine) {
    state.guideLine = container.ownerDocument.createElementNS(GUIDE_LINE_NS, 'line')
    state.guideLine.setAttribute('stroke', '#f59e0b')
    state.guideLine.setAttribute('stroke-width', '0.8')
    state.guideLine.setAttribute('stroke-dasharray', '4 3')
    state.guideLine.setAttribute('pointer-events', 'none')
    state.guideLine.setAttribute('opacity', '0.6')
    container.appendChild(state.guideLine)
  }

  // Extend the line well beyond visible bounds
  const extent = 10000
  if (isHorizontal) {
    state.guideLine.setAttribute('x1', String(startPxX - extent))
    state.guideLine.setAttribute('y1', String(startPxY))
    state.guideLine.setAttribute('x2', String(startPxX + extent))
    state.guideLine.setAttribute('y2', String(startPxY))
  } else {
    state.guideLine.setAttribute('x1', String(startPxX))
    state.guideLine.setAttribute('y1', String(startPxY - extent))
    state.guideLine.setAttribute('x2', String(startPxX))
    state.guideLine.setAttribute('y2', String(startPxY + extent))
  }
}

// ── Coordinate tooltip during drag ───────────────────────────────────────────

const COORD_TOOLTIP_OFFSET_X = 12  // px offset right of the dragged position
const COORD_TOOLTIP_OFFSET_Y = -14 // px offset above the dragged position

/** Format a pt value as TikZ cm (e.g. "1.50"). */
function ptToCmStr(pt: number): string {
  return (pt / PT_PER_CM).toFixed(2)
}

/** Show or update a coordinate tooltip near the drag position. */
function updateCoordTooltip(
  state: { coordTooltip?: SVGGElement },
  xPt: number,
  yPt: number,
  pxX: number,
  pxY: number,
  container: SVGElement | SVGSVGElement,
): void {
  const doc = container.ownerDocument
  if (!state.coordTooltip) {
    state.coordTooltip = doc.createElementNS(GUIDE_LINE_NS, 'g')
    state.coordTooltip.setAttribute('pointer-events', 'none')

    const bg = doc.createElementNS(GUIDE_LINE_NS, 'rect')
    bg.setAttribute('rx', '3')
    bg.setAttribute('ry', '3')
    bg.setAttribute('fill', 'rgba(0,0,0,0.75)')
    state.coordTooltip.appendChild(bg)

    const text = doc.createElementNS(GUIDE_LINE_NS, 'text')
    text.setAttribute('fill', '#fff')
    text.setAttribute('font-family', 'monospace')
    text.setAttribute('font-size', '10')
    text.setAttribute('dominant-baseline', 'middle')
    state.coordTooltip.appendChild(text)

    container.appendChild(state.coordTooltip)
  }

  const text = state.coordTooltip.querySelector('text')!
  const bg = state.coordTooltip.querySelector('rect')!

  const label = `(${ptToCmStr(xPt)}, ${ptToCmStr(yPt)})`
  text.textContent = label

  const tx = pxX + COORD_TOOLTIP_OFFSET_X
  const ty = pxY + COORD_TOOLTIP_OFFSET_Y
  text.setAttribute('x', String(tx + 4))
  text.setAttribute('y', String(ty))

  // Size background to text — approximate width from character count
  const charWidth = 6.2
  const textWidth = label.length * charWidth
  bg.setAttribute('x', String(tx))
  bg.setAttribute('y', String(ty - 8))
  bg.setAttribute('width', String(textWidth + 8))
  bg.setAttribute('height', '16')
}

// ── Drag ─────────────────────────────────────────────────────────────────────

interface DragState {
  startPtX: number
  startPtY: number
  startPxX: number
  startPxY: number
  hasMoved: boolean
  /** Guide line element for Alt+drag axis constraint. */
  guideLine?: SVGLineElement
  /** Coordinate tooltip group (text + background rect). */
  coordTooltip?: SVGGElement
}

export function setupDrag(
  svgElement: SVGSVGElement,
  elementMap: Map<string, SVGElement>,
  diagram: IRDiagram,
  controller: D3EditorController,
  onIRChange?: (diagram: IRDiagram) => void,
  clickZoneMap?: Map<string, SVGRectElement>,
): void {
  const draggables = svgElement.querySelectorAll('.d3-draggable')

  for (const el of Array.from(draggables)) {
    const irId = el.getAttribute('data-ir-id')
    if (!irId) continue

    const node = findNode(diagram, irId)
    if (!node || !isDraggable(node)) continue

    // The drag target is the click zone (if present) since it sits on top
    // and receives mousedown events. Visual feedback is applied to the
    // actual element underneath.
    const dragTarget = clickZoneMap?.get(irId) ?? el
    const actualEl = el as SVGElement

    // Use the zoom group as the drag container so d3-drag computes
    // coordinates in the zoom group's local (pre-zoom) coordinate space.
    const zoomGroup = svgElement.querySelector('.d3-zoom-group') as SVGGElement | null
    const dragBehavior = d3Drag<SVGElement, unknown>()
      .container(zoomGroup ?? svgElement as any)
      .on('start', function (event) {
        d3.select(actualEl).classed('d3-dragging', true)
        // Store initial IR position
        const coord = node.position.coord
        if (coord.cs === 'xy') {
          const state: DragState = {
            startPtX: coord.x,
            startPtY: coord.y,
            startPxX: event.x,
            startPxY: event.y,
            hasMoved: false,
          }
          d3.select(this).datum(state)
        }
      })
      .on('drag', function (event) {
        const state = d3.select(this).datum() as DragState
        if (!state) return
        state.hasMoved = true

        // Compute delta in SVG coordinates (which are already in px units from the viewBox)
        const dxPx = event.x - state.startPxX
        const dyPx = event.y - state.startPxY

        // Convert px delta to pt delta
        // Note: SVG y-axis is inverted relative to TikZ, so negate dy
        const dxPt = pxToPt(dxPx)
        const dyPt = -pxToPt(dyPx)

        let newXPt = state.startPtX + dxPt
        let newYPt = state.startPtY + dyPt

        // Alt+drag: constrain to dominant axis (H or V)
        const altKey = event.sourceEvent?.altKey
        if (altKey) {
          if (Math.abs(dxPt) >= Math.abs(dyPt)) {
            newYPt = state.startPtY // lock vertical
          } else {
            newXPt = state.startPtX // lock horizontal
          }
        }

        // Shift+drag: snap to nearest cm grid
        if (event.sourceEvent?.shiftKey) {
          newXPt = snapToCm(newXPt)
          newYPt = snapToCm(newYPt)
        }

        // Update IR
        moveNode(diagram, irId, newXPt, newYPt)

        // Update SVG transform directly for immediate visual feedback
        const newPxX = ptToPx(newXPt)
        // Y is negated in SVG space
        const newPxY = -ptToPx(newYPt)

        const translate = `translate(${newPxX.toFixed(2)}, ${newPxY.toFixed(2)})`
        const transform = actualEl.getAttribute('transform') || ''
        const newTransform = /translate\([^)]*\)/.test(transform)
          ? transform.replace(/translate\([^)]*\)/, translate)
          : translate + (transform ? ' ' + transform : '')
        actualEl.setAttribute('transform', newTransform)

        // Show/hide guide line for Alt+drag axis constraint
        updateGuideLine(state, altKey, newPxX, newPxY, zoomGroup ?? svgElement)
        // Show coordinate tooltip
        updateCoordTooltip(state, newXPt, newYPt, newPxX, newPxY, zoomGroup ?? svgElement)
      })
      .on('end', function () {
        d3.select(actualEl).classed('d3-dragging', false)
        const state = d3.select(this).datum() as DragState | null
        // Remove guide line and tooltip on drag end
        if (state?.guideLine) { state.guideLine.remove(); state.guideLine = undefined }
        if (state?.coordTooltip) { state.coordTooltip.remove(); state.coordTooltip = undefined }
        // Only trigger re-render if the mouse actually moved during drag.
        // A zero-distance "drag" is just a click — re-rendering would destroy
        // DOM state needed for double-click detection.
        if (state?.hasMoved && onIRChange) onIRChange(diagram)
      })

    // Attach drag to click zone (receives real user events from DOM top layer)
    // AND to the actual element (receives E2E test dispatched events)
    d3.select(dragTarget as SVGElement).call(dragBehavior)
    if (dragTarget !== el) {
      d3.select(el as SVGElement).call(dragBehavior)
    }
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
      border: 2px solid #f59e0b;
      border-radius: 2px;
      background: rgba(255, 255, 255, 0.95);
      color: #111;
      font-family: monospace;
      font-size: 13px;
      padding: 0;
      outline: none;
      z-index: 1000;
      box-shadow: 0 2px 12px rgba(0,0,0,0.25);
      text-align: center;
      box-sizing: border-box;
    }
    .d3-label-input:focus {
      border-color: #f59e0b;
      box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.25), 0 2px 12px rgba(0,0,0,0.25);
    }
    .d3-click-zone:hover {
      fill: rgba(245, 158, 11, 0.06);
      stroke: rgba(245, 158, 11, 0.3);
      stroke-width: 1;
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
  /** Which SVG command type this segment emits: 'C' for cubic, 'L' for line. */
  svgCommandType: 'C' | 'L'
  /** Index of the SVG command of this type to modify. */
  commandIndex: number
  /** True when the curve segment has only one control point (cp1 === cp2 in SVG). */
  singleControl: boolean
  /** Coordinate tooltip group. */
  coordTooltip?: SVGGElement
}

/**
 * Update a point in an SVG path `d` string for live preview during drag.
 *
 * Supports:
 * - 'move': updates the M command (start point)
 * - 'cp1'/'cp2'/'to' with svgCommandType 'C': updates the Nth C command
 * - 'to' with svgCommandType 'L': updates the Nth L command (line endpoints)
 *
 * C command structure: C cx1 cy1 cx2 cy2 x y
 * L command structure: L x y
 */
function updatePathD(
  d: string,
  commandIndex: number,
  cpRole: CpRole,
  newX: number,
  newY: number,
  singleControl = false,
  svgCommandType: 'C' | 'L' = 'C',
): string {
  // Move command: update M x y
  if (cpRole === 'move') {
    return d.replace(
      /^M\s+([-\d.e]+)\s+([-\d.e]+)/i,
      `M ${newX.toFixed(2)} ${newY.toFixed(2)}`,
    )
  }

  // Line commands: find the Nth L command
  if (svgCommandType === 'L') {
    const lineRegex = /L\s+([-\d.e]+)\s+([-\d.e]+)/gi
    let match: RegExpExecArray | null
    let idx = 0
    while ((match = lineRegex.exec(d)) !== null) {
      if (idx === commandIndex) {
        const replacement = `L ${newX.toFixed(2)} ${newY.toFixed(2)}`
        return d.slice(0, match.index) + replacement + d.slice(match.index + match[0].length)
      }
      idx++
    }
    return d
  }

  // Cubic commands: find the Nth C command
  const cubicRegex = /C\s+([-\d.e]+)\s+([-\d.e]+)\s+([-\d.e]+)\s+([-\d.e]+)\s+([-\d.e]+)\s+([-\d.e]+)/gi
  let match: RegExpExecArray | null
  let idx = 0

  while ((match = cubicRegex.exec(d)) !== null) {
    if (idx === commandIndex) {
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
 * Find the `<path>` element for a given IR path id and determine which SVG command
 * corresponds to the given segment index.
 *
 * Each IR segment kind maps to SVG commands:
 *   - curve, sin, cos → C (cubic)
 *   - parabola → C (1 or 2 cubics depending on explicit bend)
 *   - line, hv-line, to → L (line-to)
 *   - move → M (handled separately)
 */
function findPathElAndCommandInfo(
  svg: SVGSVGElement,
  pathId: string,
  segIdx: number,
  diagram: IRDiagram,
): { pathEl: SVGPathElement | null; svgCommandType: 'C' | 'L'; commandIndex: number; singleControl: boolean } {
  // Find the <path> element via data-ir-id
  const container = svg.querySelector(`[data-ir-id="${CSS.escape(pathId)}"]`)
  const pathEl = container?.tagName.toLowerCase() === 'path'
    ? container as SVGPathElement
    : container?.querySelector('path') as SVGPathElement | null

  const el = findElement(diagram.elements, pathId)
  let cubicIndex = 0
  let lineIndex = 0
  let singleControl = false
  let svgCommandType: 'C' | 'L' = 'C'

  if (el && el.kind === 'path') {
    // Count SVG commands emitted by segments before segIdx
    for (let i = 0; i < el.segments.length && i < segIdx; i++) {
      const s = el.segments[i]
      if (s.kind === 'curve' || s.kind === 'sin' || s.kind === 'cos') {
        cubicIndex++
      } else if (s.kind === 'parabola') {
        cubicIndex += (s as any).bend ? 2 : 1
      } else if (s.kind === 'line' || s.kind === 'hv-line' || s.kind === 'to') {
        lineIndex++
      }
    }

    const seg = el.segments[segIdx]
    if (seg) {
      if (seg.kind === 'curve') {
        singleControl = seg.controls.length === 1
        svgCommandType = 'C'
      } else if (seg.kind === 'parabola') {
        // For parabola with explicit bend, the endpoint is the 2nd C command
        if ((seg as any).bend) cubicIndex++
        svgCommandType = 'C'
      } else if (seg.kind === 'sin' || seg.kind === 'cos') {
        svgCommandType = 'C'
      } else if (seg.kind === 'line' || seg.kind === 'hv-line' || seg.kind === 'to') {
        svgCommandType = 'L'
      }
    }
  }

  return {
    pathEl,
    svgCommandType,
    commandIndex: svgCommandType === 'L' ? lineIndex : cubicIndex,
    singleControl,
  }
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

        const { pathEl, svgCommandType, commandIndex, singleControl } = findPathElAndCommandInfo(svg, pathId, segIdx, diagram)

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
          svgCommandType,
          commandIndex,
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
          const updatedD = updatePathD(state.originalD, state.commandIndex, state.cpRole, newCx, newCy, state.singleControl, state.svgCommandType)
          state.pathEl.setAttribute('d', updatedD)
        }

        // Show coordinate tooltip (compute current pt from px delta)
        const dxPt = pxToPt(newCx - state.startPxX)
        const dyPt = -pxToPt(newCy - state.startPxY)
        const curPtX = state.startPtX + dxPt
        const curPtY = state.startPtY + dyPt
        const zg = svg.querySelector('.d3-zoom-group') as SVGElement | null
        updateCoordTooltip(state, curPtX, curPtY, newCx, newCy, zg ?? svg)
      })
      .on('end', function (event) {
        d3.select(this).attr('cursor', 'grab')
        const state = d3.select(this).datum() as CPDragState
        if (!state) return
        if (state.coordTooltip) { state.coordTooltip.remove(); state.coordTooltip = undefined }

        // Convert SVG px delta to TikZ pt, accounting for y-axis inversion
        const dxPt = pxToPt(event.x - state.startPxX)
        const dyPt = -pxToPt(event.y - state.startPxY)

        let newXPt = state.startPtX + dxPt
        let newYPt = state.startPtY + dyPt

        // Alt+drag: constrain to dominant axis (H or V)
        if (event.sourceEvent?.altKey) {
          if (Math.abs(dxPt) >= Math.abs(dyPt)) {
            newYPt = state.startPtY
          } else {
            newXPt = state.startPtX
          }
        }

        // Shift+drag: snap to nearest cm grid
        if (event.sourceEvent?.shiftKey) {
          newXPt = snapToCm(newXPt)
          newYPt = snapToCm(newYPt)
        }

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

const SVG_NS = 'http://www.w3.org/2000/svg'
const XHTML_NS = 'http://www.w3.org/1999/xhtml'

/**
 * Open an inline text input over a node to edit its label.
 * Uses SVG <foreignObject> inside the zoom group so the input is positioned
 * in the same coordinate space as the highlight bbox — no CSS/screen offset math.
 */
function openLabelEditor(
  svgElement: SVGSVGElement,
  el: SVGElement,
  node: IRNode,
  id: string,
  diagram: IRDiagram,
  onIRChange: (diagram: IRDiagram) => void,
  nodeRegistry?: NodeGeometryRegistry,
): void {
  const doc = svgElement.ownerDocument
  if (!doc) return

  // Remove any existing label editor
  svgElement.querySelectorAll('.d3-label-editor').forEach((e) => e.remove())

  // Compute bbox in SVG user-unit space — same logic as addNodeHighlight
  let x: number, y: number, w: number, h: number
  const geo = nodeRegistry?.getById(id)
  if (geo) {
    x = geo.centerX - geo.halfWidth
    y = geo.centerY - geo.halfHeight
    w = geo.halfWidth * 2
    h = geo.halfHeight * 2
  } else {
    try {
      const bbox = (el as unknown as SVGGraphicsElement).getBBox?.()
      if (!bbox || bbox.width <= 0 || bbox.height <= 0) return
      x = bbox.x
      y = bbox.y
      w = bbox.width
      h = bbox.height
    } catch {
      return
    }
  }

  const pad = 4
  const minW = 80
  const minH = 24
  const foW = Math.max(minW, w + pad * 2)
  const foH = Math.max(minH, h + pad * 2)

  // Center the foreignObject over the node bbox
  const foX = x + w / 2 - foW / 2
  const foY = y + h / 2 - foH / 2

  const fo = doc.createElementNS(SVG_NS, 'foreignObject')
  fo.setAttribute('class', 'd3-label-editor')
  fo.setAttribute('x', String(foX))
  fo.setAttribute('y', String(foY))
  fo.setAttribute('width', String(foW))
  fo.setAttribute('height', String(foH))

  const input = doc.createElementNS(XHTML_NS, 'input') as HTMLInputElement
  input.setAttribute('type', 'text')
  input.setAttribute('class', 'd3-label-input')
  input.setAttribute('value', node.label)
  // Inline styles since CSS may not apply inside foreignObject in all browsers
  input.style.width = '100%'
  input.style.height = '100%'
  input.style.border = '2px solid #f59e0b'
  input.style.borderRadius = '2px'
  input.style.background = 'rgba(255, 255, 255, 0.95)'
  input.style.color = '#111'
  input.style.fontFamily = 'monospace'
  input.style.fontSize = '13px'
  input.style.padding = '0'
  input.style.outline = 'none'
  input.style.textAlign = 'center'
  input.style.boxSizing = 'border-box'
  input.style.boxShadow = '0 2px 12px rgba(0,0,0,0.25)'

  fo.appendChild(input)

  // Append inside the zoom group so it transforms with zoom/pan
  const zoomGroup = svgElement.querySelector('.d3-zoom-group')
  ;(zoomGroup ?? svgElement).appendChild(fo)

  let committed = false

  function commit() {
    if (committed) return
    committed = true
    doc.removeEventListener('mousedown', onClickOutside, true)
    const newLabel = input.value
    fo.remove()
    if (newLabel !== node.label) {
      updateNodeLabel(diagram, id, newLabel)
      onIRChange(diagram)
    }
  }

  function cancel() {
    if (committed) return
    committed = true
    doc.removeEventListener('mousedown', onClickOutside, true)
    fo.remove()
  }

  function onClickOutside(e: MouseEvent) {
    if (fo.contains(e.target as Node)) return
    e.preventDefault()
    e.stopPropagation()
    commit()
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      commit()
    } else if (e.key === 'Escape') {
      cancel()
    }
  })

  // Delay click-outside listener so the double-click that opened the editor doesn't close it
  setTimeout(() => {
    if (!committed) {
      doc.addEventListener('mousedown', onClickOutside, true)
    }
  }, 0)

  input.focus()
  input.select()
}

/**
 * Open an inline text input over an edge label to edit it.
 * Similar to openLabelEditor but uses updateEdgeLabel instead of updateNodeLabel.
 */
function openEdgeLabelEditor(
  svgElement: SVGSVGElement,
  el: SVGElement,
  currentText: string,
  edgeId: string,
  labelIndex: number,
  diagram: IRDiagram,
  onIRChange: (diagram: IRDiagram) => void,
): void {
  const doc = svgElement.ownerDocument
  if (!doc) return

  // Remove any existing label editor
  svgElement.querySelectorAll('.d3-label-editor').forEach((e) => e.remove())

  // Get bbox in zoom group coordinate space.
  // Edge label <g> elements have a transform="translate(x,y)" so getBBox()
  // returns local coordinates. We need to offset by the element's CTM.
  let x: number, y: number, w: number, h: number
  try {
    const gfx = el as unknown as SVGGraphicsElement
    const bbox = gfx.getBBox?.()
    if (!bbox || bbox.width <= 0 || bbox.height <= 0) return

    // Get the element's transform relative to the nearest viewport (SVG root)
    const zoomGroup = svgElement.querySelector('.d3-zoom-group') as SVGGraphicsElement | null
    const elCTM = gfx.getCTM?.()
    const zgCTM = zoomGroup?.getCTM?.()
    if (elCTM && zgCTM) {
      // Compute element→zoomGroup transform
      const inv = zgCTM.inverse()
      const rel = inv.multiply(elCTM)
      x = rel.a * bbox.x + rel.c * bbox.y + rel.e
      y = rel.b * bbox.x + rel.d * bbox.y + rel.f
      w = bbox.width * Math.abs(rel.a)
      h = bbox.height * Math.abs(rel.d)
    } else {
      x = bbox.x
      y = bbox.y
      w = bbox.width
      h = bbox.height
    }
  } catch {
    return
  }

  const pad = 4
  const minW = 80
  const minH = 24
  const foW = Math.max(minW, w + pad * 2)
  const foH = Math.max(minH, h + pad * 2)
  const foX = x + w / 2 - foW / 2
  const foY = y + h / 2 - foH / 2

  const fo = doc.createElementNS(SVG_NS, 'foreignObject')
  fo.setAttribute('class', 'd3-label-editor')
  fo.setAttribute('x', String(foX))
  fo.setAttribute('y', String(foY))
  fo.setAttribute('width', String(foW))
  fo.setAttribute('height', String(foH))

  const input = doc.createElementNS(XHTML_NS, 'input') as HTMLInputElement
  input.setAttribute('type', 'text')
  input.setAttribute('class', 'd3-label-input')
  input.setAttribute('value', currentText)
  input.style.width = '100%'
  input.style.height = '100%'
  input.style.border = '2px solid #f59e0b'
  input.style.borderRadius = '2px'
  input.style.background = 'rgba(255, 255, 255, 0.95)'
  input.style.color = '#111'
  input.style.fontFamily = 'monospace'
  input.style.fontSize = '13px'
  input.style.padding = '0'
  input.style.outline = 'none'
  input.style.textAlign = 'center'
  input.style.boxSizing = 'border-box'
  input.style.boxShadow = '0 2px 12px rgba(0,0,0,0.25)'

  fo.appendChild(input)

  const zoomGroup = svgElement.querySelector('.d3-zoom-group')
  ;(zoomGroup ?? svgElement).appendChild(fo)

  let committed = false

  function commit() {
    if (committed) return
    committed = true
    doc.removeEventListener('mousedown', onClickOutside, true)
    const newLabel = input.value
    fo.remove()
    if (newLabel !== currentText) {
      updateEdgeLabel(diagram, edgeId, labelIndex, newLabel)
      onIRChange(diagram)
    }
  }

  function cancel() {
    if (committed) return
    committed = true
    doc.removeEventListener('mousedown', onClickOutside, true)
    fo.remove()
  }

  function onClickOutside(e: MouseEvent) {
    if (fo.contains(e.target as Node)) return
    e.preventDefault()
    e.stopPropagation()
    commit()
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      commit()
    } else if (e.key === 'Escape') {
      cancel()
    }
  })

  setTimeout(() => {
    if (!committed) {
      doc.addEventListener('mousedown', onClickOutside, true)
    }
  }, 0)

  input.focus()
  input.select()
}
