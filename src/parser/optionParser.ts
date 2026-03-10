/**
 * Option parser: converts raw TikZ option strings into RawOption[] and ResolvedStyle.
 *
 * TikZ option lists like [draw=red, fill=blue!50, ->, thick, rounded corners=2pt]
 * are parsed into structured objects. Known options are mapped to ResolvedStyle fields;
 * unknown options are preserved in ResolvedStyle.extra for pass-through.
 */

import { RawOption, ResolvedStyle, ArrowTipSpec } from '../ir/types.js'
import { splitCommaList, parseKeyValue } from '../preprocessor/scanner.js'
import { StyleRegistry } from '../preprocessor/styleRegistry.js'

// ── Raw option parsing ────────────────────────────────────────────────────────

/**
 * Parse a raw option string (the content inside [...]) into RawOption[].
 * Does not resolve style references or compute ResolvedStyle.
 */
export function parseRawOptions(optStr: string): RawOption[] {
  if (!optStr.trim()) return []
  const items = splitCommaList(optStr)
  const result: RawOption[] = []

  for (const item of items) {
    const trimmed = item.trim()
    if (!trimmed) continue

    // Arrow shorthand: ->, <-, <->, |->
    if (/^[<>|!.-]+$/.test(trimmed) || trimmed === 'stealth' || isArrowShorthand(trimmed)) {
      result.push({ key: trimmed })
      continue
    }

    const { key, value } = parseKeyValue(trimmed)
    if (key) {
      result.push(value !== undefined ? { key, value } : { key })
    }
  }

  return result
}

function isArrowShorthand(s: string): boolean {
  return /^(<->|->|<-|>->|<-<|=>|<=|>|<|\|->|\|-|stealth|latex|to)$/.test(s.toLowerCase())
}

// ── Style resolution ──────────────────────────────────────────────────────────

/**
 * Resolve a list of raw options into a ResolvedStyle, given a style registry
 * for expanding named style references.
 *
 * Style precedence (later wins):
 *   inherited < named-style-expansion < local options
 *
 * This function handles one level of named style resolution. The full scope
 * chain (scope > path > local) is assembled by styleResolver.ts.
 */
export function resolveOptions(
  rawOptions: RawOption[],
  registry: StyleRegistry,
  inherited?: ResolvedStyle
): ResolvedStyle {
  const style: ResolvedStyle = { ...inherited }

  for (const opt of rawOptions) {
    // Check if it's a named style reference
    if (!opt.value && registry.has(opt.key)) {
      const styleDef = registry.get(opt.key)!
      const expanded = resolveOptions(styleDef.rawOptions, registry)
      Object.assign(style, expanded)
      continue
    }

    applyOption(opt, style)
  }

  return style
}

/**
 * Apply a single RawOption to a ResolvedStyle object (mutates in place).
 */
