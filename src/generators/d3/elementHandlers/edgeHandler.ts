/**
 * D3 Element Handler for IREdge — centralizes all D3 editor behavior for edges.
 *
 * Edges share path-like tinting (amber stroke + cloned markers) but do NOT have
 * control point handles. They support label editing via mutations.
 */

import type { IREdge, IRDiagram } from '../../../ir/types.js'
import type {
  D3ElementHandler,
  HighlightContext,
  HighlightResult,
  DragDelta,
  ListSummary,
  TreeChild,
  EditorField,
  MutationDef,
  KeyAction,
} from './types.js'
import { updateEdgeLabel, removeElement } from '../irMutator.js'
import { tintPathElements } from './pathHandler.js'

const SVG_NS = 'http://www.w3.org/2000/svg'
const AMBER = '#f59e0b'
const EDGE_CLICK_STROKE = 12

// ── Click Zone ───────────────────────────────────────────────────────────────

function createClickZone(edge: IREdge, svgGroup: SVGElement, doc: Document): SVGElement | null {
  const paths = svgGroup.querySelectorAll('path')
  if (paths.length === 0) return null
  const g = doc.createElementNS(SVG_NS, 'g')
  g.setAttribute('class', 'd3-click-zone')
  g.setAttribute('data-zone-id', edge.id)
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
  return g
}

// ── Highlight ────────────────────────────────────────────────────────────────

function createHighlight(
  _edge: IREdge,
  svgGroup: SVGElement,
  _svg: SVGSVGElement,
  _ctx: HighlightContext,
): HighlightResult | null {
  const doc = svgGroup.ownerDocument
  const overlays: SVGElement[] = []

  // Tint original path elements amber (shared with pathHandler)
  tintPathElements(svgGroup, doc)

  // Dashed bbox overlay
  try {
    const bbox = (svgGroup as unknown as SVGGraphicsElement).getBBox?.()
    if (bbox && bbox.width > 0 && bbox.height > 0) {
      const pad = 3
      const rect = doc.createElementNS(SVG_NS, 'rect')
      rect.setAttribute('x', String(bbox.x - pad))
      rect.setAttribute('y', String(bbox.y - pad))
      rect.setAttribute('width', String(bbox.width + pad * 2))
      rect.setAttribute('height', String(bbox.height + pad * 2))
      rect.setAttribute('rx', '2')
      rect.setAttribute('ry', '2')
      rect.setAttribute('fill', 'rgba(245,158,11,0.06)')
      rect.setAttribute('stroke', AMBER)
      rect.setAttribute('stroke-width', '1')
      rect.setAttribute('stroke-dasharray', '4 3')
      rect.setAttribute('pointer-events', 'none')
      overlays.push(rect)
    }
  } catch {
    // getBBox can throw in non-rendered contexts
  }

  return { overlays }
}

// ── Drag Preview ─────────────────────────────────────────────────────────────

function createDragPreview(_edge: IREdge, _svgGroup: SVGElement, _delta: DragDelta): void {
  // Edges are not directly draggable
}

// ── Interactions ─────────────────────────────────────────────────────────────

function isDraggable(_edge: IREdge): boolean {
  return false
}

const mutations: MutationDef<IREdge>[] = [
  {
    id: 'edit-label',
    apply(edge, diagram, params: { labelIndex: number; label: string }) {
      return updateEdgeLabel(diagram, edge.id, params.labelIndex, params.label)
    },
  },
  {
    id: 'delete',
    apply(edge, diagram) {
      return removeElement(diagram, edge.id)
    },
  },
]

const keyActions: KeyAction<IREdge>[] = [
  { key: 'Delete', action: 'delete' },
  { key: 'Backspace', action: 'delete' },
  { key: 'F2', action: 'open-editor' },
  { key: 'Enter', action: 'open-editor' },
]

// ── Inspector ────────────────────────────────────────────────────────────────

function listSummary(edge: IREdge): ListSummary {
  const labelText = edge.labels.length > 0 ? ` "${edge.labels[0].text}"` : ''
  return {
    icon: '\u2192', // →
    label: `${edge.from} \u2192 ${edge.to}${labelText}`,
    sublabel: edge.routing.kind !== 'straight' ? edge.routing.kind : undefined,
  }
}

function treeChildren(edge: IREdge): TreeChild[] {
  const children: TreeChild[] = [
    { id: `${edge.id}-from`, label: `from: ${edge.from}` },
    { id: `${edge.id}-to`, label: `to: ${edge.to}` },
  ]
  if (edge.routing.kind !== 'straight') {
    children.push({ id: `${edge.id}-routing`, label: `routing: ${edge.routing.kind}` })
  }
  for (let i = 0; i < edge.labels.length; i++) {
    children.push({
      id: `${edge.id}-label-${i}`,
      label: `label[${i}]: "${edge.labels[i].text}"`,
    })
  }
  if (edge.style.draw) {
    children.push({ id: `${edge.id}-draw`, label: `draw: ${edge.style.draw}` })
  }
  return children
}

function editorFields(edge: IREdge): EditorField[] {
  const fields: EditorField[] = [
    { key: 'from', label: 'From', type: 'text', readOnly: true },
    { key: 'to', label: 'To', type: 'text', readOnly: true },
    { key: 'style.draw', label: 'Draw', type: 'color' },
  ]
  for (let i = 0; i < edge.labels.length; i++) {
    fields.push({ key: `labels[${i}].text`, label: `Label ${i + 1}`, type: 'text' })
  }
  return fields
}

// ── Export ────────────────────────────────────────────────────────────────────

export const edgeHandler: D3ElementHandler<IREdge> = {
  kind: 'edge',
  createClickZone,
  createHighlight,
  createDragPreview,
  isDraggable,
  mutations,
  keyActions,
  listSummary,
  treeChildren,
  editorFields,
}
