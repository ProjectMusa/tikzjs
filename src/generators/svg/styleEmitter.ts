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
import { TIKZ_CONSTANTS } from './constants.js'

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
    attrs['stroke-width'] = String(ptToPx(TIKZ_CONSTANTS.DEFAULT_LINE_WIDTH_PT))
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

/** Convert a TikZ dimension string (e.g. "2pt", "0.5cm") to TeX points. */
function dimToPt(dim: string): number {
  const m = dim.trim().match(/^([+-]?[\d.]+)(pt|bp|cm|mm|in)?$/)
  if (!m) return 0
  const val = parseFloat(m[1])
  switch (m[2] ?? 'pt') {
    case 'pt': return val
    case 'bp': return val * (72.27 / 72)
    case 'cm': return val * TIKZ_CONSTANTS.PT_PER_CM
    case 'mm': return val * TIKZ_CONSTANTS.PT_PER_CM / 10
    case 'in': return val * 72.27
    default:   return val
  }
}

/** Convert style dash pattern to SVG stroke-dasharray.
 * Named patterns from TikZ pgf source (pgfcorearrows.code.tex), converted to px.
 * Custom `dash pattern=on X off Y ...` strings are parsed and converted. */
function dashPattern(dash: string): string {
  const p = (pt: number) => ptToPx(pt)
  switch (dash) {
    case 'dashed':          return `${p(3)},${p(3)}`
    case 'densely dashed':  return `${p(3)},${p(2)}`
    case 'loosely dashed':  return `${p(5)},${p(5)}`
    case 'dotted':          return `${p(0.4)},${p(3)}`
    case 'densely dotted':  return `${p(0.4)},${p(1.5)}`
    case 'loosely dotted':  return `${p(0.4)},${p(6)}`
    default: {
      // Parse TikZ "on <dim> off <dim> ..." format → SVG stroke-dasharray numbers
      const tokens = [...dash.matchAll(/\b(?:on|off)\s+([\d.]+\w*)/g)]
      if (tokens.length > 0) {
        return tokens.map(m => String(p(dimToPt(m[1])))).join(',')
      }
      return dash
    }
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
export function buildTransform(style: ResolvedStyle, cx = 0, cy = 0, coordScale = 1): string | undefined {
  const parts: string[] = []

  if (style.xshift || style.yshift) {
    const tx = ptToPx((style.xshift ?? 0) * coordScale)
    const ty = ptToPx((style.yshift ?? 0) * coordScale)
    parts.push(`translate(${tx},${-ty})`)
  }

  if (style.rotate) {
    parts.push(`rotate(${-style.rotate},${cx},${cy})`)
  }

  const sx = (style.scale ?? 1) * (style.xscale ?? 1)
  const sy = (style.scale ?? 1) * (style.yscale ?? 1)
  if (sx !== 1 || sy !== 1) {
    // Scale around the node center, not the SVG origin.
    // SVG has no scale(sx, sy, cx, cy) syntax, so we decompose into translate/scale/translate.
    const scaleStr = sx === sy ? `scale(${sx})` : `scale(${sx},${sy})`
    parts.push(`translate(${cx},${cy}) ${scaleStr} translate(${-cx},${-cy})`)
  }

  if (style.xslant) {
    // TikZ xslant=s: (x,y) → (x+s·y, y) in TikZ coords.
    // With SVG y-axis inverted: x_svg' = x_svg - s·y_svg → matrix(1,0,-s,1,0,0).
    const s = style.xslant
    parts.push(`matrix(1,0,${-s},1,0,0)`)
  }

  if (style.yslant) {
    // TikZ yslant=s: (x,y) → (x, y+s·x) in TikZ coords.
    // With SVG y-axis inverted: y_svg' = y_svg - s·x_svg → matrix(1,-s,0,1,0,0).
    const s = style.yslant
    parts.push(`matrix(1,${-s},0,1,0,0)`)
  }

  return parts.length > 0 ? parts.join(' ') : undefined
}

/**
 * Return the marker ID suffix for an arrow tip spec.
 * Used to look up or create the marker in markerDefs.ts.
 */
export function arrowMarkerId(spec: ArrowTipSpec): string {
  const base = spec.kind.replace(/[^a-zA-Z0-9]/g, '_')
  const countSuffix = (spec.count ?? 1) > 1 ? `_x${spec.count}` : ''
  return spec.reversed ? `${base}${countSuffix}_rev` : `${base}${countSuffix}`
}
