/**
 * Node emitter: renders IRNode elements to SVG <g> elements with MathJax labels.
 *
 * Migrated from TikzNodeElement.ts with a clean separation:
 * - MathJax rendering is delegated to src/math/index.ts
 * - Coordinate resolution is handled by coordResolver.ts
 * - The emitter only handles SVG construction
 */

import { IRNode, ResolvedStyle } from '../../ir/types.js'
import { CoordResolver, NodeGeometryRegistry, NodeGeometry, getAnchorPosition, ptToPx } from './coordResolver.js'
import { BoundingBox, fromCorners, mergeBBoxes, transformBBox } from './boundingBox.js'
import { buildTransform, applyAttrs } from './styleEmitter.js'
import { MathRenderer, defaultMathRenderer, renderMath } from '../../math/index.js'
import { TIKZ_CONSTANTS, DEFAULT_CONSTANTS, SVGRenderingConstants } from './constants.js'

/** Default inner padding around node content (px). Computed from TikZ spec — does not vary with generator constants. */
const DEFAULT_INNER_SEP_PX = ptToPx(TIKZ_CONSTANTS.DEFAULT_INNER_SEP_PT)

export interface NodeRenderResult {
  element: Element
  bbox: BoundingBox
  geometry: NodeGeometry
}

/**
 * Render an IRNode to an SVG <g> element.
 * Also registers the node's geometry in the NodeGeometryRegistry so
 * that subsequent coordinate references to this node can resolve anchors.
 *
 * @param mathRenderer  Optional renderer for LaTeX labels. Defaults to MathJax.
 */
export function emitNode(
  node: IRNode,
  document: Document,
  resolver: CoordResolver,
  nodeRegistry: NodeGeometryRegistry,
  mathRenderer: MathRenderer = defaultMathRenderer,
  constants: SVGRenderingConstants = DEFAULT_CONSTANTS
): NodeRenderResult {
  const MIN_HALF_SIZE = constants.MIN_HALF_SIZE_PX
  // Render the label
  const labelSource = node.label || ''
  let svgContent = ''
  let labelWidth = 0
  let labelHeight = 0

  // Scale label rendering when node font sets a non-default font size
  const fontScale = node.style.fontSize !== undefined ? node.style.fontSize / 10 : 1
  const activeRenderer: MathRenderer = fontScale !== 1
    ? (latex: string) => renderMath(latex, false, false, fontScale)
    : mathRenderer

  if (labelSource.trim()) {
    try {
      const result = activeRenderer(labelSource)
      svgContent = result.svgString
      labelWidth = result.widthPx
      labelHeight = result.heightPx
    } catch {
      // Fallback: render as plain text
      svgContent = `<text font-size="12">${escapeXml(labelSource)}</text>`
      labelWidth = labelSource.length * 7
      labelHeight = 14
    }
  }

  // Compute node geometry
  const innerSep = node.style.innerSep !== undefined
    ? ptToPx(node.style.innerSep)
    : DEFAULT_INNER_SEP_PX

  const halfWidth = Math.max(
    MIN_HALF_SIZE,
    labelWidth / 2 + innerSep,
    node.style.minimumWidth !== undefined ? ptToPx(node.style.minimumWidth) / 2 : 0
  )
  const halfHeight = Math.max(
    MIN_HALF_SIZE,
    labelHeight / 2 + innerSep,
    node.style.minimumHeight !== undefined ? ptToPx(node.style.minimumHeight) / 2 : 0
  )

  // Resolve position: the node's anchor sits at position
  const anchorPos = resolver.resolve(node.position)
  const anchorOffset = anchorOffsetFromAnchor(node.anchor, halfWidth, halfHeight)
  const centerX = anchorPos.x - anchorOffset.dx
  const centerY = anchorPos.y - anchorOffset.dy

  const geo: NodeGeometry = {
    centerX,
    centerY,
    halfWidth,
    halfHeight,
    bbox: fromCorners(centerX - halfWidth, centerY - halfHeight, centerX + halfWidth, centerY + halfHeight),
  }

  // Register geometry for anchor resolution
  nodeRegistry.register(node.id, node.name, geo)

  // Build SVG element
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g')
  g.setAttribute('id', node.id)
  if (node.name) g.setAttribute('data-name', node.name)

  // Optional: draw node border
  if (node.style.draw !== undefined && node.style.draw !== 'none') {
    const shape = node.style.shape ?? 'rectangle'
    const border = buildBorderElement(document, shape, centerX, centerY, halfWidth, halfHeight, node.style)
    g.appendChild(border)
  } else if (node.style.fill !== undefined && node.style.fill !== 'none') {
    const shape = node.style.shape ?? 'rectangle'
    const bg = buildBorderElement(document, shape, centerX, centerY, halfWidth, halfHeight, node.style)
    g.appendChild(bg)
  }

  // Label content
  if (svgContent.trim()) {
    const foreignG = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    // Position the label so its center aligns with the node center
    const tx = centerX - labelWidth / 2
    const ty = centerY - labelHeight / 2
    foreignG.setAttribute('transform', `translate(${tx},${ty})`)
    foreignG.innerHTML = svgContent
    g.appendChild(foreignG)
  }

  // Render node labels (label=pos:text option) and collect their bboxes
  const LABEL_GAP = ptToPx(constants.NODE_LABEL_GAP_PT)
  const extraBBoxes: BoundingBox[] = []
  for (const lbl of node.style.nodeLabels ?? []) {
    let lblResult
    try {
      lblResult = activeRenderer(lbl.text)
    } catch {
      lblResult = { svgString: `<text font-size="12">${escapeXml(lbl.text)}</text>`, widthPx: lbl.text.length * 7, heightPx: 14 }
    }
    let tx: number, ty: number
    switch (lbl.position) {
      case 'below': case 'south':
        tx = centerX - lblResult.widthPx / 2
        ty = centerY + halfHeight + LABEL_GAP
        break
      case 'above': case 'north':
        tx = centerX - lblResult.widthPx / 2
        ty = centerY - halfHeight - LABEL_GAP - lblResult.heightPx
        break
      case 'right': case 'east':
        tx = centerX + halfWidth + LABEL_GAP
        ty = centerY - lblResult.heightPx / 2
        break
      case 'left': case 'west':
        tx = centerX - halfWidth - LABEL_GAP - lblResult.widthPx
        ty = centerY - lblResult.heightPx / 2
        break
      case 'above right': case 'north east':
        tx = centerX + halfWidth + LABEL_GAP
        ty = centerY - halfHeight - LABEL_GAP - lblResult.heightPx
        break
      case 'above left': case 'north west':
        tx = centerX - halfWidth - LABEL_GAP - lblResult.widthPx
        ty = centerY - halfHeight - LABEL_GAP - lblResult.heightPx
        break
      case 'below right': case 'south east':
        tx = centerX + halfWidth + LABEL_GAP
        ty = centerY + halfHeight + LABEL_GAP
        break
      case 'below left': case 'south west':
        tx = centerX - halfWidth - LABEL_GAP - lblResult.widthPx
        ty = centerY + halfHeight + LABEL_GAP
        break
      default:
        tx = centerX - lblResult.widthPx / 2
        ty = centerY - halfHeight - LABEL_GAP - lblResult.heightPx
    }
    const lg = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    lg.setAttribute('transform', `translate(${tx},${ty})`)
    lg.innerHTML = lblResult.svgString
    g.appendChild(lg)
    extraBBoxes.push(fromCorners(tx, ty, tx + lblResult.widthPx, ty + lblResult.heightPx))
  }

  // Apply transform from style (rotate, shift, scale)
  const transform = buildTransform(node.style, centerX, centerY)
  if (transform) {
    const existing = g.getAttribute('transform') ?? ''
    g.setAttribute('transform', existing ? existing + ' ' + transform : transform)
  }

  // Merge node bbox with all label bboxes, then apply any node transform so the
  // viewBox correctly encloses both the shape and all attached labels.
  const rawBBox = extraBBoxes.length > 0 ? mergeBBoxes([geo.bbox, ...extraBBoxes]) : geo.bbox
  const finalBBox = transform ? transformBBox(rawBBox, transform) : rawBBox

  return {
    element: g,
    bbox: finalBBox,
    geometry: geo,
  }
}

