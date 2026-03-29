/**
 * IR mutation functions for the D3 interactive editor.
 *
 * These functions locate and modify IR elements in place.
 * The IR is the single source of truth — D3 reads from it and writes back.
 */

import type { IRDiagram, IRElement, IRNode, IRScope, IRMatrix, ResolvedStyle } from '../../ir/types.js'
import { makeNode, coordRef, nextId } from '../../parser/factory.js'

export type CpRole = 'cp1' | 'cp2' | 'to' | 'move'

/**
 * Walk the element tree (including scope children and matrix cells)
 * and return the element with the given id.
 */
export function findElement(elements: IRElement[], id: string): IRElement | null {
  for (const el of elements) {
    if (el.kind !== 'knot' && 'id' in el && el.id === id) return el
    if (el.kind === 'scope') {
      const found = findElement(el.children, id)
      if (found) return found
    }
    if (el.kind === 'matrix') {
      for (const row of el.rows) {
        for (const cell of row) {
          if (cell && cell.id === id) return cell
        }
      }
    }
    if (el.kind === 'path') {
      for (const node of el.inlineNodes) {
        if (node.id === id) return node
      }
    }
  }
  return null
}

/**
 * Find an IRNode by id in the diagram.
 */
export function findNode(diagram: IRDiagram, nodeId: string): IRNode | null {
  const el = findElement(diagram.elements, nodeId)
  if (el && el.kind === 'node') return el
  return null
}

/**
 * Check if a node's position can be dragged (only xy coordinates).
 */
export function isDraggable(node: IRNode): boolean {
  return node.position.coord.cs === 'xy'
}

/**
 * Move a node to a new position (in TeX points).
 * Only works for nodes with xy coordinates.
 * Also updates the enclosing path's move segment if the node is an inline node
 * (the parser stores the coordinate in both the node position and the move segment).
 * Returns true if the node was moved.
 */
export function moveNode(diagram: IRDiagram, nodeId: string, newXPt: number, newYPt: number): boolean {
  const node = findNode(diagram, nodeId)
  if (!node) return false
  if (node.position.coord.cs !== 'xy') return false

  node.position.coord.x = newXPt
  node.position.coord.y = newYPt

  // Also update the enclosing path's move segment for inline nodes
  updateInlineNodeMoveSegment(diagram.elements, nodeId, newXPt, newYPt)

  return true
}

/** Find the path containing an inline node and update its preceding move segment. */
function updateInlineNodeMoveSegment(elements: IRElement[], nodeId: string, x: number, y: number): void {
  for (const el of elements) {
    if (el.kind === 'path') {
      for (let i = 0; i < el.segments.length; i++) {
        const seg = el.segments[i]
        if (seg.kind === 'node-on-path' && seg.nodeId === nodeId) {
          // Walk backwards to find the preceding move segment
          for (let j = i - 1; j >= 0; j--) {
            const prev = el.segments[j]
            if (prev.kind === 'move' && prev.to.mode === 'absolute' && prev.to.coord.cs === 'xy') {
              prev.to.coord.x = x
              prev.to.coord.y = y
              return
            }
          }
        }
      }
    }
    if (el.kind === 'scope') updateInlineNodeMoveSegment(el.children, nodeId, x, y)
  }
}

/**
 * Update a node's label text.
 */
export function updateNodeLabel(diagram: IRDiagram, nodeId: string, newLabel: string): boolean {
  const node = findNode(diagram, nodeId)
  if (!node) return false
  node.label = newLabel
  return true
}

/**
 * Update an edge's label text.
 */
export function updateEdgeLabel(diagram: IRDiagram, edgeId: string, labelIndex: number, newLabel: string): boolean {
  const el = findElement(diagram.elements, edgeId)
  if (!el || el.kind !== 'edge') return false
  if (labelIndex < 0 || labelIndex >= el.labels.length) return false
  el.labels[labelIndex].text = newLabel
  return true
}

