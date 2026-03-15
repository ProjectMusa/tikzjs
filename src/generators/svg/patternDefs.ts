/**
 * SVG fill pattern definitions for TikZ `patterns` library.
 *
 * Tile geometry matches pgflibrarypatterns.code.tex:
 *   - diagonal patterns:  4pt × 4pt tile, 0.4pt line width
 *   - axis-aligned:       4pt × 4pt tile (H/V lines: spacing = 4pt)
 *   - dots:               4pt × 4pt tile, r = 0.5pt
 *
 * North/east/west lines use corner-to-corner diagonals in a square tile —
 * perpendicular spacing = 4/√2 ≈ 2.83pt, which matches PGF's default.
 */

import { ptToPx } from './coordResolver.js'

/** Registry: pattern name → SVG pattern element id. */
export type PatternRegistry = Map<string, string>

/**
 * Return the SVG pattern id for the given TikZ pattern name.
 * Registers the pattern in the registry if not already present.
 */
export function ensurePattern(name: string, registry: PatternRegistry): string | null {
  if (!KNOWN_PATTERNS.has(name)) return null
  const id = 'tikz-pattern-' + name.replace(/\s+/g, '-')
  if (!registry.has(name)) registry.set(name, id)
  return id
}

const KNOWN_PATTERNS = new Set([
  'north east lines',
  'north west lines',
  'horizontal lines',
  'vertical lines',
  'grid',
  'crosshatch',
  'dots',
  'crosshatch dots',
])

/**
 * Render all registered patterns into a <defs> element.
 */
export function renderPatternDefs(document: Document, registry: PatternRegistry): Element | null {
  if (registry.size === 0) return null
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs')
  for (const [name, id] of registry) {
    const el = buildPatternElement(document, name, id)
    if (el) defs.appendChild(el)
  }
  return defs
}

function line(document: Document, x1: number, y1: number, x2: number, y2: number, lw: number): Element {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'line')
  el.setAttribute('x1', String(x1)); el.setAttribute('y1', String(y1))
  el.setAttribute('x2', String(x2)); el.setAttribute('y2', String(y2))
  el.setAttribute('stroke', 'currentColor')
  el.setAttribute('stroke-width', String(lw))
  return el
}

function circle(document: Document, cx: number, cy: number, r: number): Element {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
  el.setAttribute('cx', String(cx)); el.setAttribute('cy', String(cy))
  el.setAttribute('r', String(r)); el.setAttribute('fill', 'currentColor')
  return el
}

function buildPatternElement(document: Document, name: string, id: string): Element | null {
  // PGF defaults: 3bp tile (≈2.989pt), 0.4pt line width, 0.5pt dot radius.
  // Using 3pt is close enough; perpendicular spacing = 3/√2 ≈ 2.12pt vs PGF's 2.989/√2 ≈ 2.11pt.
  const t = ptToPx(3)    // tile size
  const lw = ptToPx(0.4) // line width
  const r = ptToPx(0.5)  // dot radius

  const pat = document.createElementNS('http://www.w3.org/2000/svg', 'pattern')
  pat.setAttribute('id', id)
  pat.setAttribute('patternUnits', 'userSpaceOnUse')
  pat.setAttribute('width', String(t))
  pat.setAttribute('height', String(t))

  switch (name) {
    case 'north east lines':
      // "/" diagonal: (0,t)→(t,0) in SVG y-down — perpendicular spacing = t/√2 ≈ 2.83pt
      pat.appendChild(line(document, 0, t, t, 0, lw))
      break

    case 'north west lines':
      // "\" diagonal: (0,0)→(t,t) in SVG y-down — same spacing
      pat.appendChild(line(document, 0, 0, t, t, lw))
      break

    case 'horizontal lines':
      // horizontal line at mid-tile; spacing = t = 4pt
      pat.appendChild(line(document, 0, t / 2, t, t / 2, lw))
      break

    case 'vertical lines':
      // vertical line at mid-tile; spacing = t = 4pt
      pat.appendChild(line(document, t / 2, 0, t / 2, t, lw))
      break

    case 'grid':
      pat.appendChild(line(document, 0, t / 2, t, t / 2, lw))
      pat.appendChild(line(document, t / 2, 0, t / 2, t, lw))
      break

    case 'crosshatch':
      // Both diagonals
      pat.appendChild(line(document, 0, t, t, 0, lw))  // "/"
      pat.appendChild(line(document, 0, 0, t, t, lw))  // "\"
      break

    case 'dots':
      pat.appendChild(circle(document, t / 2, t / 2, r))
      break

    case 'crosshatch dots':
      // Dots at tile corners (shared between tiles) and center
      for (const [cx, cy] of [[0, 0], [t, 0], [0, t], [t, t], [t / 2, t / 2]]) {
        pat.appendChild(circle(document, cx, cy, r))
      }
      break

    default:
      return null
  }

  return pat
}
