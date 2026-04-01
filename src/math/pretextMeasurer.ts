/**
 * Pretext-backed text measurer for browser environments.
 *
 * Uses @chenglou/pretext for accurate text measurement and line breaking
 * via canvas measureText. Falls back to heuristic in Node.js.
 */

import type { TextMeasurer } from './textLayout.js'

// ── Pretext-backed measurer (browser) ─────────────────────────────────────────

let _pretextModule: typeof import('@chenglou/pretext') | null = null
let _pretextFailed = false

/**
 * Lazy-load @chenglou/pretext. Returns null in Node.js or if unavailable.
 */
async function getPretextModule(): Promise<typeof import('@chenglou/pretext') | null> {
  if (_pretextModule) return _pretextModule
  if (_pretextFailed) return null
  try {
    _pretextModule = await import('@chenglou/pretext')
    return _pretextModule
  } catch {
    _pretextFailed = true
    return null
  }
}

/**
 * Synchronous pretext access — only works after init() has been called.
 */
function getPretextSync(): typeof import('@chenglou/pretext') | null {
  return _pretextModule
}

/**
 * Initialize the pretext module. Call once at app startup (browser only).
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export async function initPretext(): Promise<boolean> {
  const mod = await getPretextModule()
  return mod !== null
}

/**
 * Create a pretext-backed TextMeasurer.
 *
 * The measurer uses pretext for accurate text width/height measurement
 * and line breaking. It requires the pretext module to be initialized
 * via initPretext() first.
 *
 * If pretext is not available (Node.js), falls back to canvas-based
 * measurement if OffscreenCanvas is available, otherwise returns null.
 */
export function createPretextMeasurer(): TextMeasurer | null {
  const pretext = getPretextSync()
  if (!pretext) return null

  return {
    measureText(text: string, font: string) {
      // Use prepareWithSegments for single-line measurement
      const prepared = pretext.prepareWithSegments(text, font)
      // Layout at infinite width to get single-line dimensions
      const result = pretext.layoutWithLines(prepared, Infinity, parseFontSizeFromFont(font) * 1.2)
      const widthPx = result.lines.length > 0 ? result.lines[0].width : 0
      const fontSize = parseFontSizeFromFont(font)
      return {
        widthPx,
        heightPx: fontSize * 1.2,
        ascentPx: fontSize * 0.8,
      }
    },

    layoutText(text: string, font: string, maxWidthPx: number, lineHeightPx: number) {
      const prepared = pretext.prepareWithSegments(text, font)
      const result = pretext.layoutWithLines(prepared, maxWidthPx, lineHeightPx)
      return {
        lines: result.lines.map((l) => ({ text: l.text, widthPx: l.width })),
        totalHeight: result.height,
      }
    },
  }
}

function parseFontSizeFromFont(font: string): number {
  const m = font.match(/([\d.]+)px/)
  return m ? parseFloat(m[1]) : 10
}