/**
 * Get all node IDs that are connected to a given node via edges.
 * Returns the edge IDs and connected node IDs for selective re-rendering.
 */
export function getConnectedEdges(diagram: IRDiagram, nodeId: string): string[] {
  const edgeIds: string[] = []
  function walk(elements: IRElement[]) {
    for (const el of elements) {
      if ((el.kind === 'edge' || ('tikzcdKind' in el && el.tikzcdKind)) && 'from' in el) {
        if (el.from === nodeId || el.to === nodeId) {
          edgeIds.push(el.id)
        }
      }
      if (el.kind === 'scope') walk(el.children)
    }
  }
  walk(diagram.elements)
  return edgeIds
}

/**
 * Update a bezier curve segment's control point or endpoint (in TeX pt).
 * segIdx: index into path.segments.
 * cpRole: 'cp1' (controls[0]), 'cp2' (controls[1]), 'to' (curve endpoint),
 *         or 'move' (move segment start point).
 * Only updates coords with cs === 'xy' and mode === 'absolute'. Returns true if updated.
 */
export function updateCurveControl(
  diagram: IRDiagram,
  pathId: string,
  segIdx: number,
  cpRole: CpRole,
  xPt: number,
  yPt: number,
): boolean {
  const el = findElement(diagram.elements, pathId)
  if (!el || el.kind !== 'path') return false
  const seg = el.segments[segIdx]
  if (!seg) return false

  // Move segment start point
  if (cpRole === 'move') {
    if (seg.kind !== 'move') return false
    if (seg.to.mode !== 'absolute' || seg.to.coord.cs !== 'xy') return false
    seg.to.coord.x = xPt
    seg.to.coord.y = yPt
    return true
  }

  if (seg.kind !== 'curve') return false

  if (cpRole === 'to') {
    if (seg.to.mode !== 'absolute' || seg.to.coord.cs !== 'xy') return false
    seg.to.coord.x = xPt
    seg.to.coord.y = yPt
    return true
  }

  const cpIdx = cpRole === 'cp1' ? 0 : 1
  const cp = seg.controls[cpIdx]
  if (!cp || cp.mode !== 'absolute' || cp.coord.cs !== 'xy') return false
  cp.coord.x = xPt
  cp.coord.y = yPt
  return true
}

// ── Segment endpoint mutations ────────────────────────────────────────────────

/**
 * Move a path segment's endpoint (line, hv-line, to) to a new position (in TeX pt).
 * Only updates segments with absolute xy coordinates. Returns true if updated.
 */
export function moveSegmentEndpoint(
  diagram: IRDiagram,
  pathId: string,
  segIdx: number,
  xPt: number,
  yPt: number,
): boolean {
  const el = findElement(diagram.elements, pathId)
  if (!el || el.kind !== 'path') return false
  const seg = el.segments[segIdx]
  if (!seg) return false

  if (seg.kind !== 'line' && seg.kind !== 'hv-line' && seg.kind !== 'to' && seg.kind !== 'move'
    && seg.kind !== 'parabola' && seg.kind !== 'sin' && seg.kind !== 'cos') return false
  if (seg.to.mode !== 'absolute' || seg.to.coord.cs !== 'xy') return false

  seg.to.coord.x = xPt
  seg.to.coord.y = yPt
  return true
}

// ── Element removal ──────────────────────────────────────────────────────────

/**
 * Remove an element from the diagram by id.
 * Searches top-level elements, scope children, and path inline nodes.
 * Returns true if the element was found and removed.
 */
/**
 * Add a new node to the diagram at the given position (in TikZ pt).
 * Returns the new node's id.
 */
export function addNode(diagram: IRDiagram, xPt: number, yPt: number, label = ''): string {
  const style: ResolvedStyle = {}
  const node = makeNode(coordRef(xPt, yPt), label, style, [])
  diagram.elements.push(node)
  return node.id
}

