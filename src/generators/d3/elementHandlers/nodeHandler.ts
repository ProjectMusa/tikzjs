/**
 * D3 Element Handler for IRNode — centralizes all D3 editor behavior for nodes.
 */

import type { IRNode, IRDiagram } from '../../../ir/types.js'
import type { D3ElementHandler, DragDelta, HighlightContext, HighlightResult, ListSummary, TreeChild, EditorField, MutationDef, KeyAction } from './types.js'
import { ptToPx } from '../../core/coordResolver.js'
import { moveNode, updateNodeLabel, removeElement } from '../irMutator.js'

const SVG_NS = 'http://www.w3.org/2000/svg'
const NODE_CLICK_PADDING = 6
const AMBER = '#f59e0b'
const AMBER_FILL = 'rgba(245,158,11,0.08)'

// ── Click Zone ───────────────────────────────────────────────────────────────

function createClickZone(node: IRNode, svgGroup: SVGElement, doc: Document): SVGElement | null {
  try {
    const bbox = (svgGroup as SVGGraphicsElement).getBBox()
    if (bbox.width === 0 && bbox.height === 0) return null
    const pad = NODE_CLICK_PADDING
    const rect = doc.createElementNS(SVG_NS, 'rect')
    rect.setAttribute('x', String(bbox.x - pad))
    rect.setAttribute('y', String(bbox.y - pad))
    rect.setAttribute('width', String(bbox.width + pad * 2))
    rect.setAttribute('height', String(bbox.height + pad * 2))
    rect.setAttribute('fill', 'transparent')
    rect.setAttribute('class', 'd3-click-zone')
    rect.setAttribute('data-zone-id', node.id)
    rect.style.cursor = 'pointer'
    return rect
  } catch {
    return null
  }
}

// ── Highlight ────────────────────────────────────────────────────────────────

function createHighlight(
  node: IRNode,
  svgGroup: SVGElement,
  _svg: SVGSVGElement,
  ctx: HighlightContext,
): HighlightResult | null {
  const doc = svgGroup.ownerDocument
  const geo = ctx.nodeRegistry.getById(node.id)

  let x: number, y: number, w: number, h: number

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
  const overlays: SVGElement[] = []

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
  overlays.push(rect)

  const cx = x + w / 2
  const cy = y + h / 2
  const anchors = [
    { x: cx,          y: y - pad },
    { x: cx,          y: y + h + pad },
    { x: x - pad,     y: cy },
    { x: x + w + pad, y: cy },
    { x: x - pad,     y: y - pad },
    { x: x + w + pad, y: y - pad },
    { x: x - pad,     y: y + h + pad },
    { x: x + w + pad, y: y + h + pad },
  ]

  const dotSize = 4
  for (const a of anchors) {
    const dot = doc.createElementNS(SVG_NS, 'rect')
    dot.setAttribute('x', String(a.x - dotSize / 2))
    dot.setAttribute('y', String(a.y - dotSize / 2))
    dot.setAttribute('width', String(dotSize))
    dot.setAttribute('height', String(dotSize))
    dot.setAttribute('fill', AMBER)
    dot.setAttribute('pointer-events', 'none')
    overlays.push(dot)
  }

  return { overlays }
}

// ── Drag Preview ─────────────────────────────────────────────────────────────

function createDragPreview(_node: IRNode, svgGroup: SVGElement, delta: DragDelta): void {
  const dxPx = ptToPx(delta.dxPt)
  const dyPx = -ptToPx(delta.dyPt) // SVG y inverted

  // Store original transform on first call
  if (!(svgGroup as any)._origTransform) {
    (svgGroup as any)._origTransform = svgGroup.getAttribute('transform') || ''
  }
  const orig = (svgGroup as any)._origTransform as string
  const deltaTranslate = `translate(${dxPx.toFixed(2)}, ${dyPx.toFixed(2)})`
  svgGroup.setAttribute('transform', deltaTranslate + (orig ? ' ' + orig : ''))
}

// ── Interactions ─────────────────────────────────────────────────────────────

function isDraggable(node: IRNode): boolean {
  return node.position.coord.cs === 'xy'
}

const mutations: MutationDef<IRNode>[] = [
  {
    id: 'move',
    apply(node, diagram, params: { x: number; y: number }) {
      return moveNode(diagram, node.id, params.x, params.y)
    },
  },
  {
    id: 'edit-label',
    apply(node, diagram, params: { label: string }) {
      return updateNodeLabel(diagram, node.id, params.label)
    },
  },
  {
    id: 'delete',
    apply(node, diagram) {
      return removeElement(diagram, node.id)
    },
  },
]

