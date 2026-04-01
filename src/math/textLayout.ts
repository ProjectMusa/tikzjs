/**
 * Hybrid text+math layout engine.
 *
 * Segments a label into text runs and math runs, measures them independently
 * (text via @chenglou/pretext, math via the existing MathRenderer), then
 * composes them into positioned SVG elements with an accurate bounding box.
 *
 * This enables:
 * - Proper `text width` wrapping for plain-text portions
 * - Native SVG <text> elements (crisper, selectable) for text
 * - MathJax/KaTeX SVG for math
 * - Accurate bbox computation without full-document MathJax rendering
 */

import type { MathRenderer, MathResult } from './index.js'

// ── Label segment types ───────────────────────────────────────────────────────

export interface TextSegment {
  kind: 'text'
  content: string
}

export interface MathSegment {
  kind: 'math'
  content: string // raw TeX without delimiters
  display: boolean
}

export interface LineBreakSegment {
  kind: 'linebreak'
}

export type LabelSegment = TextSegment | MathSegment | LineBreakSegment

// ── Segment parser ────────────────────────────────────────────────────────────

/**
 * Parse a TikZ label string into segments of text, math, and linebreaks.
 *
 * Handles:
 * - $...$ inline math
 * - \(...\) inline math
 * - \[...\] display math (treated as inline block for layout)
 * - $$...$$ display math
 * - \\ explicit line breaks
 * - Everything else is text
 *
 * Does NOT handle \text{} inside math — that's the math renderer's job.
 */
export function parseLabel(label: string): LabelSegment[] {
  const segments: LabelSegment[] = []
  let i = 0

  while (i < label.length) {
    // Check for \\ line break (but not \\\( or \\\[)
    if (label[i] === '\\' && label[i + 1] === '\\' && label[i + 2] !== '(' && label[i + 2] !== '[') {
      segments.push({ kind: 'linebreak' })
      i += 2
      // Skip optional whitespace after \\
      while (i < label.length && (label[i] === ' ' || label[i] === '\t')) i++
      continue
    }

    // Check for $$ display math
    if (label[i] === '$' && label[i + 1] === '$') {
      const start = i + 2
      const end = label.indexOf('$$', start)
      if (end !== -1) {
        segments.push({ kind: 'math', content: label.slice(start, end), display: true })
        i = end + 2
        continue
      }
    }

    // Check for $ inline math
    if (label[i] === '$') {
      const start = i + 1
      const end = label.indexOf('$', start)
      if (end !== -1) {
        segments.push({ kind: 'math', content: label.slice(start, end), display: false })
        i = end + 1
        continue
      }
    }

    // Check for \( inline math
    if (label[i] === '\\' && label[i + 1] === '(') {
      const start = i + 2
      const end = label.indexOf('\\)', start)
      if (end !== -1) {
        segments.push({ kind: 'math', content: label.slice(start, end), display: false })
        i = end + 2
        continue
      }
    }

    // Check for \[ display math
    if (label[i] === '\\' && label[i + 1] === '[') {
      const start = i + 2
      const end = label.indexOf('\\]', start)
      if (end !== -1) {
        segments.push({ kind: 'math', content: label.slice(start, end), display: true })
        i = end + 2
        continue
      }
    }

    // Accumulate text until next special
    const textStart = i
    while (i < label.length) {
      if (label[i] === '$') break
      if (label[i] === '\\' && (label[i + 1] === '(' || label[i + 1] === '[')) break
      if (label[i] === '\\' && label[i + 1] === '\\') break
      i++
    }
    if (i > textStart) {
      segments.push({ kind: 'text', content: label.slice(textStart, i) })
    }
  }

  return segments
}

/**
 * Check whether a label contains only text (no math, no linebreaks).
 */
export function isPureText(segments: LabelSegment[]): boolean {
  return segments.every((s) => s.kind === 'text')
}

/**
 * Check whether a label contains only math (the whole label is one math expression).
 */
export function isPureMath(segments: LabelSegment[]): boolean {
  return segments.length === 1 && segments[0].kind === 'math'
}

/**
 * Check whether a label is simple (no math delimiters, no linebreaks).
 * This means the entire label can be treated as plain text or sent to MathJax as-is.
 */
