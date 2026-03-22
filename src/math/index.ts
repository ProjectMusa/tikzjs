/**
 * MathJax wrapper for server-side LaTeX rendering.
 *
 * Provides a lazy-initialized MathJax instance that converts LaTeX strings
 * to SVG elements. The initialization is deferred to the first call to
 * avoid the startup overhead when math rendering is not needed.
 *
 * Extracted from the original TikzNodeElement.ts and generalized.
 */

// MathJax and JSDOM are loaded lazily on first use to avoid crashing
// in browser environments where these Node.js-only modules are unavailable.

/** Rendered math result. */
export interface MathResult {
  /** SVG string to embed (an <svg> element). */
  svgString: string
  /** Width in pixels. */
  widthPx: number
  /** Height in pixels. */
  heightPx: number
  /** Vertical offset (baseline correction) in pixels. */
  verticalOffsetPx: number
}

/**
 * A math renderer converts a LaTeX string to a MathResult.
 * Implement this interface to swap in KaTeX, custom SVG, etc.
 * The input `latex` is the raw label text from the TikZ node (may contain
 * dollar-sign math delimiters or plain text).
 */
export type MathRenderer = (latex: string) => MathResult

// ── Initialization ────────────────────────────────────────────────────────────

let _adaptor: any = null
let _mathJaxDoc: any = null

function getMathJax(): { adaptor: any; doc: any } {
  if (_mathJaxDoc) return { adaptor: _adaptor, doc: _mathJaxDoc }

  const { mathjax } = require('mathjax-full/js/mathjax.js')
  const { TeX } = require('mathjax-full/js/input/tex.js')
  const { SVG } = require('mathjax-full/js/output/svg.js')
  const { jsdomAdaptor } = require('mathjax-full/js/adaptors/jsdomAdaptor.js')
  const { RegisterHTMLHandler } = require('mathjax-full/js/handlers/html.js')
  const { AllPackages } = require('mathjax-full/js/input/tex/AllPackages.js')
  const { JSDOM } = require('jsdom')

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
/** Pixels per em (MathJax default, = 16px). */
const EM_TO_PX = 16
/** MathJax base vertical shift in px. */
const BASE_SHIFT_PX = 4
/** MathJax container width (affects line breaking). */
const CONTAINER_WIDTH = 600

/**
 * tikzcd `every label` uses \scriptstyle (7pt at 10pt base = 0.7×).
 * Source: tikzlibrarycd.code.tex line 533.
 */
export const TIKZCD_LABEL_SCALE = 7 / 10

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
 * @param latex     LaTeX source. May be:
 *   - Inline math:   "$...$" or "\(...\)"
 *   - Plain text:    "\text{...}"
 *   - Display math:  "$$...$$" or "\[...\]"
 * @param display   If true, render in display math mode.
 * @param mathMode  If true, treat undelimited plain strings as math (italic),
 *                  not as \text{}. Use for tikzcd labels where "f" means $f$.
 */
export function renderMath(latex: string, display = false, mathMode = false, scale = 1): MathResult {
  const { adaptor, doc } = getMathJax()

  let source = latex.trim()

  // Strip math delimiters — doc.convert() takes a raw TeX expression, not delimited source.
  if (source.startsWith('$$') && source.endsWith('$$') && source.length > 4) {
    source = source.slice(2, -2).trim()
    display = true
  } else if (source.startsWith('$') && source.endsWith('$') && source.length > 2) {
    source = source.slice(1, -1).trim()
  } else if (source.startsWith('\\[') && source.endsWith('\\]')) {
    source = source.slice(2, -2).trim()
    display = true
  } else if (source.startsWith('\\(') && source.endsWith('\\)')) {
    source = source.slice(2, -2).trim()
  } else if (!mathMode && source && !/[$\\]/.test(source) && !source.startsWith('\\text{')) {
    // Plain text with no TeX — wrap so MathJax renders it upright.
    // In mathMode (tikzcd), undelimited strings are already math expressions.
    source = `\\text{${source}}`
  }

  const node = doc.convert(source, {
    display,
    em: EM_TO_PX,
    ex: EX_TO_PX,
    containerWidth: CONTAINER_WIDTH,
  })

  const outerHTML: string = adaptor.outerHTML(node)

  // MathJax wraps the SVG in <mjx-container> which is an HTML element.
  // Extract just the <svg>...</svg> so it can be embedded in our SVG document.
  const svgMatch = outerHTML.match(/<svg[\s\S]*<\/svg>/)
  let svgString = svgMatch ? svgMatch[0] : ''

  // Extract dimensions from the inner SVG element's width/height attributes
  const widthMatch = svgString.match(/width="([^"]+)"/)
  const heightMatch = svgString.match(/height="([^"]+)"/)
  // vertical-align is on the <mjx-container> style attribute
  const styleMatch = outerHTML.match(/style="[^"]*vertical-align:\s*([^;'"]+)/)

  const widthPx = (widthMatch ? parseMathJaxLength(widthMatch[1]) : 0) * scale
  const heightPx = (heightMatch ? parseMathJaxLength(heightMatch[1]) : 0) * scale
  const verticalOffsetPx = (styleMatch ? -parseMathJaxLength(styleMatch[1].trim()) + BASE_SHIFT_PX : BASE_SHIFT_PX) * scale

  // Apply scale: replace ex-based dimensions with explicit px values so the SVG
  // renders at the target size regardless of the surrounding font context.
  if (scale !== 1 && svgString) {
    svgString = svgString
      .replace(/width="[^"]*ex"/, `width="${widthPx}px"`)
      .replace(/height="[^"]*ex"/, `height="${heightPx}px"`)
  }

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

/**
 * The default MathRenderer: uses MathJax (server-side).
 * Strips math delimiters ($...$, \(...\), etc.) and passes the inner TeX to doc.convert().
 * Plain text is wrapped in \text{...}.
 */
export const defaultMathRenderer: MathRenderer = (latex: string) =>
  renderMath(latex)

/**
 * Math-mode renderer: like defaultMathRenderer but treats undelimited strings as
 * math expressions (italic). Use for tikzcd labels where "f" means $f$.
 */
export const mathModeRenderer: MathRenderer = (latex: string) =>
  renderMath(latex, false, true)

/**
 * Scriptstyle math-mode renderer for tikzcd arrow labels.
 * tikzcd `every label` uses \scriptstyle (7pt at 10pt base = 0.7×).
 * Source: tikzlibrarycd.code.tex — `every label/.style={font=\scriptstyle}`.
 */
export const scriptMathModeRenderer: MathRenderer = (latex: string) =>
  renderMath(latex, false, true, TIKZCD_LABEL_SCALE)
