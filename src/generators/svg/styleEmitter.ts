/**
 * Style emitter: converts ResolvedStyle to SVG attribute maps and CSS strings.
 */

import { ResolvedStyle, ArrowTipSpec } from '../../ir/types.js'

export interface SVGPathAttrs {
  stroke?: string
  'stroke-width'?: string
  'stroke-dasharray'?: string
  'stroke-linecap'?: string
  'stroke-linejoin'?: string
  fill?: string
  opacity?: string
  'fill-opacity'?: string
  'stroke-opacity'?: string
  'marker-start'?: string
  'marker-end'?: string
  transform?: string
  [key: string]: string | undefined
}

/** Convert pt to SVG user units (px at the default scale). */
import { ptToPx } from './coordResolver.js'

/**
 * Merge two ResolvedStyle objects.
 * `override` takes precedence over `base`. Properties that are undefined or
 * 'currentColor' in override fall back to base.
 *
 * Used for scope style inheritance: the scope's style is the base, the
 * element's own style is the override.
 */
export function mergeStyles(base: ResolvedStyle, override: ResolvedStyle): ResolvedStyle {
  const result: ResolvedStyle = { ...base }
  for (const [k, v] of Object.entries(override) as [keyof ResolvedStyle, any][]) {
    if (v === undefined) continue
    if (v === 'currentColor' && (result as any)[k] !== undefined) continue  // keep inherited color
    ;(result as any)[k] = v
  }
  return result
}

/**
 * Build SVG attributes for a path element from a ResolvedStyle.
 */
export function buildPathAttrs(style: ResolvedStyle, markerId?: {start?: string, end?: string}): SVGPathAttrs {
  const attrs: SVGPathAttrs = {}

  // Stroke
  if (style.draw !== undefined) {
    attrs.stroke = style.draw === 'none' ? 'none' : (style.draw || '#000000')
  } else {
    attrs.stroke = 'none'
  }

  if (style.drawWidth !== undefined) {
    attrs['stroke-width'] = String(ptToPx(style.drawWidth))
  } else if (style.draw && style.draw !== 'none') {
    attrs['stroke-width'] = String(ptToPx(0.4)) // TikZ default line width = 0.4pt
  }

  if (style.drawDash) {
    attrs['stroke-dasharray'] = dashPattern(style.drawDash)
  }

  if (style.lineCap) {
    // TikZ 'rect' maps to SVG 'square'
    attrs['stroke-linecap'] = style.lineCap === 'rect' ? 'square' : style.lineCap
  }

  if (style.lineJoin) {
    attrs['stroke-linejoin'] = style.lineJoin
  }

  // Fill
  if (style.fill !== undefined) {
    attrs.fill = style.fill === 'none' ? 'none' : style.fill
  } else {
    attrs.fill = 'none'
  }

  // Opacity
  if (style.opacity !== undefined) {
    attrs.opacity = String(style.opacity)
  }
  if (style.fillOpacity !== undefined) {
    attrs['fill-opacity'] = String(style.fillOpacity)
  }
  if (style.drawOpacity !== undefined) {
    attrs['stroke-opacity'] = String(style.drawOpacity)
  }

  // Arrow markers
  if (markerId?.start) attrs['marker-start'] = `url(#${markerId.start})`
  if (markerId?.end)   attrs['marker-end']   = `url(#${markerId.end})`

  return attrs
}

/** Convert style dash pattern to SVG stroke-dasharray.
 * Values from TikZ pgf source (pgfcorearrows.code.tex), converted to px. */
function dashPattern(dash: string): string {
  const p = (pt: number) => ptToPx(pt)
  switch (dash) {
    case 'dashed':          return `${p(3)},${p(3)}`
    case 'densely dashed':  return `${p(3)},${p(2)}`
    case 'loosely dashed':  return `${p(5)},${p(5)}`
    case 'dotted':          return `${p(0.4)},${p(3)}`
    case 'densely dotted':  return `${p(0.4)},${p(1.5)}`
    case 'loosely dotted':  return `${p(0.4)},${p(6)}`
    default:                return dash // pass-through for custom patterns
  }
}

/**
 * Apply SVG attributes to a DOM element.
 */
export function applyAttrs(el: Element, attrs: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== undefined) {
      el.setAttribute(key, value)
    }
  }
}

/**
 * Build a transform attribute string from ResolvedStyle.
 */
export function buildTransform(style: ResolvedStyle, cx = 0, cy = 0): string | undefined {
  const parts: string[] = []

  if (style.xshift || style.yshift) {
    const tx = ptToPx(style.xshift ?? 0)
    const ty = ptToPx(style.yshift ?? 0)
    parts.push(`translate(${tx},${-ty})`)
  }

  if (style.rotate) {
    parts.push(`rotate(${-style.rotate},${cx},${cy})`)
  }

  if (style.scale && style.scale !== 1) {
    parts.push(`scale(${style.scale})`)
  }

  return parts.length > 0 ? parts.join(' ') : undefined
}

/**
 * Return the marker ID suffix for an arrow tip spec.
 * Used to look up or create the marker in markerDefs.ts.
 */
export function arrowMarkerId(spec: ArrowTipSpec): string {
  const base = spec.kind.replace(/[^a-zA-Z0-9]/g, '_')
  return spec.reversed ? `${base}_rev` : base
}
