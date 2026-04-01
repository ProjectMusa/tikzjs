/**
 * Unit tests for the hybrid text+math layout engine.
 */

import {
  parseLabel,
  isPureText,
  isPureMath,
  isSimpleLabel,
  heuristicMeasurer,
  measureSegments,
  layoutSegments,
  renderHybridLabel,
  buildCSSFont,
  parseFontSize,
} from '../../../src/math/textLayout'
import type { MathRenderer, MathResult } from '../../../src/math/index'

// ── Mock math renderer ────────────────────────────────────────────────────────

/** Simple mock math renderer that returns predictable dimensions. */
const mockMathRenderer: MathRenderer = (latex: string): MathResult => {
  // Strip delimiters for width calculation
  let inner = latex.trim()
  if (inner.startsWith('$$') && inner.endsWith('$$')) inner = inner.slice(2, -2)
  else if (inner.startsWith('$') && inner.endsWith('$')) inner = inner.slice(1, -1)

  return {
    svgString: `<svg width="${inner.length * 8}px" height="16px"><text>${inner}</text></svg>`,
    widthPx: inner.length * 8,
    heightPx: 16,
    verticalOffsetPx: 4,
  }
}

// ── parseLabel ────────────────────────────────────────────────────────────────

describe('parseLabel', () => {
  test('plain text returns single text segment', () => {
    const result = parseLabel('Hello world')
    expect(result).toEqual([{ kind: 'text', content: 'Hello world' }])
  })

  test('inline math $...$ returns math segment', () => {
    const result = parseLabel('$x^2$')
    expect(result).toEqual([{ kind: 'math', content: 'x^2', display: false }])
  })

  test('display math $$...$$ returns display math segment', () => {
    const result = parseLabel('$$\\sum_{i=0}^n$$')
    expect(result).toEqual([{ kind: 'math', content: '\\sum_{i=0}^n', display: true }])
  })

  test('mixed text and math', () => {
    const result = parseLabel('Area = $\\pi r^2$ cm')
    expect(result).toEqual([
      { kind: 'text', content: 'Area = ' },
      { kind: 'math', content: '\\pi r^2', display: false },
      { kind: 'text', content: ' cm' },
    ])
  })

  test('\\(...\\) inline math', () => {
    const result = parseLabel('The value \\(x + 1\\) is positive')
    expect(result).toEqual([
      { kind: 'text', content: 'The value ' },
      { kind: 'math', content: 'x + 1', display: false },
      { kind: 'text', content: ' is positive' },
    ])
  })

  test('\\[...\\] display math', () => {
    const result = parseLabel('\\[E = mc^2\\]')
    expect(result).toEqual([{ kind: 'math', content: 'E = mc^2', display: true }])
  })

  test('explicit linebreak \\\\', () => {
    const result = parseLabel('Line 1\\\\Line 2')
    expect(result).toEqual([
      { kind: 'text', content: 'Line 1' },
      { kind: 'linebreak' },
      { kind: 'text', content: 'Line 2' },
    ])
  })

  test('multiple math segments', () => {
    const result = parseLabel('$a$ + $b$ = $c$')
    expect(result).toEqual([
      { kind: 'math', content: 'a', display: false },
      { kind: 'text', content: ' + ' },
      { kind: 'math', content: 'b', display: false },
      { kind: 'text', content: ' = ' },
      { kind: 'math', content: 'c', display: false },
    ])
  })

  test('empty string returns empty array', () => {
    expect(parseLabel('')).toEqual([])
  })

  test('linebreak with surrounding whitespace', () => {
    const result = parseLabel('Top\\\\  Bottom')
    expect(result).toEqual([
      { kind: 'text', content: 'Top' },
      { kind: 'linebreak' },
      { kind: 'text', content: 'Bottom' },
    ])
  })

  test('does not confuse \\( with \\\\', () => {
    const result = parseLabel('\\(x\\)')
    expect(result).toEqual([{ kind: 'math', content: 'x', display: false }])
  })
})

// ── isPureText / isPureMath / isSimpleLabel ───────────────────────────────────

