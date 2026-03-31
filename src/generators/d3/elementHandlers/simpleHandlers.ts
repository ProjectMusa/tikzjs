/**
 * Simple D3 Element Handlers — matrix, scope, coordinate, knot.
 *
 * These IR kinds have minimal D3 interaction (no dragging, limited editing).
 * Click zones use bbox rects; highlights use dashed bounding boxes.
 */

import type { IRElement, IRMatrix, IRScope, IRNamedCoordinate, IRKnot } from '../../../ir/types.js'
import type {
  D3ElementHandler,
  HighlightContext,
  HighlightResult,
  ListSummary,
  TreeChild,
  EditorField,
  MutationDef,
} from './types.js'
import { removeElement } from '../irMutator.js'

const SVG_NS = 'http://www.w3.org/2000/svg'
const AMBER = '#f59e0b'
const AMBER_FILL = 'rgba(245,158,11,0.08)'
const CLICK_PADDING = 6

// ── Shared helpers ───────────────────────────────────────────────────────────

function bboxClickZone(id: string, svgGroup: SVGElement, doc: Document): SVGElement | null {
  try {
    const bbox = (svgGroup as SVGGraphicsElement).getBBox()
    if (bbox.width === 0 && bbox.height === 0) return null
    const pad = CLICK_PADDING
    const rect = doc.createElementNS(SVG_NS, 'rect')
    rect.setAttribute('x', String(bbox.x - pad))
    rect.setAttribute('y', String(bbox.y - pad))
    rect.setAttribute('width', String(bbox.width + pad * 2))
    rect.setAttribute('height', String(bbox.height + pad * 2))
    rect.setAttribute('fill', 'transparent')
    rect.setAttribute('class', 'd3-click-zone')
    rect.setAttribute('data-zone-id', id)
    rect.style.cursor = 'pointer'
    return rect
  } catch {
    return null
  }
}

function bboxHighlight(svgGroup: SVGElement, nodeRegistry: HighlightContext['nodeRegistry'], irId?: string): HighlightResult | null {
  const doc = svgGroup.ownerDocument
  let x: number, y: number, w: number, h: number

  const geo = irId ? nodeRegistry.getById(irId) : null
  if (geo) {
    x = geo.centerX - geo.halfWidth
    y = geo.centerY - geo.halfHeight
    w = geo.halfWidth * 2
    h = geo.halfHeight * 2
  } else {
    try {
      const bbox = (svgGroup as unknown as SVGGraphicsElement).getBBox?.()
      if (!bbox || bbox.width <= 0 || bbox.height <= 0) return null
      x = bbox.x
      y = bbox.y
      w = bbox.width
      h = bbox.height
    } catch {
      return null
    }
  }

  const pad = 4
  const rect = doc.createElementNS(SVG_NS, 'rect')
  rect.setAttribute('x', String(x - pad))
  rect.setAttribute('y', String(y - pad))
  rect.setAttribute('width', String(w + pad * 2))
  rect.setAttribute('height', String(h + pad * 2))
  rect.setAttribute('rx', '2')
  rect.setAttribute('ry', '2')
  rect.setAttribute('fill', AMBER_FILL)
  rect.setAttribute('stroke', AMBER)
  rect.setAttribute('stroke-width', '1.5')
  rect.setAttribute('stroke-dasharray', '5 3')
  rect.setAttribute('pointer-events', 'none')

  return { overlays: [rect] }
}

function deleteMutation<T extends IRElement>(): MutationDef<T>[] {
  return [
    {
      id: 'delete',
      apply(el: T, diagram) {
        return removeElement(diagram, (el as any).id)
      },
    },
  ]
}

// ── Matrix Handler ───────────────────────────────────────────────────────────