/**
 * Duplicate an element in the diagram. Nodes get offset by 10pt so the copy
 * is visually distinct. Returns the new element's id, or null if not found.
 */
export function duplicateElement(diagram: IRDiagram, elementId: string): string | null {
  const el = findElement(diagram.elements, elementId)
  if (!el) return null

  // Deep clone and assign fresh ID
  const clone = JSON.parse(JSON.stringify(el)) as IRElement
  const newId = nextId(el.kind)
  if ('id' in clone) (clone as any).id = newId

  // Offset node position so the duplicate is visually distinct
  if (clone.kind === 'node') {
    const coord = clone.position.coord
    if (coord.cs === 'xy') {
      coord.x += 10
      coord.y -= 10
    }
    // Clear name to avoid duplicate named nodes
    clone.name = undefined
  }

  // Reassign IDs for inline nodes in paths, updating segment references
  if (clone.kind === 'path') {
    const idMap = new Map<string, string>()
    for (const n of clone.inlineNodes) {
      const oldId = n.id
      const newNodeId = nextId('node')
      idMap.set(oldId, newNodeId)
      n.id = newNodeId
      n.name = undefined
    }
    // Update node-on-path segment references to use new IDs
    for (const seg of clone.segments) {
      if (seg.kind === 'node-on-path' && idMap.has(seg.nodeId)) {
        seg.nodeId = idMap.get(seg.nodeId)!
      }
    }
  }

  diagram.elements.push(clone)
  return newId
}

export function removeElement(diagram: IRDiagram, elementId: string): boolean {
  // Check if the element is a node — if so, also remove connected edges
  const el = findElement(diagram.elements, elementId)
  if (el && el.kind === 'node') {
    const connectedEdgeIds = getConnectedEdges(diagram, elementId)
    for (const edgeId of connectedEdgeIds) {
      removeFromList(diagram.elements, edgeId)
    }
  }
  return removeFromList(diagram.elements, elementId)
}

function removeFromList(elements: IRElement[], id: string): boolean {
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i]
    if (el.kind !== 'knot' && 'id' in el && el.id === id) {
      elements.splice(i, 1)
      return true
    }
    if (el.kind === 'scope') {
      if (removeFromList(el.children, id)) return true
    }
    if (el.kind === 'path') {
      for (let j = 0; j < el.inlineNodes.length; j++) {
        if (el.inlineNodes[j].id === id) {
          el.inlineNodes.splice(j, 1)
          // Also remove the corresponding node-on-path segment
          for (let k = 0; k < el.segments.length; k++) {
            const seg = el.segments[k]
            if (seg.kind === 'node-on-path' && seg.nodeId === id) {
              el.segments.splice(k, 1)
              break
            }
          }
          return true
        }
      }
    }
  }
  return false
}

// ── Style property mutations ─────────────────────────────────────────────────

/**
 * Set a style property on an element.
 * The key must be a valid ResolvedStyle key. Returns true if updated.
 */
export function setStyleProp(
  diagram: IRDiagram,
  elementId: string,
  key: string,
  value: string | number | boolean | undefined,
): boolean {
  const el = findElement(diagram.elements, elementId)
  if (!el || !('style' in el)) return false
  ;(el.style as any)[key] = value
  return true
}

/**
 * Collect all IRNode elements from the diagram (including nested in scopes, matrices, paths).
 */
export function collectNodes(elements: IRElement[]): IRNode[] {
  const nodes: IRNode[] = []
  for (const el of elements) {
    if (el.kind === 'node') nodes.push(el)
    if (el.kind === 'scope') nodes.push(...collectNodes(el.children))
    if (el.kind === 'matrix') {
      for (const row of el.rows) {
        for (const cell of row) {
          if (cell) nodes.push(cell)
        }
      }
    }
    if (el.kind === 'path') {
      nodes.push(...el.inlineNodes)
    }
  }
  return nodes
}
