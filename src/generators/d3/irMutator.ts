/**
 * IR mutation functions for the D3 interactive editor.
 *
 * These functions locate and modify IR elements in place.
 * The IR is the single source of truth — D3 reads from it and writes back.
 */

import type { IRDiagram, IRElement, IRNode, IRScope, IRMatrix } from '../../ir/types.js'

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
 * Returns true if the node was moved.
 */
export function moveNode(diagram: IRDiagram, nodeId: string, newXPt: number, newYPt: number): boolean {
  const node = findNode(diagram, nodeId)
  if (!node) return false
  if (node.position.coord.cs !== 'xy') return false

  node.position.coord.x = newXPt
  node.position.coord.y = newYPt
  return true
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
