/**
 * MathJax wrapper for server-side LaTeX rendering.
 *
 * Provides a lazy-initialized MathJax instance that converts LaTeX strings
 * to SVG elements. The initialization is deferred to the first call to
 * avoid the startup overhead when math rendering is not needed.
 *
 * Extracted from the original TikzNodeElement.ts and generalized.
 */

// MathJax requires CommonJS require() — these are not ES modules
const { mathjax } = require('mathjax-full/js/mathjax.js')
const { TeX } = require('mathjax-full/js/input/tex.js')
const { SVG } = require('mathjax-full/js/output/svg.js')
const { jsdomAdaptor } = require('mathjax-full/js/adaptors/jsdomAdaptor.js')
const { RegisterHTMLHandler } = require('mathjax-full/js/handlers/html.js')
const { AllPackages } = require('mathjax-full/js/input/tex/AllPackages.js')
const { JSDOM } = require('jsdom')

/** Rendered math result. */
export interface MathResult {
  /** Outer SVG string. */
  svgString: string
  /** Width in pixels (ex-based, converted). */
  widthPx: number
  /** Height in pixels. */
  heightPx: number
  /** Vertical offset (baseline correction) in pixels. */
  verticalOffsetPx: number
}

// ── Initialization ────────────────────────────────────────────────────────────

let _adaptor: any = null
let _mathJaxDoc: any = null

function getMathJax(): { adaptor: any; doc: any } {
  if (_mathJaxDoc) return { adaptor: _adaptor, doc: _mathJaxDoc }

  _adaptor = jsdomAdaptor(JSDOM)
  RegisterHTMLHandler(_adaptor)

  _mathJaxDoc = mathjax.document('', {
    InputJax: new TeX({
      packages: AllPackages,
      inlineMath: [
        ['$', '$'],
        ['\\(', '\\)'],
      ],
      formatError: (_jax: any, err: any) => {
        throw new Error('TeX error: ' + err.message)
      },
    }),
    OutputJax: new SVG({ fontCache: 'none' }),
  })

  return { adaptor: _adaptor, doc: _mathJaxDoc }
}

// ── Unit conversion ───────────────────────────────────────────────────────────

/** Pixels per ex (approximate, based on MathJax default font). */
const EX_TO_PX = 8
/** MathJax base vertical shift in px. */
const BASE_SHIFT_PX = 4
/** MathJax container width (affects line breaking). */
const CONTAINER_WIDTH = 600

/**
 * Parse a MathJax length string (e.g. "1.5ex", "20px") to pixels.
 */
export function parseMathJaxLength(s: string): number {
  if (!s) return 0
  const exMatch = s.match(/^([+-]?[\d.]+)ex$/)
  if (exMatch) return parseFloat(exMatch[1]) * EX_TO_PX
  const pxMatch = s.match(/^([+-]?[\d.]+)px$/)
  if (pxMatch) return parseFloat(pxMatch[1])
  const emMatch = s.match(/^([+-]?[\d.]+)em$/)
  if (emMatch) return parseFloat(emMatch[1]) * 16
  return parseFloat(s) || 0
}

// ── Rendering ─────────────────────────────────────────────────────────────────

/**
 * Render a LaTeX string to an SVG string and measure its dimensions.
 *
 * @param latex  LaTeX source. May be:
 *   - Inline math:   "$...$" or "\(...\)"
 *   - Plain text:    "\text{...}"
 *   - Display math:  "$$...$$" or "\[...\]"
 *
 * @param display  If true, render in display math mode.
 */
export function renderMath(latex: string, display = false): MathResult {
  const { adaptor, doc } = getMathJax()

  let source = latex
  // If source doesn't contain math delimiters, wrap as inline math
  if (source && !/[$\\]/.test(source) && !source.startsWith('\\text{')) {
    source = `\\text{${source}}`
  }

  const node = doc.convert(source, {
    display,
    em: 16,
    ex: EX_TO_PX,
    containerWidth: CONTAINER_WIDTH,
  })

  const svgString: string = adaptor.outerHTML(node)

  // Extract dimensions from SVG viewBox / width / height attributes
  const widthMatch = svgString.match(/width="([^"]+)"/)
  const heightMatch = svgString.match(/height="([^"]+)"/)
  const styleMatch = svgString.match(/style="[^"]*vertical-align:\s*([^;'"]+)/)

  const widthPx = widthMatch ? parseMathJaxLength(widthMatch[1]) : 0
  const heightPx = heightMatch ? parseMathJaxLength(heightMatch[1]) : 0
  const verticalOffsetPx = styleMatch ? -parseMathJaxLength(styleMatch[1].trim()) + BASE_SHIFT_PX : BASE_SHIFT_PX

  return { svgString, widthPx, heightPx, verticalOffsetPx }
}

/**
 * Render LaTeX and return the inner SVG content (without the outer <svg> wrapper).
 * Suitable for embedding directly into another SVG element.
 */
export function renderMathInner(latex: string, display = false): MathResult {
  const result = renderMath(latex, display)
  // Strip outer <svg ...>...</svg> tags, keep inner content
  const inner = result.svgString
    .replace(/^<svg[^>]*>/, '')
    .replace(/<\/svg>$/, '')
  return { ...result, svgString: inner }
}

/**
 * Check if a string contains math content (dollar signs, \(...\), etc.).
 */
export function containsMath(s: string): boolean {
  return /\$|\\\(|\\\[|\\begin\{/.test(s)
}

/**
 * Wrap plain text for MathJax rendering.
 */
export function wrapText(s: string): string {
  if (!s) return s
  if (containsMath(s)) return s
  return `\\text{${s}}`
}
