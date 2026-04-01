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
  // Render the label — strip LaTeX font size commands that MathJax doesn't handle
  const rawLabel = (node.label || '')
  const labelHasMath = /\$|\\\(|\\\[|\\begin\{/.test(rawLabel)
  let labelSource = rawLabel
    .replace(/\\(?:tiny|scriptsize|footnotesize|small|normalsize|large|Large|LARGE|huge|Huge)\b\s*/g, '')
  // Only strip \textXX font commands in text-mode labels. Inside $...$, MathJax handles them natively.
  if (!labelHasMath) {
    labelSource = labelSource.replace(/\\(?:textrm|textit|textbf|texttt|textsf|textsc|emph)\{([^}]*)\}/g, '$1')
  }
  // Strip outer TeX grouping braces: {content} → content
  if (labelSource.startsWith('{') && labelSource.endsWith('}')) {
    const inner = labelSource.slice(1, -1)
    // Only strip if braces are balanced (not nested unmatched)
    let depth = 0, balanced = true
    for (const ch of inner) {
      if (ch === '{') depth++
      else if (ch === '}') { depth--; if (depth < 0) { balanced = false; break } }
    }
    if (balanced && depth === 0) labelSource = inner
  }
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
  // TikZ `scale` on a node applies a transform to the entire node (text + shape + sep).
  // We compute the unscaled size first, then multiply by scale.
  const nodeScale  = (node.style.scale ?? 1) * (node.style.xscale ?? 1)
  const nodeScaleY = (node.style.scale ?? 1) * (node.style.yscale ?? 1)

  const innerSep = node.style.innerSep !== undefined
    ? ptToPx(node.style.innerSep)
    : DEFAULT_INNER_SEP_PX
  const innerXSep = node.style.innerXSep !== undefined ? ptToPx(node.style.innerXSep) : innerSep
  const innerYSep = node.style.innerYSep !== undefined ? ptToPx(node.style.innerYSep) : innerSep

  // ── fit library: compute bounding box of referenced nodes ──
  let fitBBox: { minX: number; minY: number; maxX: number; maxY: number } | null = null
  if (node.style.fit && node.style.fit.length > 0) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const refName of node.style.fit) {
      const refGeo = nodeRegistry.getByName(refName)
      if (refGeo) {
        minX = Math.min(minX, refGeo.centerX - refGeo.halfWidth)
        minY = Math.min(minY, refGeo.centerY - refGeo.halfHeight)
        maxX = Math.max(maxX, refGeo.centerX + refGeo.halfWidth)
        maxY = Math.max(maxY, refGeo.centerY + refGeo.halfHeight)
      }
    }
    if (isFinite(minX)) fitBBox = { minX, minY, maxX, maxY }
  }

  let halfWidth: number
  let halfHeight: number
  let centerX: number
  let centerY: number

  if (fitBBox) {
    // Fit node: size and position from bounding box of referenced nodes + padding
    centerX = (fitBBox.minX + fitBBox.maxX) / 2
    centerY = (fitBBox.minY + fitBBox.maxY) / 2
    halfWidth = (fitBBox.maxX - fitBBox.minX) / 2 + innerXSep
    halfHeight = (fitBBox.maxY - fitBBox.minY) / 2 + innerYSep
  } else {
    // TikZ `text width` sets the content box width (text wraps to fit); the node box = textWidth + 2*innerSep
    const textWidthPx = node.style.textWidth !== undefined ? ptToPx(node.style.textWidth) : undefined

    halfWidth = Math.max(
      MIN_HALF_SIZE,
      textWidthPx !== undefined ? textWidthPx / 2 + innerXSep : labelWidth / 2 + innerXSep,
      node.style.minimumWidth !== undefined ? ptToPx(node.style.minimumWidth) / 2 : 0
    )
    halfHeight = Math.max(
      MIN_HALF_SIZE,
      labelHeight / 2 + innerYSep,
      node.style.minimumHeight !== undefined ? ptToPx(node.style.minimumHeight) / 2 : 0
    )
    // TikZ circle shape: force equal half-dimensions (largest wins)
    if (node.style.shape === 'circle') {
      const r = Math.max(halfWidth, halfHeight)
      halfWidth = r
      halfHeight = r
    }

    // Regular polygon: incircle fits content, circumcircle determines border
    // minimum size for regular polygon = circumcircle diameter (NOT bounding box)
    if (node.style.shape === 'regular polygon') {
      const n = node.style.regularPolygonSides ?? 5
      // Content-based incircle radius (label + innerSep, excluding minimumWidth/Height)
      const contentR = Math.max(
        MIN_HALF_SIZE,
        labelWidth / 2 + innerXSep,
        labelHeight / 2 + innerYSep
      )
      // Convert content incircle to circumradius
      const contentCircumR = contentR / Math.cos(Math.PI / n)
      // minimum size = circumcircle diameter directly
      const minR = Math.max(
        node.style.minimumWidth !== undefined ? ptToPx(node.style.minimumWidth) / 2 : 0,
        node.style.minimumHeight !== undefined ? ptToPx(node.style.minimumHeight) / 2 : 0
      )
      const finalR = Math.max(contentCircumR, minR)
      halfWidth = finalR
      halfHeight = finalR
    }

    // Apply node-level scale (TikZ `scale` on a node scales the entire shape)
    if (nodeScale !== 1)  halfWidth  *= nodeScale
    if (nodeScaleY !== 1) halfHeight *= nodeScaleY

    // `transform shape` makes node shapes scale with the tikzpicture coordinate transform
    if (node.style.transformShape && resolver.coordScale !== 1) {
      halfWidth  *= resolver.coordScale
      halfHeight *= resolver.coordScale
    }

    // Resolve position: the node's anchor sits at position
    const anchorPos = resolver.resolve(node.position)
    const anchorOffset = anchorOffsetFromAnchor(node.anchor, halfWidth, halfHeight)
    centerX = anchorPos.x - anchorOffset.dx
    centerY = anchorPos.y - anchorOffset.dy
  }

  const geo: NodeGeometry = {
    centerX,
    centerY,
    halfWidth,
    halfHeight,
    bbox: fromCorners(centerX - halfWidth, centerY - halfHeight, centerX + halfWidth, centerY + halfHeight),
    shape: (node.style.shape === 'circle') ? 'circle' : (node.style.shape === 'ellipse') ? 'ellipse' : 'rectangle',
  }

  // Register geometry for anchor resolution
  nodeRegistry.register(node.id, node.name, geo)

  // Build SVG element
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g')
  g.setAttribute('id', node.id)
  g.setAttribute('data-ir-id', node.id)
  g.setAttribute('data-ir-kind', 'node')
  if (node.name) g.setAttribute('data-name', node.name)

  // Optional: draw node border
  if (node.style.draw !== undefined && node.style.draw !== 'none') {
    const shape = node.style.shape ?? 'rectangle'
    if (node.style.double) {
      // TikZ `double` works by drawing the border twice at the same geometry:
      // 1. First pass: stroke-width = doubleDistance + 2*lineWidth (in the draw color)
      // 2. Second pass: stroke-width = doubleDistance (in white) to erase the middle
      // This creates the visual effect of two thin parallel lines.
      const lineWidthPx = node.style.drawWidth !== undefined ? ptToPx(node.style.drawWidth) : ptToPx(TIKZ_CONSTANTS.DEFAULT_LINE_WIDTH_PT)
      const gapPx = ptToPx(node.style.doubleDistance ?? 0.6)
      // Outer stroke in draw color (total width = gap + 2*line)
      const outerWidth = gapPx + 2 * lineWidthPx
      const outerStyle: ResolvedStyle = { ...node.style, fill: node.style.fill ?? 'none', drawWidth: undefined }
      const outer = buildBorderElement(document, shape, centerX, centerY, halfWidth, halfHeight, outerStyle)
      outer.setAttribute('stroke-width', String(outerWidth))
      g.appendChild(outer)
      // Inner stroke in white to create the gap
      const gapStyle: ResolvedStyle = { draw: '#ffffff', fill: 'none', roundedCorners: node.style.roundedCorners }
      const gap = buildBorderElement(document, shape, centerX, centerY, halfWidth, halfHeight, gapStyle)
      gap.setAttribute('stroke-width', String(gapPx))
      g.appendChild(gap)
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
    // Position the label so its center aligns with the node center.
    // If node has scale, apply it to the text content as well.
    const textScaleX = nodeScale
    const textScaleY = nodeScaleY
    const scaledW = labelWidth * textScaleX
    const scaledH = labelHeight * textScaleY
    const tx = centerX - scaledW / 2
    const ty = centerY - scaledH / 2
    if (textScaleX !== 1 || textScaleY !== 1) {
      foreignG.setAttribute('transform', `translate(${tx},${ty}) scale(${textScaleX},${textScaleY})`)
    } else {
      foreignG.setAttribute('transform', `translate(${tx},${ty})`)
    }
    if (node.style.textColor) {
      foreignG.setAttribute('color', node.style.textColor)
    }
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
    if (node.style.textColor) {
      lg.setAttribute('color', node.style.textColor)
    }
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
  const transform = buildTransform(styleWithoutScale, centerX, centerY, resolver.coordScale, resolver.xScale, resolver.yScale)
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
  const strokeWidth = style.drawWidth !== undefined ? ptToPx(style.drawWidth) : ptToPx(TIKZ_CONSTANTS.DEFAULT_LINE_WIDTH_PT)

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

  if (shape === 'diamond') {
    // Diamond (rhombus): vertices at N, E, S, W of the bounding box
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'polygon')
    el.setAttribute('points',
      `${cx},${cy - hh} ${cx + hw},${cy} ${cx},${cy + hh} ${cx - hw},${cy}`)
    el.setAttribute('stroke', stroke)
    el.setAttribute('fill', fill)
    if (stroke !== 'none') el.setAttribute('stroke-width', String(strokeWidth))
    return el
  }

  if (shape === 'regular polygon') {
    const n = style.regularPolygonSides ?? 5
    const borderRotate = style.shapeBorderRotate ?? 0
    const r = Math.max(hw, hh) // circumradius
    // Default: side at bottom. First vertex offset:
    // - odd n: first vertex at top (90°) gives flat bottom
    // - even n: rotate by 180/n to get flat bottom
    const startAngle = 90 + (n % 2 === 0 ? 180 / n : 0) + borderRotate
    const points: string[] = []
    for (let k = 0; k < n; k++) {
      const angle = (startAngle + k * (360 / n)) * (Math.PI / 180)
      // SVG y-axis is inverted: subtract sin for y
      const px = cx + r * Math.cos(angle)
      const py = cy - r * Math.sin(angle)
      points.push(`${px},${py}`)
    }
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'polygon')
    el.setAttribute('points', points.join(' '))
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
    case 'cm':  return val * TIKZ_CONSTANTS.PT_PER_CM
    case 'mm':  return val * TIKZ_CONSTANTS.PT_PER_CM / 10
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
  const swThin   = (0.12 * DEFAULT_CONSTANTS.PT_TO_PX).toFixed(3)  // ≈ 0.219 px
  const swBorder = (0.24 * DEFAULT_CONSTANTS.PT_TO_PX).toFixed(3)  // ≈ 0.437 px
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
