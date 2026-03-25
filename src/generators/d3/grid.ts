/**
 * D3 coordinate grid — inserts a TikZ coordinate grid into the SVG.
 * Grid lines at 1cm intervals (28.4528 pt) with lighter lines at 0.5cm.
 * Labels show TikZ cm values (the default coordinate unit).
 */

import { DEFAULT_CONSTANTS } from '../svg/constants.js'

const SVG_NS = 'http://www.w3.org/2000/svg'

export function insertGrid(svgElement: SVGSVGElement, visible = true): void {
  if (!svgElement) return

  const viewBox = svgElement.getAttribute('viewBox')
  if (!viewBox) return

  const [vbX, vbY, vbW, vbH] = viewBox.split(/\s+/).map(Number)

  // 1cm in px (the viewBox is in px units)
  const cmPx = DEFAULT_CONSTANTS.CM_TO_PX
  // Minor grid: 0.5cm
  const minorPx = cmPx / 2

  const doc = svgElement.ownerDocument

  const gridGroup = doc.createElementNS(SVG_NS, 'g')
  gridGroup.setAttribute('class', 'd3-grid')
  if (!visible) gridGroup.style.display = 'none'

  // Extend grid well beyond the viewBox
  const margin = cmPx * 4
  const left = vbX - margin
  const right = vbX + vbW + margin
  const top = vbY - margin
  const bottom = vbY + vbH + margin

  // Minor grid lines (0.5cm intervals)
  const startXMinor = Math.floor(left / minorPx) * minorPx
  const startYMinor = Math.floor(top / minorPx) * minorPx

  for (let x = startXMinor; x <= right; x += minorPx) {
    const line = doc.createElementNS(SVG_NS, 'line')
    line.setAttribute('x1', String(x))
    line.setAttribute('y1', String(top))
    line.setAttribute('x2', String(x))
    line.setAttribute('y2', String(bottom))
    line.setAttribute('stroke', '#ccc')
    line.setAttribute('stroke-width', '0.3')
    line.setAttribute('stroke-opacity', '0.3')
    gridGroup.appendChild(line)
  }

  for (let y = startYMinor; y <= bottom; y += minorPx) {
    const line = doc.createElementNS(SVG_NS, 'line')
    line.setAttribute('x1', String(left))
    line.setAttribute('y1', String(y))
    line.setAttribute('x2', String(right))
    line.setAttribute('y2', String(y))
    line.setAttribute('stroke', '#ccc')
    line.setAttribute('stroke-width', '0.3')
    line.setAttribute('stroke-opacity', '0.3')
    gridGroup.appendChild(line)
  }

  // Major grid lines (1cm intervals) — thicker
  const startXMajor = Math.floor(left / cmPx) * cmPx
  const startYMajor = Math.floor(top / cmPx) * cmPx

  for (let x = startXMajor; x <= right; x += cmPx) {
    const line = doc.createElementNS(SVG_NS, 'line')
    line.setAttribute('x1', String(x))
    line.setAttribute('y1', String(top))
    line.setAttribute('x2', String(x))
    line.setAttribute('y2', String(bottom))
    line.setAttribute('stroke', '#999')
    line.setAttribute('stroke-width', '0.5')
    line.setAttribute('stroke-opacity', '0.4')
    gridGroup.appendChild(line)
  }

  for (let y = startYMajor; y <= bottom; y += cmPx) {
    const line = doc.createElementNS(SVG_NS, 'line')
    line.setAttribute('x1', String(left))
    line.setAttribute('y1', String(y))
    line.setAttribute('x2', String(right))
    line.setAttribute('y2', String(y))
    line.setAttribute('stroke', '#999')
    line.setAttribute('stroke-width', '0.5')
    line.setAttribute('stroke-opacity', '0.4')
    gridGroup.appendChild(line)
  }

  // Origin axes (x=0, y=0) — more prominent
  const originLine = (x1: number, y1: number, x2: number, y2: number) => {
    const line = doc.createElementNS(SVG_NS, 'line')
    line.setAttribute('x1', String(x1))
    line.setAttribute('y1', String(y1))
    line.setAttribute('x2', String(x2))
    line.setAttribute('y2', String(y2))
    line.setAttribute('stroke', '#666')
    line.setAttribute('stroke-width', '1')
    line.setAttribute('stroke-opacity', '0.6')
    return line
  }
  // x-axis at SVG y=0 (TikZ y=0)
  gridGroup.appendChild(originLine(left, 0, right, 0))
  // y-axis at SVG x=0 (TikZ x=0)
  gridGroup.appendChild(originLine(0, top, 0, bottom))

  // Labels on major gridlines — show TikZ cm values (default coordinate unit)
  const labelSize = Math.max(3, vbW * 0.012)

  for (let x = startXMajor; x <= right; x += cmPx) {
    const tikzCm = Math.round(x / cmPx)
    if (tikzCm === 0) continue // skip origin label on x-axis
    const label = doc.createElementNS(SVG_NS, 'text')
    label.setAttribute('x', String(x))
    label.setAttribute('y', String(Math.min(labelSize + 1, vbY + vbH - 1)))
    label.setAttribute('fill', '#888')
    label.setAttribute('font-size', String(labelSize))
    label.setAttribute('text-anchor', 'middle')
    label.setAttribute('font-family', 'monospace')
    label.textContent = String(tikzCm)
    gridGroup.appendChild(label)
  }

  for (let y = startYMajor; y <= bottom; y += cmPx) {
    // SVG y in px → TikZ y in cm (y inverted)
    const tikzCm = Math.round(-y / cmPx)
    if (tikzCm === 0) continue
    const label = doc.createElementNS(SVG_NS, 'text')
    label.setAttribute('x', String(vbX + 2))
    label.setAttribute('y', String(y - 1))
    label.setAttribute('fill', '#888')
    label.setAttribute('font-size', String(labelSize))
    label.setAttribute('text-anchor', 'start')
    label.setAttribute('font-family', 'monospace')
    label.textContent = String(tikzCm)
    gridGroup.appendChild(label)
  }

  // Insert grid as first child so it renders behind everything
  if (svgElement.firstChild) {
    svgElement.insertBefore(gridGroup, svgElement.firstChild)
  } else {
    svgElement.appendChild(gridGroup)
  }
}
