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

  const imgDims = parseIncludegraphics(labelSource)
  if (imgDims) {
    labelWidth  = ptToPx(imgDims.widthPt)
    labelHeight = ptToPx(imgDims.heightPt)
    svgContent  = buildImagePlaceholder(labelWidth, labelHeight)
  } else if (labelSource.trim()) {
    // Split on \\ (LaTeX line break) for multiline labels
    const lineParts = labelSource.split('\\\\').map(l => l.trim()).filter(l => l !== '')
    if (lineParts.length > 1) {
      const multi = renderMultilineLabel(lineParts, activeRenderer)
      svgContent = multi.svgContent
      labelWidth = multi.labelWidth
      labelHeight = multi.labelHeight
    } else {
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
  }

  // Compute node geometry.
  // TikZ node `scale` applies to the text CONTENT only — inner sep is added in
  // outer coordinates afterward. So the shape size = scaled_content + 2×inner_sep.
  // For empty nodes, scale has no effect on shape size.
  const nodeContentScale = (node.style.scale ?? 1) * (node.style.xscale ?? 1)
  const nodeContentScaleY = (node.style.scale ?? 1) * (node.style.yscale ?? 1)
  const scaledLabelWidth  = labelWidth  * nodeContentScale
  const scaledLabelHeight = labelHeight * nodeContentScaleY

  const innerSep = node.style.innerSep !== undefined
    ? ptToPx(node.style.innerSep)
    : DEFAULT_INNER_SEP_PX

  let halfWidth = Math.max(
    MIN_HALF_SIZE,
    scaledLabelWidth / 2 + innerSep,
    node.style.minimumWidth !== undefined ? ptToPx(node.style.minimumWidth) / 2 : 0
  )
  let halfHeight = Math.max(
    MIN_HALF_SIZE,
    scaledLabelHeight / 2 + innerSep,
    node.style.minimumHeight !== undefined ? ptToPx(node.style.minimumHeight) / 2 : 0
  )
  // TikZ circle shape: force equal half-dimensions (largest wins)
  if (node.style.shape === 'circle') {
    const r = Math.max(halfWidth, halfHeight)
    halfWidth = r
    halfHeight = r
  }

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
    if (node.style.double) {
      // TikZ `double` border: outer ring + white gap + inner border (with fill).
      // Default double distance = 0.6pt. The outer ring is at halfWidth + gap + lineWidth.
      const lineWidthPx = node.style.drawWidth !== undefined ? ptToPx(node.style.drawWidth) : 0.8
      const gapPx = ptToPx(node.style.doubleDistance ?? 0.6)
      const outerHW = halfWidth  + gapPx + lineWidthPx
      const outerHH = halfHeight + gapPx + lineWidthPx
      // Outer ring (stroke only, no fill)
      const outerStyle = { ...node.style, fill: 'none' }
      const outer = buildBorderElement(document, shape, centerX, centerY, outerHW, outerHH, outerStyle)
      g.appendChild(outer)
      // White gap filler (filled white, no stroke, sized to cover gap)
      const gapStyle: ResolvedStyle = { fill: '#ffffff', draw: 'none' }
      const gapEl = buildBorderElement(document, shape, centerX, centerY, outerHW - lineWidthPx / 2, outerHH - lineWidthPx / 2, gapStyle)
      g.appendChild(gapEl)
      // Inner border (with fill)
      const border = buildBorderElement(document, shape, centerX, centerY, halfWidth, halfHeight, node.style)
      g.appendChild(border)
    } else {
      const border = buildBorderElement(document, shape, centerX, centerY, halfWidth, halfHeight, node.style)
      g.appendChild(border)
    }
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

  // Apply transform from style (rotate, shift) — but NOT scale/xscale/yscale.
  // Node scale only affects content size (already factored into halfWidth/halfHeight above).
  // Applying scale as an SVG transform would incorrectly shrink the drawn shape.
  const styleWithoutScale: ResolvedStyle = node.style.scale !== undefined || node.style.xscale !== undefined || node.style.yscale !== undefined
    ? { ...node.style, scale: undefined, xscale: undefined, yscale: undefined }
    : node.style
  const transform = buildTransform(styleWithoutScale, centerX, centerY, resolver.coordScale)
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

// ── \includegraphics placeholder ──────────────────────────────────────────────

/** Natural sizes (width × height in pt) for mwe example-image variants. */
const EXAMPLE_IMAGE_SIZES: Record<string, [number, number]> = {
  'example-image':            [320, 240],
  'example-image-a':          [320, 240],
  'example-image-b':          [320, 240],
  'example-image-c':          [320, 240],
  'example-image-plain':      [320, 240],
  'example-image-empty':      [320, 240],
  'example-image-1x1':        [200, 200],
  'example-image-4x3':        [160, 120],
  'example-image-16x10':      [320, 200],
  'example-image-16x9':       [320, 180],
  'example-image-10x16':      [200, 320],
  'example-image-9x16':       [180, 320],
  'example-image-golden':     [323.607, 200],
  'example-image-golden-upright': [200, 323.607],
  'example-image-a4':         [595.276, 841.89],
  'example-image-a4-landscape': [841.89, 595.276],
  'example-image-a3':         [841.89, 1190.55],
  'example-image-a3-landscape': [1190.55, 841.89],
  'example-image-letter':     [612, 792],
  'example-image-letter-landscape': [792, 612],
}

/**
 * Render a multiline label (split on \\) as stacked MathJax SVG lines.
 * Each non-empty line is rendered separately; lines are centered horizontally.
 */
function renderMultilineLabel(
  lines: string[],
  renderer: MathRenderer,
): { svgContent: string; labelWidth: number; labelHeight: number } {
  const LINE_GAP_PX = 4
  const rendered = lines.map(line => {
    if (!line) return { svgString: '', widthPx: 0, heightPx: 12 }
    try { return renderer(line) }
    catch { return { svgString: `<text font-size="12">${escapeXml(line)}</text>`, widthPx: line.length * 7, heightPx: 14 } }
  })
  const maxWidth = Math.max(...rendered.map(r => r.widthPx), 0)
  const totalHeight = rendered.reduce((s, r) => s + r.heightPx, 0) + LINE_GAP_PX * (rendered.length - 1)
  let svgContent = ''
  let yOff = 0
  for (const r of rendered) {
    const xOff = (maxWidth - r.widthPx) / 2
    svgContent += `<g transform="translate(${xOff},${yOff})">${r.svgString}</g>`
    yOff += r.heightPx + LINE_GAP_PX
  }
  return { svgContent, labelWidth: maxWidth, labelHeight: totalHeight }
}

/** Convert a dimension string with unit to pt. */
function dimToPt(val: number, unit: string): number {
  switch (unit.toLowerCase()) {
    case 'cm':  return val * 28.4528
    case 'mm':  return val * 2.84528
    case 'in':  return val * 72.27
    case 'pt':  return val
    case 'em':  return val * 10
    default:    return val
  }
}

/**
 * Parse a \includegraphics[opts]{filename} label and return the rendered
 * size in pt, or null if the label is not a \includegraphics command.
 */
export function parseIncludegraphics(label: string): { widthPt: number; heightPt: number } | null {
  const m = label.trim().match(/^\\includegraphics(?:\s*\[([^\]]*)\])?\s*\{([^}]+)\}$/)
  if (!m) return null

  const opts     = m[1] ?? ''
  const filename = m[2].trim()
  const natural  = EXAMPLE_IMAGE_SIZES[filename] ?? [320, 240]

  let widthPt  = natural[0]
  let heightPt = natural[1]

  const scaleM = opts.match(/\bscale\s*=\s*([\d.]+)/)
  if (scaleM) {
    const s = parseFloat(scaleM[1])
    widthPt  *= s
    heightPt *= s
  }

  const wM = opts.match(/\bwidth\s*=\s*([\d.]+)\s*(cm|mm|in|pt|em)?/)
  if (wM) {
    widthPt  = dimToPt(parseFloat(wM[1]), wM[2] ?? 'pt')
    heightPt = widthPt * natural[1] / natural[0]
  }

  const hM = opts.match(/\bheight\s*=\s*([\d.]+)\s*(cm|mm|in|pt|em)?/)
  if (hM) {
    heightPt = dimToPt(parseFloat(hM[1]), hM[2] ?? 'pt')
    if (!wM) widthPt = heightPt * natural[0] / natural[1]
  }

  return { widthPt, heightPt }
}