function applyOption(opt: RawOption, style: ResolvedStyle): void {
  const key = opt.key.trim()
  const value = typeof opt.value === 'string' ? opt.value.trim() : opt.value

  switch (key) {
    // ── Stroke ──────────────────────────────────────────────
    case 'draw':
      style.draw = value ? resolveColor(value as string) : 'currentColor'
      break
    case 'draw=none':
    case 'nodraw':
      style.draw = 'none'
      break

    // ── Fill ────────────────────────────────────────────────
    case 'fill':
      style.fill = value ? resolveColor(value as string) : 'currentColor'
      break
    case 'fill=none':
      style.fill = 'none'
      break

    // ── Combined ─────────────────────────────────────────────
    case 'color':
      if (value) {
        style.draw = resolveColor(value as string)
        style.fill = resolveColor(value as string)
      }
      break

    // ── Line width ───────────────────────────────────────────
    case 'line width':
    case 'line_width':
      if (value) style.drawWidth = parseDimension(value as string)
      break
    case 'ultra thin': style.drawWidth = 0.1; break
    case 'very thin':  style.drawWidth = 0.2; break
    case 'thin':       style.drawWidth = 0.4; break
    case 'semithick':  style.drawWidth = 0.6; break
    case 'thick':      style.drawWidth = 0.8; break
    case 'very thick': style.drawWidth = 1.2; break
    case 'ultra thick': style.drawWidth = 1.6; break

    // ── Dash patterns ─────────────────────────────────────────
    case 'solid':          style.drawDash = 'solid'; break
    case 'dashed':         style.drawDash = 'dashed'; break
    case 'dotted':         style.drawDash = 'dotted'; break
    case 'densely dashed': style.drawDash = 'densely dashed'; break
    case 'loosely dashed': style.drawDash = 'loosely dashed'; break
    case 'densely dotted': style.drawDash = 'densely dotted'; break
    case 'loosely dotted': style.drawDash = 'loosely dotted'; break
    case 'dash pattern':
      if (value) style.drawDash = value as string
      break

    // ── Arrow tips ────────────────────────────────────────────
    case '->':  style.arrowEnd   = { kind: 'default' }; style.arrowStart = undefined; break
    case '<-':  style.arrowStart = { kind: 'default' }; style.arrowEnd   = undefined; break
    case '<->': style.arrowStart = { kind: 'default' }; style.arrowEnd   = { kind: 'default' }; break
    case '|-':  style.arrowStart = { kind: 'bar' };     break
    case '-|':  style.arrowEnd   = { kind: 'bar' };     break
    case '>->': style.arrowStart = { kind: 'tail' };    style.arrowEnd = { kind: 'default' }; break
    case '->>': style.arrowEnd   = { kind: 'twohead' }; break

    // arrows.meta style: \ar[Rightarrow], \ar[hook], etc.
    case 'Rightarrow':     style.arrowEnd = { kind: 'Rightarrow' }; break
    case 'Leftarrow':      style.arrowStart = { kind: 'Rightarrow', reversed: true }; break
    case 'hook':           style.arrowEnd = { kind: 'Hook' }; break
    case "hook'":          style.arrowEnd = { kind: 'Hook', reversed: true }; break
    case 'twoheadrightarrow': style.arrowEnd = { kind: 'twohead' }; break
    case 'twoheadleftarrow':  style.arrowStart = { kind: 'twohead' }; break
    case 'mapsto':         style.arrowEnd = { kind: 'default' }; style.arrowStart = { kind: 'bar' }; break
    case '|->':            style.arrowEnd = { kind: 'default' }; style.arrowStart = { kind: 'bar' }; break

    // ── Shape ─────────────────────────────────────────────────
    case 'rectangle': style.shape = 'rectangle'; break
    case 'circle':    style.shape = 'circle'; break
    case 'ellipse':   style.shape = 'ellipse'; break
    case 'shape':
      if (value) style.shape = value as string
      break

    // ── Node geometry ─────────────────────────────────────────
    case 'inner sep':
      if (value) style.innerSep = parseDimension(value as string)
      break
    case 'outer sep':
      if (value) style.outerSep = parseDimension(value as string)
      break
    case 'minimum width':
      if (value) style.minimumWidth = parseDimension(value as string)
      break
    case 'minimum height':
      if (value) style.minimumHeight = parseDimension(value as string)
      break
    case 'minimum size':
      if (value) { style.minimumWidth = parseDimension(value as string); style.minimumHeight = style.minimumWidth }
      break

    // ── Text ──────────────────────────────────────────────────
    case 'text':
      if (value) style.textColor = resolveColor(value as string)
      break
    case 'align':
      if (value) style.align = value as 'left' | 'center' | 'right'
      break

    // ── Transform ─────────────────────────────────────────────
    case 'rotate':
      if (value) style.rotate = parseFloat(value as string)
      break
    case 'xshift':
      if (value) style.xshift = parseDimension(value as string)
      break
    case 'yshift':
      if (value) style.yshift = parseDimension(value as string)
      break
    case 'scale':
      if (value) style.scale = parseFloat(value as string)
      break
    case 'xscale':
    case 'yscale':
      // Store in extra for now
      if (value) setExtra(style, key, value as string)
      break

    // ── Opacity ───────────────────────────────────────────────
    case 'opacity':
      if (value) style.opacity = parseFloat(value as string)
      break
    case 'fill opacity':
      if (value) style.fillOpacity = parseFloat(value as string)
      break
    case 'draw opacity':
      if (value) style.drawOpacity = parseFloat(value as string)
      break
    case 'transparent': style.opacity = 0; break

    // ── Rounded corners ───────────────────────────────────────
    case 'rounded corners':
      style.roundedCorners = value ? parseDimension(value as string) : 4 // default 4pt
      break
    case 'sharp corners':
      style.roundedCorners = 0
      break

    // ── Edge routing ──────────────────────────────────────────
    case 'bend left':
      style.bend = value ? parseFloat(value as string) : 30
      style.bendDirection = 'left'
      break
    case 'bend right':
      style.bend = value ? parseFloat(value as string) : 30
      style.bendDirection = 'right'
      break
    case 'in':
      if (value) style.inAngle = parseFloat(value as string)
      break
    case 'out':
      if (value) style.outAngle = parseFloat(value as string)
      break
    case 'looseness':
      if (value) style.looseness = parseFloat(value as string)
      break
    case 'loop': style.loop = true; break
    case 'loop above': style.loop = true; style.loopDirection = 'above'; break
    case 'loop below': style.loop = true; style.loopDirection = 'below'; break
    case 'loop left':  style.loop = true; style.loopDirection = 'left';  break
    case 'loop right': style.loop = true; style.loopDirection = 'right'; break

    // ── Label placement ───────────────────────────────────────
    case 'midway':     style.labelPos = 'midway'; break
    case 'near start': style.labelPos = 'near start'; break
    case 'near end':   style.labelPos = 'near end'; break
    case 'at start':   style.labelPos = 'at start'; break
    case 'at end':     style.labelPos = 'at end'; break
    case 'pos':
      if (value) style.labelPos = parseFloat(value as string)
      break
    case 'sloped': style.sloped = true; break
    case 'swap':   style.swap = true; break
    case "'":      style.swap = true; break // tikzcd swap shorthand

    // ── Named colors as standalone options ────────────────────
    default:
      if (isNamedColor(key)) {
        style.draw = resolveColor(key)
        style.fill = resolveColor(key)
      } else if (key) {
        setExtra(style, key, value as string ?? '')
      }
  }
}