describe('segment classification', () => {
  test('isPureText for plain text', () => {
    expect(isPureText(parseLabel('Hello'))).toBe(true)
  })

  test('isPureText false for mixed content', () => {
    expect(isPureText(parseLabel('Hello $x$'))).toBe(false)
  })

  test('isPureMath for single math', () => {
    expect(isPureMath(parseLabel('$x^2$'))).toBe(true)
  })

  test('isPureMath false for text', () => {
    expect(isPureMath(parseLabel('Hello'))).toBe(false)
  })

  test('isSimpleLabel for plain text', () => {
    expect(isSimpleLabel('Hello world')).toBe(true)
  })

  test('isSimpleLabel false for math', () => {
    expect(isSimpleLabel('Hello $x$')).toBe(false)
  })

  test('isSimpleLabel false for linebreak', () => {
    expect(isSimpleLabel('A\\\\B')).toBe(false)
  })
})

// ── buildCSSFont ──────────────────────────────────────────────────────────────

describe('buildCSSFont', () => {
  test('default 10pt serif', () => {
    expect(buildCSSFont({})).toBe('normal normal 13.33px serif')
  })

  test('bold italic custom font', () => {
    const result = buildCSSFont({ bold: true, italic: true, fontSize: 12, fontFamily: 'sans-serif' })
    expect(result).toBe('italic bold 16px sans-serif')
  })
})

// ── parseFontSize ─────────────────────────────────────────────────────────────

describe('parseFontSize', () => {
  test('extracts px size', () => {
    expect(parseFontSize('normal 13.33px serif')).toBeCloseTo(13.33, 1)
  })

  test('returns default for no match', () => {
    expect(parseFontSize('serif')).toBe(10)
  })
})

// ── heuristicMeasurer ─────────────────────────────────────────────────────────

describe('heuristicMeasurer', () => {
  test('measureText returns reasonable dimensions', () => {
    const result = heuristicMeasurer.measureText('Hello', '12px serif')
    expect(result.widthPx).toBeGreaterThan(0)
    expect(result.heightPx).toBeGreaterThan(0)
    expect(result.ascentPx).toBeGreaterThan(0)
  })

  test('wider text has larger width', () => {
    const short = heuristicMeasurer.measureText('Hi', '12px serif')
    const long = heuristicMeasurer.measureText('Hello World', '12px serif')
    expect(long.widthPx).toBeGreaterThan(short.widthPx)
  })

  test('layoutText wraps at maxWidth', () => {
    const result = heuristicMeasurer.layoutText(
      'This is a long text that should wrap across multiple lines',
      '12px serif',
      60, // very narrow
      14.4,
    )
    expect(result.lines.length).toBeGreaterThan(1)
    expect(result.totalHeight).toBeGreaterThan(14.4)
  })

  test('layoutText single line when wide enough', () => {
    const result = heuristicMeasurer.layoutText('Short', '12px serif', 500, 14.4)
    expect(result.lines.length).toBe(1)
    expect(result.lines[0].text).toBe('Short')
  })
})

// ── measureSegments ───────────────────────────────────────────────────────────

describe('measureSegments', () => {
  test('measures text segment', () => {
    const segments = parseLabel('Hello')
    const measured = measureSegments(segments, mockMathRenderer, heuristicMeasurer, '12px serif')
    expect(measured).toHaveLength(1)
    expect(measured[0].kind).toBe('text')
    expect((measured[0] as any).widthPx).toBeGreaterThan(0)
  })

  test('measures math segment via mock renderer', () => {
    const segments = parseLabel('$x^2$')
    const measured = measureSegments(segments, mockMathRenderer, heuristicMeasurer, '12px serif')
    expect(measured).toHaveLength(1)
    expect(measured[0].kind).toBe('math')
    expect((measured[0] as any).svgString).toContain('<svg')
  })

  test('measures mixed segments', () => {
    const segments = parseLabel('Area = $\\pi r^2$')
    const measured = measureSegments(segments, mockMathRenderer, heuristicMeasurer, '12px serif')
    expect(measured).toHaveLength(2)
    expect(measured[0].kind).toBe('text')
    expect(measured[1].kind).toBe('math')
  })
})

// ── layoutSegments ────────────────────────────────────────────────────────────