export function isSimpleLabel(label: string): boolean {
  return !/\$|\\\(|\\\[|\\\\/.test(label)
}

// ── Measured segment types ────────────────────────────────────────────────────

export interface MeasuredTextSegment {
  kind: 'text'
  content: string
  widthPx: number
  heightPx: number
  /** Ascent above baseline in px. */
  ascentPx: number
}

export interface MeasuredMathSegment {
  kind: 'math'
  content: string
  display: boolean
  svgString: string
  widthPx: number
  heightPx: number
  verticalOffsetPx: number
}

export interface MeasuredLineBreak {
  kind: 'linebreak'
}

export type MeasuredSegment = MeasuredTextSegment | MeasuredMathSegment | MeasuredLineBreak

// ── Text measurer interface ───────────────────────────────────────────────────

/**
 * Measures plain text and provides layout/line-breaking.
 * In the browser: backed by @chenglou/pretext (canvas measureText).
 * In Node.js: backed by simple heuristic or MathJax \text{}.
 */
export interface TextMeasurer {
  /**
   * Measure the width and height of a single-line text string.
   */
  measureText(text: string, font: string): { widthPx: number; heightPx: number; ascentPx: number }

  /**
   * Break text into lines at a given maxWidth and return per-line info.
   * Uses pretext's line-breaking algorithm when available.
   */
  layoutText(
    text: string,
    font: string,
    maxWidthPx: number,
    lineHeightPx: number,
  ): { lines: Array<{ text: string; widthPx: number }>; totalHeight: number }
}

// ── Heuristic text measurer (Node.js fallback) ───────────────────────────────

/** Approximate character width for common fonts at a given size. */
function estimateCharWidth(fontSizePx: number): number {
  // Average character width is ~0.6× font size for proportional fonts
  return fontSizePx * 0.6
}

/** Parse a CSS font shorthand to extract size in px. */
export function parseFontSize(font: string): number {
  const m = font.match(/([\d.]+)px/)
  return m ? parseFloat(m[1]) : 10
}

/**
 * Heuristic text measurer for Node.js (no canvas available).
 * Uses character-count approximation. Accurate enough for sizing
 * but pretext should be used in browser for pixel-perfect results.
 */
export const heuristicMeasurer: TextMeasurer = {
  measureText(text: string, font: string) {
    const fontSize = parseFontSize(font)
    const charW = estimateCharWidth(fontSize)
    return {
      widthPx: text.length * charW,
      heightPx: fontSize * 1.2,
      ascentPx: fontSize * 0.8,
    }
  },

  layoutText(text: string, font: string, maxWidthPx: number, lineHeightPx: number) {
    const fontSize = parseFontSize(font)
    const charW = estimateCharWidth(fontSize)
    const words = text.split(/\s+/)
    const lines: Array<{ text: string; widthPx: number }> = []
    let currentLine = ''
    let currentWidth = 0

    for (const word of words) {
      const wordWidth = word.length * charW
      const spaceWidth = currentLine ? charW : 0
      if (currentWidth + spaceWidth + wordWidth > maxWidthPx && currentLine) {
        lines.push({ text: currentLine, widthPx: currentWidth })
        currentLine = word
        currentWidth = wordWidth
      } else {
        currentLine = currentLine ? currentLine + ' ' + word : word
        currentWidth += spaceWidth + wordWidth
      }
    }
    if (currentLine) {
      lines.push({ text: currentLine, widthPx: currentWidth })
    }
    if (lines.length === 0) {
      lines.push({ text: '', widthPx: 0 })
    }

    return {
      lines,
      totalHeight: lines.length * lineHeightPx,
    }
  },
}

// ── TikZ font → CSS font mapping ─────────────────────────────────────────────

/**
 * Build a CSS font shorthand string from TikZ style properties.
 * Used as input to pretext's prepare() and TextMeasurer.
 */
export function buildCSSFont(options: {
  fontSize?: number // pt
  bold?: boolean
  italic?: boolean
  fontFamily?: string
}): string {
  const sizePx = Math.round((options.fontSize ?? 10) * 1.333 * 100) / 100 // pt → px, rounded to 2dp
  const weight = options.bold ? 'bold' : 'normal'
  const style = options.italic ? 'italic' : 'normal'
  const family = options.fontFamily ?? 'serif'
  return `${style} ${weight} ${sizePx}px ${family}`
}

// ── Hybrid layout engine ──────────────────────────────────────────────────────

/** MathJax base vertical shift constant — must match BASE_SHIFT_PX in math/index.ts */
const MATH_BASE_SHIFT_PX = 4

export interface LayoutLine {
  segments: Array<{
    kind: 'text' | 'math'
    x: number // px offset from line start
    widthPx: number
    heightPx: number
    // Text: rendered as <text> SVG element
    text?: string
    // Math: rendered as embedded SVG
    svgString?: string
    verticalOffsetPx?: number
    ascentPx?: number
  }>
  widthPx: number
  heightPx: number
  /** Distance from line top to the shared baseline (px). */
  baselinePx: number
}

export interface HybridLayoutResult {
  /** All lines with positioned segments. */
  lines: LayoutLine[]
  /** Total width in px (widest line). */
  widthPx: number
  /** Total height in px. */
  heightPx: number
  /** Composed SVG content string ready for embedding. */
  svgContent: string
}

/**
 * Escape XML special characters for embedding in SVG.
 */
function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * Measure all segments in a label: text segments via TextMeasurer, math via MathRenderer.
 */
export function measureSegments(
  segments: LabelSegment[],
  mathRenderer: MathRenderer,
  textMeasurer: TextMeasurer,
  font: string,
): MeasuredSegment[] {
  return segments.map((seg) => {
    switch (seg.kind) {
      case 'text': {
        const m = textMeasurer.measureText(seg.content, font)
        return { kind: 'text' as const, content: seg.content, ...m }
      }
      case 'math': {
        const delimited = seg.display ? `$$${seg.content}$$` : `$${seg.content}$`
        const result = mathRenderer(delimited)
        return {
          kind: 'math' as const,
          content: seg.content,
          display: seg.display,
          svgString: result.svgString,
          widthPx: result.widthPx,
          heightPx: result.heightPx,
          verticalOffsetPx: result.verticalOffsetPx,
        }
      }
      case 'linebreak':
        return { kind: 'linebreak' as const }
    }
  })
}

/**
 * Lay out measured segments into lines, optionally wrapping at maxWidthPx.
 *
 * When textMeasurer supports line breaking (pretext), text segments that
 * exceed the remaining line width are broken across lines.
 * Math segments are treated as unbreakable inline boxes.
 *
 * @param measured    Pre-measured segments from measureSegments()
 * @param textMeasurer Used for line-breaking text segments
 * @param font        CSS font string
 * @param maxWidthPx  Maximum line width (undefined = no wrapping)
 * @param lineGapPx   Gap between lines
 * @param align       Text alignment within lines ('left' | 'center' | 'right')
 */
export function layoutSegments(
  measured: MeasuredSegment[],
  textMeasurer: TextMeasurer,
  font: string,
  maxWidthPx?: number,
  lineGapPx = 4,
  align: 'left' | 'center' | 'right' = 'left',
): HybridLayoutResult {
  const fontSize = parseFontSize(font)
  const lineHeightPx = fontSize * 1.4

  // Phase 1: Split into lines at explicit linebreaks
  const rawLines: MeasuredSegment[][] = [[]]
  for (const seg of measured) {
    if (seg.kind === 'linebreak') {
      rawLines.push([])
    } else {
      rawLines[rawLines.length - 1].push(seg)
    }
  }

  // Phase 2: Within each line, lay out segments sequentially.
  // If maxWidthPx is set, break text segments across lines.
  const lines: LayoutLine[] = []

  for (const rawLine of rawLines) {
    if (maxWidthPx !== undefined) {
      // With wrapping: lay out segments one by one, breaking text when needed
      let currentLineSegs: LayoutLine['segments'] = []
      let currentX = 0

      for (const seg of rawLine) {
        if (seg.kind === 'math') {
          // Math: unbreakable inline box
          if (currentX + seg.widthPx > maxWidthPx && currentLineSegs.length > 0) {
            // Doesn't fit — push current line and start new one
            lines.push(finishLine(currentLineSegs, currentX, lineHeightPx))
            currentLineSegs = []
            currentX = 0
          }
          currentLineSegs.push({
            kind: 'math',
            x: currentX,
            widthPx: seg.widthPx,
            heightPx: seg.heightPx,
            svgString: seg.svgString,
            verticalOffsetPx: seg.verticalOffsetPx,
          })
          currentX += seg.widthPx
        } else if (seg.kind === 'text') {
          // Text: can be broken across lines via TextMeasurer
          const remaining = maxWidthPx - currentX
          if (seg.widthPx <= remaining || currentLineSegs.length === 0) {
            // Fits on current line (or it's the first segment — must go here)
            // But we should still check if it needs wrapping within itself
            if (seg.widthPx > maxWidthPx && currentX === 0) {
              // Text alone is wider than maxWidth — use layoutText to break it
              const layout = textMeasurer.layoutText(seg.content, font, maxWidthPx, lineHeightPx)
              for (let li = 0; li < layout.lines.length; li++) {
                const ll = layout.lines[li]
                if (li > 0) {
                  lines.push(finishLine(currentLineSegs, currentX, lineHeightPx))
                  currentLineSegs = []
                  currentX = 0
                }
                currentLineSegs.push({
                  kind: 'text',
                  x: currentX,
                  widthPx: ll.widthPx,
                  heightPx: lineHeightPx,
                  text: ll.text,
                  ascentPx: seg.ascentPx,
                })
                currentX += ll.widthPx
              }
            } else {
              currentLineSegs.push({
                kind: 'text',
                x: currentX,
                widthPx: seg.widthPx,
                heightPx: lineHeightPx,
                text: seg.content,
                ascentPx: seg.ascentPx,
              })
              currentX += seg.widthPx
            }
          } else {
            // Text doesn't fit — break it
            const layout = textMeasurer.layoutText(seg.content, font, remaining, lineHeightPx)
            for (let li = 0; li < layout.lines.length; li++) {
              const ll = layout.lines[li]
              if (li > 0) {
                lines.push(finishLine(currentLineSegs, currentX, lineHeightPx))
                currentLineSegs = []
                currentX = 0
              }
              const lineMaxW = li === 0 ? remaining : maxWidthPx
              // Re-layout subsequent lines at full width
              if (li > 0 && ll.widthPx > maxWidthPx) {
                const reLayout = textMeasurer.layoutText(ll.text, font, maxWidthPx, lineHeightPx)
                for (let ri = 0; ri < reLayout.lines.length; ri++) {
                  const rl = reLayout.lines[ri]
                  if (ri > 0) {
                    lines.push(finishLine(currentLineSegs, currentX, lineHeightPx))
                    currentLineSegs = []
                    currentX = 0
                  }
                  currentLineSegs.push({
                    kind: 'text',
                    x: currentX,
                    widthPx: rl.widthPx,
                    heightPx: lineHeightPx,
                    text: rl.text,
                    ascentPx: seg.ascentPx,
                  })
                  currentX += rl.widthPx
                }
              } else {
                currentLineSegs.push({
                  kind: 'text',
                  x: currentX,
                  widthPx: ll.widthPx,
                  heightPx: lineHeightPx,
                  text: ll.text,
                  ascentPx: seg.ascentPx,
                })
                currentX += ll.widthPx
              }
            }
          }
        }
      }
      if (currentLineSegs.length > 0) {
        lines.push(finishLine(currentLineSegs, currentX, lineHeightPx))
      }
    } else {
      // No wrapping: single line with all segments
      let x = 0
      const segs: LayoutLine['segments'] = []
      for (const seg of rawLine) {
        if (seg.kind === 'text') {
          segs.push({
            kind: 'text',
            x,
            widthPx: seg.widthPx,
            heightPx: lineHeightPx,
            text: seg.content,
            ascentPx: seg.ascentPx,
          })
          x += seg.widthPx
        } else if (seg.kind === 'math') {
          segs.push({
            kind: 'math',
            x,
            widthPx: seg.widthPx,
            heightPx: seg.heightPx,
            svgString: seg.svgString,
            verticalOffsetPx: seg.verticalOffsetPx,
          })
          x += seg.widthPx
        }
      }
      lines.push(finishLine(segs, x, lineHeightPx))
    }
  }

  // Phase 3: Compute overall dimensions
  const widthPx = Math.max(...lines.map((l) => l.widthPx), 0)
  const heightPx = lines.reduce((h, l) => h + l.heightPx, 0) + Math.max(0, lines.length - 1) * lineGapPx

  // Phase 4: Compose SVG content string
  let svgContent = ''
  let y = 0
  for (const line of lines) {
    // Compute x offset for alignment
    const xOffset = align === 'center' ? (widthPx - line.widthPx) / 2 : align === 'right' ? widthPx - line.widthPx : 0

    for (const seg of line.segments) {
      const sx = seg.x + xOffset
      if (seg.kind === 'text' && seg.text) {
        // SVG <text> y attribute = baseline position
        const textY = y + line.baselinePx
        svgContent += `<text x="${sx}" y="${textY}" font-size="${fontSize}" font-family="serif">${escapeXml(seg.text)}</text>`
      } else if (seg.kind === 'math' && seg.svgString) {
        // Position math SVG so its internal baseline aligns with the line baseline.
        // MathJax descent below baseline = verticalOffsetPx - BASE_SHIFT_PX
        // MathJax ascent above baseline = mathHeight - descent
        const descent = (seg.verticalOffsetPx ?? MATH_BASE_SHIFT_PX) - MATH_BASE_SHIFT_PX
        const mathAscent = seg.heightPx - descent
        const mathY = y + line.baselinePx - mathAscent
        svgContent += `<g transform="translate(${sx},${mathY})">${seg.svgString}</g>`
      }
    }
    y += line.heightPx + lineGapPx
  }

  return { lines, widthPx, heightPx, svgContent }
}

function finishLine(segments: LayoutLine['segments'], widthPx: number, defaultHeight: number): LayoutLine {
  // Compute shared baseline from max ascent across all segments.
  // For text: ascent = ascentPx. For math: ascent = height - descent, where
  // descent = verticalOffsetPx - BASE_SHIFT_PX (from MathJax vertical-align).
  let maxAscent = 0
  let maxDescent = 0
  for (const seg of segments) {
    if (seg.kind === 'text') {
      const ascent = seg.ascentPx ?? defaultHeight * 0.8
      const descent = (seg.heightPx ?? defaultHeight) - ascent
      maxAscent = Math.max(maxAscent, ascent)
      maxDescent = Math.max(maxDescent, descent)
    } else if (seg.kind === 'math') {
      const descent = (seg.verticalOffsetPx ?? MATH_BASE_SHIFT_PX) - MATH_BASE_SHIFT_PX
      const ascent = seg.heightPx - descent
      maxAscent = Math.max(maxAscent, ascent)
      maxDescent = Math.max(maxDescent, descent)
    }
  }
  if (maxAscent === 0 && maxDescent === 0) {
    maxAscent = defaultHeight * 0.8
    maxDescent = defaultHeight * 0.2
  }
  const heightPx = maxAscent + maxDescent
  return { segments, widthPx, heightPx, baselinePx: maxAscent }
}

// ── High-level API ────────────────────────────────────────────────────────────

/**
 * Render a label using the hybrid text+math layout engine.
 *
 * This is the main entry point for node/edge label rendering.
 * It replaces the MathJax-only path for labels with mixed content.
 *
 * @param label         Raw label string from TikZ
 * @param mathRenderer  Math renderer (MathJax or KaTeX)
 * @param textMeasurer  Text measurer (pretext in browser, heuristic in Node.js)
 * @param options       Layout options
 */
export function renderHybridLabel(
  label: string,
  mathRenderer: MathRenderer,
  textMeasurer: TextMeasurer,
  options: {
    font?: string
    maxWidthPx?: number
    lineGapPx?: number
    align?: 'left' | 'center' | 'right'
    scale?: number
  } = {},
): MathResult & { isHybrid: true } {
  const font = options.font ?? '10px serif'
  const scale = options.scale ?? 1

  const segments = parseLabel(label.trim())

  // Fast path: if all-math (e.g. "$x^2$"), delegate to MathRenderer directly
  if (isPureMath(segments)) {
    const mathSeg = segments[0] as MathSegment
    const delimited = mathSeg.display ? `$$${mathSeg.content}$$` : `$${mathSeg.content}$`
    const result = mathRenderer(delimited)
    return { ...result, isHybrid: true }
  }

  // Fast path: if all-text with no linebreaks, delegate to MathRenderer directly.
  // MathJax handles plain text with proper font metrics; hybrid <text> would differ.
  // But if there are linebreaks, we need the hybrid layout for proper multiline rendering.
  const hasMath = segments.some((seg) => seg.kind === 'math')
  const hasLinebreaks = segments.some((seg) => seg.kind === 'linebreak')
  if (!hasMath && !hasLinebreaks) {
    const result = mathRenderer(label.trim())
    return { ...result, isHybrid: true }
  }

  // If any text segment contains LaTeX backslash commands (e.g. \textcolor, \,, \bf),
  // delegate to MathJax — SVG <text> can't interpret them.
  // But not when there are linebreaks — those need hybrid layout.
  if (!hasLinebreaks) {
    const hasLatexCommands = segments.some((seg) => seg.kind === 'text' && /\\[a-zA-Z,;!]/.test(seg.content))
    if (hasLatexCommands) {
      const result = mathRenderer(label.trim())
      return { ...result, isHybrid: true }
    }
  }

  // Measure segments
  const measured = measureSegments(segments, mathRenderer, textMeasurer, font)

  // Layout
  const layout = layoutSegments(measured, textMeasurer, font, options.maxWidthPx, options.lineGapPx, options.align)

  const widthPx = layout.widthPx * scale
  const heightPx = layout.heightPx * scale

  // Wrap in a <g> with scale if needed
  let svgContent = layout.svgContent
  if (scale !== 1) {
    svgContent = `<g transform="scale(${scale})">${svgContent}</g>`
  }

  return {
    svgString: svgContent,
    widthPx,
    heightPx,
    verticalOffsetPx: 0,
    isHybrid: true,
  }
}
