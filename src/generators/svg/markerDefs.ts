/**
 * Arrow marker definitions for SVG <defs>.
 *
 * Supports the common arrow tip types:
 * - default (TikZ '>') — simple arrowhead
 * - twohead ('>>')    — double arrowhead
 * - bar ('|')         — perpendicular bar
 * - Hook              — hook/tail arrow
 * - Stealth           — stealth arrowhead (filled)
 * - Latex             — LaTeX-style arrowhead
 * - Rightarrow        — double-line arrow (for 2-cells in tikzcd)
 */

import { ArrowTipSpec } from '../../ir/types.js'
import { arrowMarkerId } from './styleEmitter.js'
import { ptToPx } from '../core/coordResolver.js'

export interface MarkerSpec {
  id: string
  /** SVG markup for the <marker> element (without outer <marker> tags). */
  pathData: string
  viewBox: string
  refX: number
  refY: number
  markerWidth: number
  markerHeight: number
  orient: string
  color?: string
}

/** All marker IDs registered in the current diagram. */
export type MarkerRegistry = Map<string, MarkerSpec>

/**
 * Get or create a marker spec for the given arrow tip.
 * Returns the marker ID (for use in marker-start/marker-end attributes).
 */
export function ensureMarker(
  spec: ArrowTipSpec,
  registry: MarkerRegistry,
  color = 'currentColor',
  lineWidthPt = 0.4
): string {
  // Include quantized line width in the ID so different widths get different markers
  const lwKey = lineWidthPt.toFixed(2)
  const id = arrowMarkerId(spec)
    + (color !== 'currentColor' ? '_' + color.replace('#', '') : '')
    + (lwKey !== '0.40' ? '_lw' + lwKey : '')
  if (registry.has(id)) return id

  const markerSpec = buildMarkerSpec(spec, id, color, lineWidthPt)
  registry.set(id, markerSpec)
  return id
}