describe('layoutSegments', () => {
  test('single text line', () => {
    const segments = parseLabel('Hello')
    const measured = measureSegments(segments, mockMathRenderer, heuristicMeasurer, '12px serif')
    const result = layoutSegments(measured, heuristicMeasurer, '12px serif')
    expect(result.lines).toHaveLength(1)
    expect(result.widthPx).toBeGreaterThan(0)
    expect(result.heightPx).toBeGreaterThan(0)
  })

  test('explicit linebreak creates two lines', () => {
    const segments = parseLabel('Top\\\\Bottom')
    const measured = measureSegments(segments, mockMathRenderer, heuristicMeasurer, '12px serif')
    const result = layoutSegments(measured, heuristicMeasurer, '12px serif')
    expect(result.lines).toHaveLength(2)
  })

  test('text wrapping with maxWidth', () => {
    const segments = parseLabel('This is a sentence that should be wrapped')
    const measured = measureSegments(segments, mockMathRenderer, heuristicMeasurer, '12px serif')
    const result = layoutSegments(measured, heuristicMeasurer, '12px serif', 50)
    expect(result.lines.length).toBeGreaterThan(1)
  })

  test('mixed text+math in single line', () => {
    const segments = parseLabel('Value: $x^2$')
    const measured = measureSegments(segments, mockMathRenderer, heuristicMeasurer, '12px serif')
    const result = layoutSegments(measured, heuristicMeasurer, '12px serif')
    expect(result.lines).toHaveLength(1)
    expect(result.lines[0].segments).toHaveLength(2)
    expect(result.lines[0].segments[0].kind).toBe('text')
    expect(result.lines[0].segments[1].kind).toBe('math')
  })

  test('SVG content is generated', () => {
    const segments = parseLabel('Hello $x$')
    const measured = measureSegments(segments, mockMathRenderer, heuristicMeasurer, '12px serif')
    const result = layoutSegments(measured, heuristicMeasurer, '12px serif')
    expect(result.svgContent).toContain('<text')
    expect(result.svgContent).toContain('<g transform')
  })
})

// ── renderHybridLabel ─────────────────────────────────────────────────────────

describe('renderHybridLabel', () => {
  test('pure math delegates to mathRenderer', () => {
    const result = renderHybridLabel('$x^2$', mockMathRenderer, heuristicMeasurer)
    expect(result.isHybrid).toBe(true)
    expect(result.svgString).toContain('x^2')
    expect(result.widthPx).toBeGreaterThan(0)
  })

  test('pure text uses text layout', () => {
    const result = renderHybridLabel('Hello world', mockMathRenderer, heuristicMeasurer)
    expect(result.isHybrid).toBe(true)
    expect(result.svgString).toContain('<text')
    expect(result.widthPx).toBeGreaterThan(0)
  })

  test('mixed content produces both text and math', () => {
    const result = renderHybridLabel('Area = $\\pi r^2$ meters', mockMathRenderer, heuristicMeasurer)
    expect(result.isHybrid).toBe(true)
    expect(result.svgString).toContain('<text')
    expect(result.svgString).toContain('<svg')
  })

  test('respects maxWidthPx for text wrapping', () => {
    const narrow = renderHybridLabel('This is a long label that should wrap', mockMathRenderer, heuristicMeasurer, {
      maxWidthPx: 40,
    })
    const wide = renderHybridLabel('This is a long label that should wrap', mockMathRenderer, heuristicMeasurer, {
      maxWidthPx: 1000,
    })
    // Narrow should be taller (more lines)
    expect(narrow.heightPx).toBeGreaterThan(wide.heightPx)
  })

  test('scale applies to dimensions', () => {
    const normal = renderHybridLabel('Hi', mockMathRenderer, heuristicMeasurer)
    const scaled = renderHybridLabel('Hi', mockMathRenderer, heuristicMeasurer, { scale: 2 })
    expect(scaled.widthPx).toBeCloseTo(normal.widthPx * 2, 0)
    expect(scaled.heightPx).toBeCloseTo(normal.heightPx * 2, 0)
  })

  test('multiline with explicit \\\\', () => {
    const result = renderHybridLabel('Line 1\\\\Line 2', mockMathRenderer, heuristicMeasurer)
    expect(result.heightPx).toBeGreaterThan(renderHybridLabel('Line 1', mockMathRenderer, heuristicMeasurer).heightPx)
  })
})