const keyActions: KeyAction<IRNode>[] = [
  { key: 'Delete', action: 'delete' },
  { key: 'Backspace', action: 'delete' },
  { key: 'F2', action: 'open-editor' },
  { key: 'Enter', action: 'open-editor' },
  { key: 'ArrowUp', action: 'move', params: (n: IRNode) => ({ x: n.position.coord.cs === 'xy' ? n.position.coord.x : 0, y: (n.position.coord.cs === 'xy' ? n.position.coord.y : 0) + 1 }) },
  { key: 'ArrowDown', action: 'move', params: (n: IRNode) => ({ x: n.position.coord.cs === 'xy' ? n.position.coord.x : 0, y: (n.position.coord.cs === 'xy' ? n.position.coord.y : 0) - 1 }) },
  { key: 'ArrowRight', action: 'move', params: (n: IRNode) => ({ x: (n.position.coord.cs === 'xy' ? n.position.coord.x : 0) + 1, y: n.position.coord.cs === 'xy' ? n.position.coord.y : 0 }) },
  { key: 'ArrowLeft', action: 'move', params: (n: IRNode) => ({ x: (n.position.coord.cs === 'xy' ? n.position.coord.x : 0) - 1, y: n.position.coord.cs === 'xy' ? n.position.coord.y : 0 }) },
]

// ── Inspector ────────────────────────────────────────────────────────────────

function listSummary(node: IRNode): ListSummary {
  const name = node.name ? `(${node.name}) ` : ''
  const label = node.label
    ? `"${node.label.length > 24 ? node.label.slice(0, 24) + '...' : node.label}"`
    : ''
  const coord = node.position.coord
  const pos = coord.cs === 'xy' ? `(${coord.x.toFixed(1)}, ${coord.y.toFixed(1)})` : `(${coord.cs})`
  return {
    icon: '\u25CB', // ○
    label: `${name}${label}`.trim() || node.id,
    sublabel: pos,
  }
}

function treeChildren(node: IRNode): TreeChild[] {
  const children: TreeChild[] = []
  if (node.label) {
    children.push({ id: `${node.id}-label`, label: `label: "${node.label}"` })
  }
  const coord = node.position.coord
  if (coord.cs === 'xy') {
    children.push({ id: `${node.id}-pos`, label: `position: (${coord.x.toFixed(2)}, ${coord.y.toFixed(2)})` })
  }
  if (node.style.draw) {
    children.push({ id: `${node.id}-draw`, label: `draw: ${node.style.draw}` })
  }
  if (node.style.fill && node.style.fill !== 'none') {
    children.push({ id: `${node.id}-fill`, label: `fill: ${node.style.fill}` })
  }
  if (node.style.textColor) {
    children.push({ id: `${node.id}-text`, label: `text: ${node.style.textColor}` })
  }
  if (node.style.shape && node.style.shape !== 'rectangle') {
    children.push({ id: `${node.id}-shape`, label: `shape: ${node.style.shape}` })
  }
  return children
}

function editorFields(node: IRNode): EditorField[] {
  const fields: EditorField[] = [
    { key: 'label', label: 'Label', type: 'text' },
  ]
  if (node.position.coord.cs === 'xy') {
    fields.push({ key: 'position.coord.x', label: 'X (pt)', type: 'number' })
    fields.push({ key: 'position.coord.y', label: 'Y (pt)', type: 'number' })
  } else {
    fields.push({ key: 'position.coord', label: 'Position', type: 'text', readOnly: true })
  }
  fields.push({ key: 'style.shape', label: 'Shape', type: 'select', options: [
    { value: 'rectangle', label: 'Rectangle' },
    { value: 'circle', label: 'Circle' },
    { value: 'ellipse', label: 'Ellipse' },
    { value: 'diamond', label: 'Diamond' },
  ]})
  fields.push({ key: 'style.draw', label: 'Draw', type: 'color' })
  fields.push({ key: 'style.fill', label: 'Fill', type: 'color' })
  fields.push({ key: 'style.textColor', label: 'Text Color', type: 'color' })
  return fields
}

// ── Export ────────────────────────────────────────────────────────────────────

export const nodeHandler: D3ElementHandler<IRNode> = {
  kind: 'node',
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