function setExtra(style: ResolvedStyle, key: string, value: string): void {
  if (!style.extra) style.extra = {}
  style.extra[key] = value
}

// ── Color resolution ─────────────────────────────────────────────────────────

/** Map of TikZ named colors to CSS color strings. */
const NAMED_COLORS: Record<string, string> = {
  red:       '#FF0000',
  green:     '#00FF00',
  blue:      '#0000FF',
  cyan:      '#00FFFF',
  magenta:   '#FF00FF',
  yellow:    '#FFFF00',
  black:     '#000000',
  white:     '#FFFFFF',
  gray:      '#808080',
  grey:      '#808080',
  darkgray:  '#404040',
  darkgrey:  '#404040',
  lightgray: '#C0C0C0',
  lightgrey: '#C0C0C0',
  brown:     '#804000',
  lime:      '#BFFF00',
  olive:     '#808000',
  orange:    '#FF8000',
  pink:      '#FFAAAA',
  purple:    '#800080',
  teal:      '#008080',
  violet:    '#800080',
}

function isNamedColor(s: string): boolean {
  return s.toLowerCase() in NAMED_COLORS
}

/**
 * Resolve a TikZ color expression to a CSS color string.
 * Handles:
 * - Named colors: "red", "blue"
 * - Mixed colors: "red!50!blue" → 50% red + 50% blue
 * - Opacity: "red!50" → red with 50% opacity (treated as 50% red + 50% white)
 * - RGB: handled via extra
 */
