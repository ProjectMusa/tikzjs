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
  color = 'currentColor'
): string {
  const id = arrowMarkerId(spec) + (color !== 'currentColor' ? '_' + color.replace('#', '') : '')
  if (registry.has(id)) return id

  const markerSpec = buildMarkerSpec(spec, id, color)
  registry.set(id, markerSpec)
  return id
}

function buildMarkerSpec(spec: ArrowTipSpec, id: string, color: string): MarkerSpec {
  switch (spec.kind) {
    case 'default':
    case '>':
      // Two cubic Bézier curves meeting at the tip — matches PGF 'to' arrow geometry.
      // Derived from pgfcorearrows.code.tex: move(-3a,4a) curveto(-2.75a,2.5a)(0,0.25a)(0.75a,0)
      //                                      curveto(0,-0.25a)(-2.75a,-2.5a)(-3a,-4a)
      // Scaled to 10×10 viewBox with tip at (10,5); stroke only, round caps.
      return {
        id,
        pathData: spec.reversed
          ? `<path d="M 4.7 0 C 4.4 1.9 0.9 4.7 0 5 C 0.9 5.3 4.4 8.1 4.7 10" stroke="${color}" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`
          : `<path d="M 5.3 0 C 5.6 1.9 9.1 4.7 10 5 C 9.1 5.3 5.6 8.1 5.3 10" stroke="${color}" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
        viewBox: '0 0 10 10',
        refX: spec.reversed ? 0 : 10,
        refY: 5,
        markerWidth: 7,
        markerHeight: 7,
        orient: 'auto-start-reverse',
        color,
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
      return {
        id,
        pathData: spec.reversed
          ? `<path d="M 0 5 L 10 0 L 7 5 L 10 10 Z" fill="${color}"/>`
          : `<path d="M 10 5 L 0 0 L 3 5 L 0 10 Z" fill="${color}"/>`,
        viewBox: '0 0 10 10',
        refX: spec.reversed ? 0 : 10,
        refY: 5,
        markerWidth: 6 * scale,
        markerHeight: 6 * scale,
        orient: 'auto-start-reverse',
        color,
      }
    }

    case 'Latex':
      return {
        id,
        pathData: spec.reversed
          ? `<path d="M 12 5 C 6 5, 2 3, 0 0 C 2 7, 2 3, 0 10 C 2 7, 6 5, 12 5 Z" fill="${color}"/>`
          : `<path d="M 0 5 C 6 5, 10 3, 12 0 C 10 7, 10 3, 12 10 C 10 7, 6 5, 0 5 Z" fill="${color}"/>`,
        viewBox: '0 0 12 10',
        refX: spec.reversed ? 0 : 12,
        refY: 5,
        markerWidth: 7,
        markerHeight: 7,
        orient: 'auto-start-reverse',
        color,
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
    marker.innerHTML = spec.pathData
    defs.appendChild(marker)
  }

  return defs as SVGDefsElement
}