/** Compute the offset from the anchor point to the center of the node. */
function anchorOffsetFromAnchor(anchor: string, hw: number, hh: number): { dx: number; dy: number } {
  switch (anchor) {
    case 'north':      return { dx: 0,   dy: -hh }
    case 'south':      return { dx: 0,   dy: hh }
    case 'east':       return { dx: hw,  dy: 0 }
    case 'west':       return { dx: -hw, dy: 0 }
    case 'north east': return { dx: hw,  dy: -hh }
    case 'north west': return { dx: -hw, dy: -hh }
    case 'south east': return { dx: hw,  dy: hh }
    case 'south west': return { dx: -hw, dy: hh }
    default:           return { dx: 0,   dy: 0 }  // center
  }
}

/** Build a border/background shape element. */
function buildBorderElement(
  document: Document,
  shape: string,
  cx: number,
  cy: number,
  hw: number,
  hh: number,
  style: ResolvedStyle
): Element {
  const stroke = style.draw && style.draw !== 'none' ? style.draw : 'none'
  const fill = style.fill && style.fill !== 'none' ? style.fill : 'none'
  const strokeWidth = style.drawWidth !== undefined ? ptToPx(style.drawWidth) : 0.8

  if (shape === 'circle' || shape === 'ellipse') {
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse')
    el.setAttribute('cx', String(cx))
    el.setAttribute('cy', String(cy))
    el.setAttribute('rx', String(hw))
    el.setAttribute('ry', String(hh))
    el.setAttribute('stroke', stroke)
    el.setAttribute('fill', fill)
    if (stroke !== 'none') el.setAttribute('stroke-width', String(strokeWidth))
    return el
  }

  // Default: rectangle
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
  el.setAttribute('x', String(cx - hw))
  el.setAttribute('y', String(cy - hh))
  el.setAttribute('width', String(hw * 2))
  el.setAttribute('height', String(hh * 2))
  el.setAttribute('stroke', stroke)
  el.setAttribute('fill', fill)
  if (stroke !== 'none') el.setAttribute('stroke-width', String(strokeWidth))
  if (style.roundedCorners !== undefined && style.roundedCorners > 0) {
    const r = ptToPx(style.roundedCorners)
    el.setAttribute('rx', String(r))
    el.setAttribute('ry', String(r))
  }
  return el
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