export function resolveColor(colorExpr: string): string {
  const trimmed = colorExpr.trim()

  // Direct named color
  const lower = trimmed.toLowerCase()
  if (lower in NAMED_COLORS) return NAMED_COLORS[lower]

  // Hex color #RRGGBB
  if (/^#[0-9a-fA-F]{3,8}$/.test(trimmed)) return trimmed

  // rgb/RGB functions
  const rgbMatch = trimmed.match(/^rgb\s*\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)$/i)
  if (rgbMatch) {
    const r = Math.round(parseFloat(rgbMatch[1]))
    const g = Math.round(parseFloat(rgbMatch[2]))
    const b = Math.round(parseFloat(rgbMatch[3]))
    return `rgb(${r},${g},${b})`
  }

  // TikZ color mix: color1!percent!color2
  // e.g. "red!50!blue" = 50% red + 50% blue
  // e.g. "red!50" = 50% red + 50% white
  const mixMatch = trimmed.match(/^(.+?)!(\d+)(?:!(.+))?$/)
  if (mixMatch) {
    const c1 = resolveColor(mixMatch[1].trim())
    const pct = parseInt(mixMatch[2], 10) / 100
    const c2 = resolveColor(mixMatch[3]?.trim() ?? 'white')
    return mixColors(c1, c2, pct)
  }

  // Unknown — return as-is (might be a CSS variable or unknown color name)
  return trimmed
}

/** Mix two CSS hex colors: result = pct * c1 + (1-pct) * c2. */
function mixColors(c1: string, c2: string, pct: number): string {
  const [r1, g1, b1] = hexToRgb(c1)
  const [r2, g2, b2] = hexToRgb(c2)
  const r = Math.round(r1 * pct + r2 * (1 - pct))
  const g = Math.round(g1 * pct + g2 * (1 - pct))
  const b = Math.round(b1 * pct + b2 * (1 - pct))
  return `#${hex2(r)}${hex2(g)}${hex2(b)}`
}

function hexToRgb(css: string): [number, number, number] {
  const m = css.match(/^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})/)
  if (m) return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)]
  // Named fallback
  const lower = css.toLowerCase()
  if (lower in NAMED_COLORS) return hexToRgb(NAMED_COLORS[lower])
  return [0, 0, 0]
}

function hex2(n: number): string {
  return Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0')
}

// ── Dimension parsing ─────────────────────────────────────────────────────────

/** Unit conversion to pt (TeX points). */
const UNIT_TO_PT: Record<string, number> = {
  pt: 1,
  bp: 1.00375,   // big point (PostScript point)
  mm: 2.84528,
  cm: 28.4528,
  in: 72.27,
  em: 10,        // approximate, depends on font
  ex: 4.5,       // approximate
  pc: 12,
  dd: 1.07,
  cc: 12.84,
  sp: 1 / 65536,
}

/**
 * Parse a TikZ dimension string (e.g. "2cm", "10pt", "1.5em") to pt.
 * Returns 0 for unrecognized values.
 */
export function parseDimension(s: string): number {
  const trimmed = s.trim()
  const m = trimmed.match(/^([+-]?[\d.]+)\s*(pt|bp|mm|cm|in|em|ex|pc|dd|cc|sp)?$/)
  if (!m) return 0
  const value = parseFloat(m[1])
  const unit = (m[2] ?? 'pt').toLowerCase()
  return value * (UNIT_TO_PT[unit] ?? 1)
}

/**
 * Parse a TikZ dimension that lives in coordinate space (default unit = 1cm, not 1pt).
 * Used for arc radii, node separation distances specified without explicit units.
 */
export function parseDimensionPt(s: string | undefined): number {
  if (!s) return 0
  const trimmed = s.trim()
  const m = trimmed.match(/^([+-]?[\d.]+)\s*(pt|bp|mm|cm|in|em|ex|pc|dd|cc|sp)?$/)
  if (!m) return 0
  const value = parseFloat(m[1])
  const unit = (m[2] ?? 'cm').toLowerCase() // default = cm in TikZ coordinate space
  return value * (UNIT_TO_PT[unit] ?? 1)
}
