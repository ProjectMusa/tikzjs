/**
 * SVG fill pattern definitions for TikZ `patterns` library.
 *
 * Supports the common named patterns:
 *   north east lines, north west lines, horizontal lines, vertical lines,
 *   grid, crosshatch, dots, crosshatch dots
 */

import { ptToPx } from './coordResolver.js'

/** Registry: pattern name → SVG pattern element id. */
export type PatternRegistry = Map<string, string>

/** Line separation (pt) for hatch patterns — matches TikZ default. */
const SEP_PT = 3
/** Line width (pt) for pattern strokes. */
const LW_PT = 0.4

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

function buildPatternElement(document: Document, name: string, id: string): Element | null {
  const s = ptToPx(SEP_PT)
  const lw = ptToPx(LW_PT)
  const r = ptToPx(0.5) // dot radius

  const pat = document.createElementNS('http://www.w3.org/2000/svg', 'pattern')
  pat.setAttribute('id', id)
  pat.setAttribute('patternUnits', 'userSpaceOnUse')

  switch (name) {
    case 'north east lines': {
      pat.setAttribute('width', String(s))
      pat.setAttribute('height', String(s))
      pat.setAttribute('patternTransform', 'rotate(45)')
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line')
      line.setAttribute('x1', '0'); line.setAttribute('y1', '0')
      line.setAttribute('x2', '0'); line.setAttribute('y2', String(s))
      line.setAttribute('stroke', 'currentColor')
      line.setAttribute('stroke-width', String(lw))
      pat.appendChild(line)
      break
    }

    case 'north west lines': {
      pat.setAttribute('width', String(s))
      pat.setAttribute('height', String(s))
      pat.setAttribute('patternTransform', 'rotate(-45)')
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line')
      line.setAttribute('x1', '0'); line.setAttribute('y1', '0')
      line.setAttribute('x2', '0'); line.setAttribute('y2', String(s))
      line.setAttribute('stroke', 'currentColor')
      line.setAttribute('stroke-width', String(lw))
      pat.appendChild(line)
      break
    }

    case 'horizontal lines': {
      pat.setAttribute('width', String(s))
      pat.setAttribute('height', String(s))
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line')
      line.setAttribute('x1', '0'); line.setAttribute('y1', String(s / 2))
      line.setAttribute('x2', String(s)); line.setAttribute('y2', String(s / 2))
      line.setAttribute('stroke', 'currentColor')
      line.setAttribute('stroke-width', String(lw))
      pat.appendChild(line)
      break
    }

    case 'vertical lines': {
      pat.setAttribute('width', String(s))
      pat.setAttribute('height', String(s))
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line')
      line.setAttribute('x1', String(s / 2)); line.setAttribute('y1', '0')
      line.setAttribute('x2', String(s / 2)); line.setAttribute('y2', String(s))
      line.setAttribute('stroke', 'currentColor')
      line.setAttribute('stroke-width', String(lw))
      pat.appendChild(line)
      break
    }

    case 'grid': {
      pat.setAttribute('width', String(s))
      pat.setAttribute('height', String(s))
      const h = document.createElementNS('http://www.w3.org/2000/svg', 'line')
      h.setAttribute('x1', '0'); h.setAttribute('y1', String(s / 2))
      h.setAttribute('x2', String(s)); h.setAttribute('y2', String(s / 2))
      h.setAttribute('stroke', 'currentColor'); h.setAttribute('stroke-width', String(lw))
      const v = document.createElementNS('http://www.w3.org/2000/svg', 'line')
      v.setAttribute('x1', String(s / 2)); v.setAttribute('y1', '0')
      v.setAttribute('x2', String(s / 2)); v.setAttribute('y2', String(s))
      v.setAttribute('stroke', 'currentColor'); v.setAttribute('stroke-width', String(lw))
      pat.appendChild(h); pat.appendChild(v)
      break
    }

    case 'crosshatch': {
      // NE + NW diagonals
      pat.setAttribute('width', String(s))
      pat.setAttribute('height', String(s))
      // NE line: from bottom-left to top-right corner
      const ne = document.createElementNS('http://www.w3.org/2000/svg', 'line')
      ne.setAttribute('x1', '0'); ne.setAttribute('y1', String(s))
      ne.setAttribute('x2', String(s)); ne.setAttribute('y2', '0')
      ne.setAttribute('stroke', 'currentColor'); ne.setAttribute('stroke-width', String(lw))
      const nw = document.createElementNS('http://www.w3.org/2000/svg', 'line')
      nw.setAttribute('x1', '0'); nw.setAttribute('y1', '0')
      nw.setAttribute('x2', String(s)); nw.setAttribute('y2', String(s))
      nw.setAttribute('stroke', 'currentColor'); nw.setAttribute('stroke-width', String(lw))
      pat.appendChild(ne); pat.appendChild(nw)
      break
    }

    case 'dots': {
      pat.setAttribute('width', String(s))
      pat.setAttribute('height', String(s))
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
      circle.setAttribute('cx', String(s / 2)); circle.setAttribute('cy', String(s / 2))
      circle.setAttribute('r', String(r))
      circle.setAttribute('fill', 'currentColor')
      pat.appendChild(circle)
      break
    }

    case 'crosshatch dots': {
      // Dots at corners and center of a diamond pattern
      pat.setAttribute('width', String(s))
      pat.setAttribute('height', String(s))
      const positions = [
        [0, 0], [s, 0], [0, s], [s, s], [s / 2, s / 2],
      ]
      for (const [cx, cy] of positions) {
        const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
        c.setAttribute('cx', String(cx)); c.setAttribute('cy', String(cy))
        c.setAttribute('r', String(r)); c.setAttribute('fill', 'currentColor')
        pat.appendChild(c)
      }
      break
    }

    default:
      return null
  }

  return pat
}
