/**
 * D3 Element Handler for IRPath — centralizes all D3 editor behavior for paths.
 *
 * Handles click zones (thick invisible stroke), selection highlights (amber tint +
 * dashed bbox + control point handles), drag preview, mutations, and inspector UI.
 */

import type { IRPath, IRDiagram, CoordRef } from '../../../ir/types.js'
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
import { ptToPx } from '../../core/coordResolver.js'
import { updateCurveControl, moveSegmentEndpoint, removeElement, findElement } from '../irMutator.js'

const SVG_NS = 'http://www.w3.org/2000/svg'
const AMBER = '#f59e0b'
const EDGE_CLICK_STROKE = 12
const TINTED_ATTR = 'data-d3-orig-stroke'
const TINTED_LABEL_ATTR = 'data-d3-orig-color'

// ── Click Zone ───────────────────────────────────────────────────────────────

function createClickZone(path: IRPath, svgGroup: SVGElement, doc: Document): SVGElement | null {
  const paths = svgGroup.querySelectorAll('path')
  if (paths.length === 0) return null
  const g = doc.createElementNS(SVG_NS, 'g')
  g.setAttribute('class', 'd3-click-zone')
  g.setAttribute('data-zone-id', path.id)
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

/** Resolve an absolute xy CoordRef to SVG pixel coords + original pt values. */
function resolveAbsXY(ref: CoordRef): { px: { x: number; y: number }; pt: { x: number; y: number } } | null {
  if (ref.mode !== 'absolute' || ref.coord.cs !== 'xy') return null
  return {
    px: { x: ptToPx(ref.coord.x), y: -ptToPx(ref.coord.y) },
    pt: { x: ref.coord.x, y: ref.coord.y },
  }
}

function createHighlight(
  path: IRPath,
  svgGroup: SVGElement,
  svg: SVGSVGElement,
  ctx: HighlightContext,
): HighlightResult | null {
  const doc = svgGroup.ownerDocument
  const overlays: SVGElement[] = []
  const handles: SVGElement[] = []

  // ── Tint original path elements amber ──
  tintPathElements(svgGroup, doc)

  // ── Tint inline label nodes ──
  for (const inlineNode of path.inlineNodes) {
    const nodeEl = doc.querySelector(`[data-ir-id="${inlineNode.id}"]`)
    if (!nodeEl) continue
    const origFill = nodeEl.getAttribute('fill') ?? ''
    nodeEl.setAttribute(TINTED_LABEL_ATTR, origFill)
    nodeEl.setAttribute('fill', AMBER)
  }

  // ── Dashed bbox overlay ──
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

  // ── Control point handles ──
  addControlPointHandles(doc, path, overlays, handles)

  return { overlays, handles }
}

// ── Tint helpers (shared with edgeHandler via export) ────────────────────────

/** Tint <path> elements amber and clone/tint markers. */
export function tintPathElements(svgGroup: SVGElement, doc: Document): void {
  const pathEls: SVGElement[] = svgGroup.tagName.toLowerCase() === 'path'
    ? [svgGroup]
    : Array.from(svgGroup.querySelectorAll('path')) as SVGElement[]

  for (const pathEl of pathEls) {
    const origStroke = pathEl.getAttribute('stroke') ?? ''
    pathEl.setAttribute(TINTED_ATTR, origStroke)
    pathEl.setAttribute('stroke', AMBER)

    for (const attr of ['marker-start', 'marker-end', 'marker-mid'] as const) {
      const markerUrl = pathEl.getAttribute(attr)
      if (!markerUrl) continue
      const idMatch = markerUrl.match(/url\(#([^)]+)\)/)
      if (!idMatch) continue
      const marker = doc.getElementById(idMatch[1])
      if (!marker) continue

      const clone = marker.cloneNode(true) as Element
      const cloneId = `${idMatch[1]}-d3hl`
      clone.setAttribute('id', cloneId)
      clone.setAttribute(TINTED_ATTR, idMatch[1])
      for (const mp of Array.from(clone.querySelectorAll('path'))) {
        mp.setAttribute('stroke', AMBER)
      }
      marker.parentNode?.appendChild(clone)
      pathEl.setAttribute(TINTED_ATTR + `-${attr}`, markerUrl)
      pathEl.setAttribute(attr, `url(#${cloneId})`)
    }
  }
}

// ── Bezier control point handles ─────────────────────────────────────────────

function addControlPointHandles(
  doc: Document,
  irPath: IRPath,
  overlays: SVGElement[],
  handles: SVGElement[],
): void {
  let prevPx: { x: number; y: number } | null = null
  let prevSegIdx = -1
  let prevRole = ''

  for (let segIdx = 0; segIdx < irPath.segments.length; segIdx++) {
    const seg = irPath.segments[segIdx]

    if (seg.kind === 'move') {
      const resolved = resolveAbsXY(seg.to)
      if (resolved) {
        handles.push(makeCPHandle(doc, resolved.px.x, resolved.px.y, irPath.id, segIdx, 'move',
          resolved.pt.x, resolved.pt.y, '', 'square'))
        prevPx = resolved.px
        prevSegIdx = segIdx
        prevRole = 'move'
      } else {
        prevPx = null
      }
    } else if (seg.kind === 'curve') {
      const cp1 = resolveAbsXY(seg.controls[0])
      const cp2ref = seg.controls.length >= 2 ? seg.controls[1] : undefined
      const cp2 = cp2ref ? resolveAbsXY(cp2ref) : null
      const to = resolveAbsXY(seg.to)

      if (prevPx && cp1) {
        overlays.push(makeHandleLine(doc, prevPx.x, prevPx.y, cp1.px.x, cp1.px.y,
          `d3hl-${segIdx}-cp1`, prevSegIdx, prevRole))
      }
      if (to && cp2) {
        overlays.push(makeHandleLine(doc, to.px.x, to.px.y, cp2.px.x, cp2.px.y,
          `d3hl-${segIdx}-cp2`, segIdx, 'to'))
      }

      if (cp1) {
        handles.push(makeCPHandle(doc, cp1.px.x, cp1.px.y, irPath.id, segIdx, 'cp1',
          cp1.pt.x, cp1.pt.y, `d3hl-${segIdx}-cp1`))
      }
      if (cp2) {
        handles.push(makeCPHandle(doc, cp2.px.x, cp2.px.y, irPath.id, segIdx, 'cp2',
          cp2.pt.x, cp2.pt.y, `d3hl-${segIdx}-cp2`))
      }
      if (to) {
        handles.push(makeCPHandle(doc, to.px.x, to.px.y, irPath.id, segIdx, 'to',
          to.pt.x, to.pt.y, '', 'square'))
      }

      prevPx = to?.px ?? null
      prevSegIdx = segIdx
      prevRole = 'to'
    } else if ('to' in seg) {
      const toRef = (seg as { to: CoordRef }).to
      const resolved = resolveAbsXY(toRef)
      if (resolved) {
        handles.push(makeCPHandle(doc, resolved.px.x, resolved.px.y, irPath.id, segIdx, 'to',
          resolved.pt.x, resolved.pt.y, '', 'square'))
      }
      prevPx = resolved?.px ?? null
      prevSegIdx = segIdx
      prevRole = 'to'
    }
  }
}

function makeHandleLine(
  doc: Document,
  x1: number, y1: number,
  x2: number, y2: number,
  id: string,
  anchorSegIdx?: number,
  anchorRole?: string,
): SVGElement {
  const line = doc.createElementNS(SVG_NS, 'line')
  line.setAttribute('id', id)
  line.setAttribute('x1', String(x1))
  line.setAttribute('y1', String(y1))
  line.setAttribute('x2', String(x2))
  line.setAttribute('y2', String(y2))
  line.setAttribute('stroke', AMBER)
  line.setAttribute('stroke-width', '0.8')
  line.setAttribute('stroke-dasharray', '3 2')
  line.setAttribute('pointer-events', 'none')
  if (anchorSegIdx !== undefined && anchorRole) {
    line.setAttribute('data-anchor-seg', String(anchorSegIdx))
    line.setAttribute('data-anchor-role', anchorRole)
  }
  return line
}

function makeCPHandle(
  doc: Document,
  cx: number, cy: number,
  pathId: string,
  segIdx: number,
  cpRole: string,
  origPtX: number,
  origPtY: number,
  handleLineId: string,
  shape: 'circle' | 'square' = 'circle',
): SVGElement {
  let el: SVGElement
  if (shape === 'square') {
    const size = 7
    el = doc.createElementNS(SVG_NS, 'rect') as SVGElement
    el.setAttribute('x', String(cx - size / 2))
    el.setAttribute('y', String(cy - size / 2))
    el.setAttribute('width', String(size))
    el.setAttribute('height', String(size))
    el.setAttribute('fill', '#fff')
    el.setAttribute('stroke', AMBER)
    el.setAttribute('stroke-width', '1.5')
  } else {
    el = doc.createElementNS(SVG_NS, 'circle') as SVGElement
    el.setAttribute('cx', String(cx))
    el.setAttribute('cy', String(cy))
    el.setAttribute('r', '5')
    el.setAttribute('fill', AMBER)
    el.setAttribute('stroke', '#fff')
    el.setAttribute('stroke-width', '1.5')
  }
  el.setAttribute('cursor', 'grab')
  el.setAttribute('data-d3-role', 'cp-handle')
  el.setAttribute('data-ir-path-id', pathId)
  el.setAttribute('data-seg-idx', String(segIdx))
  el.setAttribute('data-cp-role', cpRole)
  el.setAttribute('data-orig-pt-x', String(origPtX))
  el.setAttribute('data-orig-pt-y', String(origPtY))
  el.setAttribute('data-handle-line-id', handleLineId)
  return el
}

// ── Drag Preview ─────────────────────────────────────────────────────────────

function createDragPreview(_path: IRPath, _svgGroup: SVGElement, _delta: DragDelta): void {
  // Paths are not draggable as a whole — control points are dragged individually
  // via setupControlPointDrag in interactions.ts
}

// ── Interactions ─────────────────────────────────────────────────────────────

function isDraggable(_path: IRPath): boolean {
  return false // Paths are not draggable as a whole
}

const mutations: MutationDef<IRPath>[] = [
  {
    id: 'update-control',
    apply(_path, diagram, params: { pathId: string; segIdx: number; cpRole: string; x: number; y: number }) {
      return updateCurveControl(diagram, params.pathId, params.segIdx, params.cpRole as any, params.x, params.y)
    },
  },
  {
    id: 'move-endpoint',
    apply(_path, diagram, params: { pathId: string; segIdx: number; x: number; y: number }) {
      return moveSegmentEndpoint(diagram, params.pathId, params.segIdx, params.x, params.y)
    },
  },
  {
    id: 'delete',
    apply(path, diagram) {
      return removeElement(diagram, path.id)
    },
  },
]

const keyActions: KeyAction<IRPath>[] = [
  { key: 'Delete', action: 'delete' },
  { key: 'Backspace', action: 'delete' },
]

// ── Inspector ────────────────────────────────────────────────────────────────

function listSummary(path: IRPath): ListSummary {
  const segCount = path.segments.filter(s => s.kind !== 'node-on-path').length
  const hasArrow = path.style.arrowEnd !== undefined || path.style.arrowStart !== undefined
  const icon = hasArrow ? '\u2192' : '\u2500' // → or ─
  return {
    icon,
    label: path.id,
    sublabel: `${segCount} segment${segCount !== 1 ? 's' : ''}`,
  }
}

function treeChildren(path: IRPath): TreeChild[] {
  const children: TreeChild[] = []
  for (let i = 0; i < path.segments.length; i++) {
    const seg = path.segments[i]
    if (seg.kind === 'node-on-path') continue
    children.push({
      id: `${path.id}-seg-${i}`,
      label: `${seg.kind}${seg.kind === 'move' || 'to' in seg ? '' : ''}`,
    })
  }
  if (path.inlineNodes.length > 0) {
    children.push({
      id: `${path.id}-inlines`,
      label: `${path.inlineNodes.length} inline node${path.inlineNodes.length !== 1 ? 's' : ''}`,
    })
  }
  if (path.style.draw) {
    children.push({ id: `${path.id}-draw`, label: `draw: ${path.style.draw}` })
  }
  if (path.style.fill && path.style.fill !== 'none') {
    children.push({ id: `${path.id}-fill`, label: `fill: ${path.style.fill}` })
  }
  return children
}

function editorFields(_path: IRPath): EditorField[] {
  return [
    { key: 'style.draw', label: 'Draw', type: 'color' },
    { key: 'style.fill', label: 'Fill', type: 'color' },
    { key: 'style.lineWidth', label: 'Line Width', type: 'number' },
  ]
}

// ── Export ────────────────────────────────────────────────────────────────────

export const pathHandler: D3ElementHandler<IRPath> = {
  kind: 'path',
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
