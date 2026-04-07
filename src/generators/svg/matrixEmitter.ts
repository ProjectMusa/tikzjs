/**
 * Matrix emitter: renders IRMatrix (tikzcd and \matrix) to a positioned grid of nodes.
 *
 * Layout algorithm:
 * 1. Render all cells to measure their content dimensions
 * 2. Compute per-column max-width and per-row max-height
 * 3. Position nodes on a grid using columnSep and rowSep
 * 4. Register all node geometries so that edge emitter can resolve anchors
 */

import { IRMatrix, IRNode } from '../../ir/types.js'
import { CoordResolver, NodeGeometryRegistry, ptToPx } from './coordResolver.js'
import { BoundingBox, fromCorners, mergeBBoxes } from './boundingBox.js'
import { emitNode } from './nodeEmitter.js'
import { MathRenderer, mathModeRenderer } from '../../math/index.js'
import type { TextMeasurer } from '../../math/textLayout.js'
import { heuristicMeasurer } from '../../math/textLayout.js'
import { TIKZ_CONSTANTS, DEFAULT_CONSTANTS, SVGRenderingConstants } from './constants.js'

/** Default tikzcd separations (matching TikZ defaults). */
const DEFAULT_COL_SEP_PX = ptToPx(TIKZ_CONSTANTS.DEFAULT_COL_SEP_PT) // 2cm
const DEFAULT_ROW_SEP_PX = ptToPx(TIKZ_CONSTANTS.DEFAULT_ROW_SEP_PT) // 1cm

export interface MatrixRenderResult {
  elements: Element[]
  bbox: BoundingBox
}

/**
 * Render an IRMatrix to SVG elements.
 * Node positions are assigned here; the CoordResolver and NodeGeometryRegistry
 * are updated so that subsequent edge rendering can find the node geometries.
 */
export function emitMatrix(
  matrix: IRMatrix,
  document: Document,
  resolver: CoordResolver,
  nodeRegistry: NodeGeometryRegistry,
  mathRenderer: MathRenderer = mathModeRenderer,
  constants: SVGRenderingConstants = DEFAULT_CONSTANTS,
  textMeasurer: TextMeasurer = heuristicMeasurer,
): MatrixRenderResult {
  const elements: Element[] = []
  const bboxes: BoundingBox[] = []

  const colSepPx = matrix.columnSep !== undefined ? ptToPx(matrix.columnSep) : DEFAULT_COL_SEP_PX
  const rowSepPx = matrix.rowSep    !== undefined ? ptToPx(matrix.rowSep)    : DEFAULT_ROW_SEP_PX

  const rows = matrix.rows
  const rowCount = rows.length
  const colCount = rows.reduce((m, r) => Math.max(m, r.length), 0)

  // Step 1: Pre-measure all cells to get their natural sizes
  const colWidths: number[]  = Array(colCount).fill(0)
  const rowHeights: number[] = Array(rowCount).fill(0)

  for (let r = 0; r < rowCount; r++) {
    for (let c = 0; c < colCount; c++) {
      const node = rows[r]?.[c]
      if (!node) continue
      const { hw, hh } = measureNode(node, mathRenderer)
      colWidths[c]  = Math.max(colWidths[c],  hw * 2)
      rowHeights[r] = Math.max(rowHeights[r], hh * 2)
    }
  }

  // Step 2: Compute cumulative x/y positions for each column/row
  const matrixOrigin = resolver.resolve(matrix.position)
  const ox = matrixOrigin.x
  const oy = matrixOrigin.y

  // Compute total width and height
  const totalWidth  = colWidths.reduce((s, w) => s + w + colSepPx, -colSepPx)
  const totalHeight = rowHeights.reduce((s, h) => s + h + rowSepPx, -rowSepPx)

  // Column centers (relative to matrix top-left)
  const colCenters: number[] = []
  let cx = -totalWidth / 2
  for (let c = 0; c < colCount; c++) {
    cx += colWidths[c] / 2
    colCenters.push(cx)
    cx += colWidths[c] / 2 + colSepPx
  }

  // Row centers (relative to matrix top)
  const rowCenters: number[] = []
  let cy = -totalHeight / 2
  for (let r = 0; r < rowCount; r++) {
    cy += rowHeights[r] / 2
    rowCenters.push(cy)
    cy += rowHeights[r] / 2 + rowSepPx
  }

  // Step 3: Render each cell, updating its position in the IR
  for (let r = 0; r < rowCount; r++) {
    for (let c = 0; c < colCount; c++) {
      const node = rows[r]?.[c]
      if (!node) continue

      // Override node position to the computed grid position
      const nodeX = ox + colCenters[c]
      const nodeY = oy + rowCenters[r]

      // Temporarily override position for rendering
      const nodeWithPos: IRNode = {
        ...node,
        position: { mode: 'absolute', coord: { cs: 'xy', x: 0, y: 0 } },
      }

      // Create a local resolver clone with current position set to the cell center
      const localResolver = resolver.clone()
      localResolver.setCurrent(nodeX, nodeY)

      // Override the position reference to be the cell center in pixels
      const patchedNode: IRNode = {
        ...node,
        position: {
          mode: 'absolute',
          coord: {
            cs: 'xy',
            // Convert back from px to pt for the coord system
            x: nodeX / constants.PT_TO_PX,
            y: -nodeY / constants.PT_TO_PX,
          },
        },
      }

      const result = emitNode(patchedNode, document, resolver, nodeRegistry, mathRenderer, constants, textMeasurer)
      elements.push(result.element)
      bboxes.push(result.bbox)
    }
  }

  return {
    elements,
    bbox: mergeBBoxes(bboxes),
  }
}

/** Measure a node's natural half-width and half-height. */
function measureNode(node: IRNode, mathRenderer: MathRenderer = mathModeRenderer): { hw: number; hh: number } {
  const DEFAULT_INNER_SEP = ptToPx(TIKZ_CONSTANTS.DEFAULT_INNER_SEP_PT)
  const DEFAULT_HALF = 1

  let labelWidth = 0
  let labelHeight = 0

  if (node.label?.trim()) {
    try {
      const r = mathRenderer(node.label)
      labelWidth  = r.widthPx
      labelHeight = r.heightPx
    } catch {
      labelWidth  = node.label.length * 7
      labelHeight = 14
    }
  }

  const innerSep = node.style.innerSep !== undefined ? ptToPx(node.style.innerSep) : DEFAULT_INNER_SEP
  const hw = Math.max(DEFAULT_HALF, labelWidth  / 2 + innerSep,
    node.style.minimumWidth  !== undefined ? ptToPx(node.style.minimumWidth)  / 2 : 0)
  const hh = Math.max(DEFAULT_HALF, labelHeight / 2 + innerSep,
    node.style.minimumHeight !== undefined ? ptToPx(node.style.minimumHeight) / 2 : 0)

  return { hw, hh }
}