export const matrixHandler: D3ElementHandler<IRMatrix> = {
  kind: 'matrix',
  createClickZone: (el, svgGroup, doc) => bboxClickZone(el.id, svgGroup, doc),
  createHighlight: (el, svgGroup, _svg, ctx) => bboxHighlight(svgGroup, ctx.nodeRegistry, el.id),
  createDragPreview: () => {},
  isDraggable: () => false,
  mutations: deleteMutation<IRMatrix>(),
  keyActions: [
    { key: 'Delete', action: 'delete' },
    { key: 'Backspace', action: 'delete' },
  ],
  listSummary(matrix) {
    const rows = matrix.rows.length
    const cols = matrix.rows[0]?.length ?? 0
    return {
      icon: '\u25A6', // ▦
      label: matrix.name ?? matrix.id,
      sublabel: `${rows}\u00D7${cols}`,
    }
  },
  treeChildren(matrix) {
    const children: TreeChild[] = []
    for (let r = 0; r < matrix.rows.length; r++) {
      for (let c = 0; c < matrix.rows[r].length; c++) {
        const cell = matrix.rows[r][c]
        if (cell) {
          children.push({
            id: `${matrix.id}-${r}-${c}`,
            label: `[${r},${c}] ${cell.label ? '"' + cell.label + '"' : cell.id}`,
          })
        }
      }
    }
    return children
  },
  editorFields: () => [],
}

// ── Scope Handler ────────────────────────────────────────────────────────────

export const scopeHandler: D3ElementHandler<IRScope> = {
  kind: 'scope',
  createClickZone: (el, svgGroup, doc) => bboxClickZone(el.id, svgGroup, doc),
  createHighlight: (el, svgGroup, _svg, ctx) => bboxHighlight(svgGroup, ctx.nodeRegistry),
  createDragPreview: () => {},
  isDraggable: () => false,
  mutations: deleteMutation<IRScope>(),
  keyActions: [
    { key: 'Delete', action: 'delete' },
    { key: 'Backspace', action: 'delete' },
  ],
  listSummary(scope) {
    return {
      icon: '\u25A1', // □
      label: scope.id,
      sublabel: `${scope.children.length} children`,
    }
  },
  treeChildren(scope) {
    return scope.children.map(child => ({
      id: 'id' in child ? (child as any).id : scope.id + '-child',
      label: child.kind,
    }))
  },
  editorFields: () => [],
}

// ── Coordinate Handler ───────────────────────────────────────────────────────

export const coordinateHandler: D3ElementHandler<IRNamedCoordinate> = {
  kind: 'coordinate',
  createClickZone: (el, svgGroup, doc) => bboxClickZone(el.id, svgGroup, doc),
  createHighlight: (el, svgGroup, _svg, ctx) => bboxHighlight(svgGroup, ctx.nodeRegistry, el.id),
  createDragPreview: () => {},
  isDraggable: () => false,
  mutations: deleteMutation<IRNamedCoordinate>(),
  keyActions: [
    { key: 'Delete', action: 'delete' },
    { key: 'Backspace', action: 'delete' },
  ],
  listSummary(coord) {
    const pos = coord.position.coord
    const posStr = pos.cs === 'xy' ? `(${pos.x.toFixed(1)}, ${pos.y.toFixed(1)})` : `(${pos.cs})`
    return {
      icon: '\u2316', // ⌖
      label: coord.name ?? coord.id,
      sublabel: posStr,
    }
  },
  editorFields(coord) {
    const fields: EditorField[] = []
    if (coord.position.coord.cs === 'xy') {
      fields.push({ key: 'position.coord.x', label: 'X (pt)', type: 'number' })
      fields.push({ key: 'position.coord.y', label: 'Y (pt)', type: 'number' })
    }
    return fields
  },
}

// ── Knot Handler ─────────────────────────────────────────────────────────────

export const knotHandler: D3ElementHandler<IRKnot> = {
  kind: 'knot',
  createClickZone: (el, svgGroup, doc) => bboxClickZone(el.id, svgGroup, doc),
  createHighlight: (_el, svgGroup, _svg, ctx) => bboxHighlight(svgGroup, ctx.nodeRegistry),
  createDragPreview: () => {},
  isDraggable: () => false,
  mutations: [],
  keyActions: [],
  listSummary(knot) {
    return {
      icon: '\u221E', // ∞
      label: knot.id,
      sublabel: `${knot.strands.length} strand${knot.strands.length !== 1 ? 's' : ''}`,
    }
  },
  treeChildren(knot) {
    return knot.strands.map((strand, i) => ({
      id: `${knot.id}-strand-${i}`,
      label: `strand ${i + 1}: ${strand.segments.length} segments`,
    }))
  },
  editorFields: () => [],
}