function buildMarkerSpec(spec: ArrowTipSpec, id: string, color: string, lineWidthPt = 0.4): MarkerSpec {
  // TikZ arrow tips scale with line width: size = basePt + factor * lineWidthPt
  // Default line width is 0.4pt. Scale factor relative to that baseline.
  const lw = lineWidthPt
  switch (spec.kind) {
    case 'default':
    case '>': {
      // PGF 'to' arrow: length = 0.44pt + 5*lw, width ≈ 0.35pt + 4*lw
      const lengthPt = 0.44 + 5 * lw
      const widthPt = 0.35 + 4 * lw
      const lengthPx = ptToPx(lengthPt)
      const widthPx = ptToPx(widthPt)
      // Two cubic Bézier curves meeting at the tip — matches PGF 'to' arrow geometry.
      return {
        id,
        pathData: spec.reversed
          ? `<path d="M 4.7 0 C 4.4 1.9 0.9 4.7 0 5 C 0.9 5.3 4.4 8.1 4.7 10" stroke="${color}" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`
          : `<path d="M 5.3 0 C 5.6 1.9 9.1 4.7 10 5 C 9.1 5.3 5.6 8.1 5.3 10" stroke="${color}" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
        viewBox: '0 0 10 10',
        refX: spec.reversed ? 0 : 10,
        refY: 5,
        markerWidth: Math.max(5, lengthPx),
        markerHeight: Math.max(5, widthPx),
        orient: 'auto-start-reverse',
        color,
      }
    }

    case 'twohead':
      return {
        id,
        pathData: spec.reversed
          ? `<path d="M 10 0 L 5 5 L 10 10 M 6 0 L 1 5 L 6 10" stroke="${color}" stroke-width="1.5" fill="none"/>`
          : `<path d="M 0 0 L 5 5 L 0 10 M 4 0 L 9 5 L 4 10" stroke="${color}" stroke-width="1.5" fill="none"/>`,
        viewBox: '0 0 10 10',
        refX: spec.reversed ? 0 : 10,
        refY: 5,
        markerWidth: 6,
        markerHeight: 6,
        orient: 'auto-start-reverse',
        color,
      }

    case 'bar':
      return {
        id,
        pathData: `<line x1="0" y1="0" x2="0" y2="10" stroke="${color}" stroke-width="1.5"/>`,
        viewBox: '-1 0 2 10',
        refX: 0,
        refY: 5,
        markerWidth: 4,
        markerHeight: 6,
        orient: 'auto-start-reverse',
        color,
      }

    case 'Hook':
      return {
        id,
        pathData: spec.reversed
          ? `<path d="M 8 3 A 4 4 0 0 0 8 7" stroke="${color}" stroke-width="1.2" fill="none"/>`
          : `<path d="M 2 3 A 4 4 0 0 1 2 7" stroke="${color}" stroke-width="1.2" fill="none"/>`,
        viewBox: '0 0 10 10',
        refX: spec.reversed ? 8 : 2,
        refY: 5,
        markerWidth: 5,
        markerHeight: 6,
        orient: 'auto-start-reverse',
        color,
      }

    case 'Stealth': {
      const scale = parseFloat(spec.options?.scale ?? '1') || 1
      // TikZ Stealth: length = 3pt + 5*lw, width = 2.4pt + 3.5*lw
      const sLengthPx = ptToPx(3 + 5 * lw) * scale
      const sWidthPx = ptToPx(2.4 + 3.5 * lw) * scale
      if ((spec.count ?? 1) >= 2) {
        // Double Stealth: two stacked filled arrowheads
        return {
          id,
          pathData: spec.reversed
            ? `<path d="M 0 5 L 10 0 L 7 5 L 10 10 Z M 10 5 L 20 0 L 17 5 L 20 10 Z" fill="${color}"/>`
            : `<path d="M 20 5 L 10 0 L 13 5 L 10 10 Z M 10 5 L 0 0 L 3 5 L 0 10 Z" fill="${color}"/>`,
          viewBox: '0 0 20 10',
          refX: spec.reversed ? 0 : 20,
          refY: 5,
          markerWidth: sLengthPx * 2,
          markerHeight: sWidthPx,
          orient: 'auto-start-reverse',
          color,
        }
      }
      return {
        id,
        pathData: spec.reversed
          ? `<path d="M 0 5 L 10 0 L 7 5 L 10 10 Z" fill="${color}"/>`
          : `<path d="M 10 5 L 0 0 L 3 5 L 0 10 Z" fill="${color}"/>`,
        viewBox: '0 0 10 10',
        refX: spec.reversed ? 0 : 10,
        refY: 5,
        markerWidth: sLengthPx,
        markerHeight: sWidthPx,
        orient: 'auto-start-reverse',
        color,
      }
    }

    case 'Latex': {
      // TikZ Latex arrow: length = 3pt + 4.5*lw, width = 2.4pt + 3.6*lw
      const latexLengthPx = ptToPx(3 + 4.5 * lw)
      const latexWidthPx = ptToPx(2.4 + 3.6 * lw)
      return {
        id,
        pathData: spec.reversed
          ? `<path d="M 10 5 C 7 5, 3.5 3.5, 0 0 L 2 5 L 0 10 C 3.5 6.5, 7 5, 10 5 Z" fill="${color}"/>`
          : `<path d="M 0 5 C 3 5, 6.5 3.5, 10 0 L 8 5 L 10 10 C 6.5 6.5, 3 5, 0 5 Z" fill="${color}"/>`,
        viewBox: '0 0 10 10',
        refX: spec.reversed ? 0 : 10,
        refY: 5,
        markerWidth: latexLengthPx,
        markerHeight: latexWidthPx,
        orient: 'auto-start-reverse',
        color,
      }
    }

    case 'Rightarrow':
      return {
        id,
        pathData: spec.reversed
          ? `<path d="M 10 3 L 2 5 L 10 7" stroke="${color}" stroke-width="1.5" fill="none"/>
             <line x1="10" y1="3" x2="10" y2="7" stroke="${color}" stroke-width="1.5"/>`
          : `<path d="M 0 3 L 8 5 L 0 7" stroke="${color}" stroke-width="1.5" fill="none"/>
             <line x1="0" y1="3" x2="0" y2="7" stroke="${color}" stroke-width="1.5"/>`,
        viewBox: '0 0 10 10',
        refX: spec.reversed ? 10 : 0,
        refY: 5,
        markerWidth: 6,
        markerHeight: 6,
        orient: 'auto-start-reverse',
        color,
      }

    default:
      // Fallback: simple arrowhead
      return buildMarkerSpec({ kind: 'default', reversed: spec.reversed }, id, color)
  }
}

/**
 * Render all markers in the registry as SVG <defs> content.
 */
export function renderMarkerDefs(document: Document, registry: MarkerRegistry): SVGDefsElement {
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs')

  for (const [, spec] of registry) {
    const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker')
    marker.setAttribute('id', spec.id)
    marker.setAttribute('viewBox', spec.viewBox)
    marker.setAttribute('refX', String(spec.refX))
    marker.setAttribute('refY', String(spec.refY))
    marker.setAttribute('markerWidth', String(spec.markerWidth))
    marker.setAttribute('markerHeight', String(spec.markerHeight))
    marker.setAttribute('orient', spec.orient)
    marker.setAttribute('markerUnits', 'userSpaceOnUse')
    marker.innerHTML = spec.pathData
    defs.appendChild(marker)
  }

  return defs as SVGDefsElement
}
