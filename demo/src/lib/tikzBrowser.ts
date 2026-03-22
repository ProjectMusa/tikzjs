import { preprocess } from '../../../src/preprocessor/index.js'
import { parseExpanded } from '../../../src/parser/index.js'
import { generateSVG } from '../../../src/generators/svg/index.js'
import { browserMathRenderer, browserMathModeRenderer, browserScriptMathModeRenderer } from './browserMath.js'

/**
 * Render TikZ source to an SVG string in the browser.
 * Uses the browser's native DOM instead of JSDOM, and MathJax with browserAdaptor.
 */
export function renderTikz(source: string): string {
  const doc = preprocess(source)
  const ir = parseExpanded(doc)
  return generateSVG(ir, {
    document: window.document.implementation.createHTMLDocument(''),
    mathRenderer: browserMathRenderer,
    mathModeRenderer: browserMathModeRenderer,
    scriptMathModeRenderer: browserScriptMathModeRenderer,
  })
}
