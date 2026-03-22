/**
 * Browser-compatible MathJax renderer.
 * Mirrors src/math/index.ts but uses browserAdaptor instead of jsdomAdaptor.
 */

// @ts-expect-error — MathJax CommonJS modules
import { mathjax } from 'mathjax-full/js/mathjax.js'
// @ts-expect-error
import { TeX } from 'mathjax-full/js/input/tex.js'
// @ts-expect-error
import { SVG } from 'mathjax-full/js/output/svg.js'
// @ts-expect-error
import { browserAdaptor } from 'mathjax-full/js/adaptors/browserAdaptor.js'
// @ts-expect-error
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js'
// @ts-expect-error
import { AllPackages } from 'mathjax-full/js/input/tex/AllPackages.js'

import type { MathRenderer, MathResult } from 'tikzjs'

// ── Unit conversion (matching src/math/index.ts) ─────────────────────────────

const EX_TO_PX = 8
const EM_TO_PX = 16
const BASE_SHIFT_PX = 4
const CONTAINER_WIDTH = 600

function parseMathJaxLength(s: string): number {
  if (!s) return 0
  const exMatch = s.match(/^([+-]?[\d.]+)ex$/)
  if (exMatch) return parseFloat(exMatch[1]) * EX_TO_PX
  const pxMatch = s.match(/^([+-]?[\d.]+)px$/)
  if (pxMatch) return parseFloat(pxMatch[1])
  const emMatch = s.match(/^([+-]?[\d.]+)em$/)
  if (emMatch) return parseFloat(emMatch[1]) * 16
  return parseFloat(s) || 0
}

// ── Lazy initialization ──────────────────────────────────────────────────────

let _adaptor: any = null
let _mathJaxDoc: any = null

function getMathJax(): { adaptor: any; doc: any } {
  if (_mathJaxDoc) return { adaptor: _adaptor, doc: _mathJaxDoc }

  _adaptor = browserAdaptor()
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

// ── Rendering ────────────────────────────────────────────────────────────────

function renderMath(latex: string, display = false, mathMode = false, scale = 1): MathResult {
  const { adaptor, doc } = getMathJax()

  let source = latex.trim()

  // Strip math delimiters
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
    source = `\\text{${source}}`
  }

  const node = doc.convert(source, {
    display,
    em: EM_TO_PX,
    ex: EX_TO_PX,
    containerWidth: CONTAINER_WIDTH,
  })

  const outerHTML: string = adaptor.outerHTML(node)

  const svgMatch = outerHTML.match(/<svg[\s\S]*<\/svg>/)
  let svgString = svgMatch ? svgMatch[0] : ''

  const widthMatch = svgString.match(/width="([^"]+)"/)
  const heightMatch = svgString.match(/height="([^"]+)"/)
  const styleMatch = outerHTML.match(/style="[^"]*vertical-align:\s*([^;'"]+)/)

  const widthPx = (widthMatch ? parseMathJaxLength(widthMatch[1]) : 0) * scale
  const heightPx = (heightMatch ? parseMathJaxLength(heightMatch[1]) : 0) * scale
  const verticalOffsetPx =
    (styleMatch ? -parseMathJaxLength(styleMatch[1].trim()) + BASE_SHIFT_PX : BASE_SHIFT_PX) * scale

  if (scale !== 1 && svgString) {
    svgString = svgString
      .replace(/width="[^"]*ex"/, `width="${widthPx}px"`)
      .replace(/height="[^"]*ex"/, `height="${heightPx}px"`)
  }

  return { svgString, widthPx, heightPx, verticalOffsetPx }
}

// ── tikzcd scale constant ───────────────────────────────────────────────────

/** tikzcd `every label` uses \scriptstyle (7pt at 10pt base = 0.7×). */
const TIKZCD_LABEL_SCALE = 7 / 10

// ── Exported renderers ──────────────────────────────────────────────────────

/** Default renderer: plain text wrapped in \text{}, math passed through. */
export const browserMathRenderer: MathRenderer = (latex: string) => renderMath(latex)

/** Math-mode renderer: treats undelimited strings as math (italic). For tikzcd cells. */
export const browserMathModeRenderer: MathRenderer = (latex: string) => renderMath(latex, false, true)

/** Scriptstyle math-mode renderer for tikzcd arrow labels (0.7× scale). */
export const browserScriptMathModeRenderer: MathRenderer = (latex: string) =>
  renderMath(latex, false, true, TIKZCD_LABEL_SCALE)