/**
 * Build an SVG placeholder for \includegraphics.
 * The returned fragment has origin (0,0) at top-left, extending to (w, h) px.
 * Matches the appearance of the mwe example-image placeholder:
 *   gray fill + X/cross lines + border + "Image" label.
 */
export function buildImagePlaceholder(widthPx: number, heightPx: number): string {
  const w   = widthPx.toFixed(3)
  const h   = heightPx.toFixed(3)
  const cx  = (widthPx / 2).toFixed(3)
  const cy  = (heightPx / 2).toFixed(3)
  // Reference uses ~0.12pt thin lines and ~0.24pt border; convert to px
  const swThin   = (0.12 * (52 / 28.4528)).toFixed(3)  // ≈ 0.219 px
  const swBorder = (0.24 * (52 / 28.4528)).toFixed(3)  // ≈ 0.437 px
  const fontSize = Math.max(6, Math.min(11, widthPx * 0.13)).toFixed(1)
  return (
    `<rect x="0" y="0" width="${w}" height="${h}" fill="#bfbfbf"/>` +
    `<g stroke="#999" stroke-width="${swThin}" fill="none">` +
    `<line x1="0" y1="0" x2="${w}" y2="${h}"/>` +
    `<line x1="${w}" y1="0" x2="0" y2="${h}"/>` +
    `<line x1="${cx}" y1="0" x2="${cx}" y2="${h}"/>` +
    `<line x1="0" y1="${cy}" x2="${w}" y2="${cy}"/>` +
    `</g>` +
    `<rect x="0" y="0" width="${w}" height="${h}" stroke="#000" stroke-width="${swBorder}" fill="none"/>` +
    `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central"` +
    ` font-size="${fontSize}" font-family="serif" fill="#000">Image</text>`
  )
}
