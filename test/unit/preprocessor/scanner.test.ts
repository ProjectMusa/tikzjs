/**
 * Unit tests for src/preprocessor/scanner.ts
 *
 * The scanner is the most foundational piece of the preprocessor —
 * everything else builds on it, so it needs thorough coverage.
 */

import { Scanner, splitCommaList, parseKeyValue, stripComments, ScanError } from '../../../src/preprocessor/scanner'

describe('Scanner.readGroup', () => {
  test('reads a simple brace group', () => {
    const s = new Scanner('{hello}')
    expect(s.readGroup()).toBe('hello')
    expect(s.done).toBe(true)
  })

  test('reads a nested brace group', () => {
    const s = new Scanner('{a{b}c}')
    expect(s.readGroup()).toBe('a{b}c')
  })

  test('handles empty group', () => {
    const s = new Scanner('{}')
    expect(s.readGroup()).toBe('')
  })

  test('handles whitespace before group', () => {
    const s = new Scanner('  {foo}')
    expect(s.readGroup()).toBe('foo')
  })

  test('throws on missing opening brace', () => {
    const s = new Scanner('hello')
    expect(() => s.readGroup()).toThrow(ScanError)
  })

  test('throws on unbalanced braces', () => {
    const s = new Scanner('{unclosed')
    expect(() => s.readGroup()).toThrow(ScanError)
  })

  test('does not trip on math mode dollar inside', () => {
    const s = new Scanner('{$x^2$}')
    expect(s.readGroup()).toBe('$x^2$')
  })

  test('does not trip on escaped braces inside', () => {
    const s = new Scanner('{a\\{b\\}c}')
    expect(s.readGroup()).toBe('a\\{b\\}c')
  })
})

describe('Scanner.readOptions', () => {
  test('reads a simple bracket option', () => {
    const s = new Scanner('[draw=red]')
    expect(s.readOptions()).toBe('draw=red')
  })

  test('reads nested braces inside options', () => {
    const s = new Scanner('[fill={blue!50}]')
    expect(s.readOptions()).toBe('fill={blue!50}')
  })

  test('reads nested brackets', () => {
    const s = new Scanner('[a=[b]]')
    expect(s.readOptions()).toBe('a=[b]')
  })

  test('returns null when no bracket present', () => {
    const s = new Scanner('{hello}')
    expect(s.readOptions()).toBeNull()
    expect(s.pos).toBe(0) // position restored
  })

  test('reads empty brackets', () => {
    const s = new Scanner('[]')
    expect(s.readOptions()).toBe('')
  })

  test('handles multiple comma-separated options', () => {
    const s = new Scanner('[draw=red, fill=blue, thick]')
    expect(s.readOptions()).toBe('draw=red, fill=blue, thick')
  })
})

describe('Scanner.readControlSequence', () => {
  test('reads a word control sequence', () => {
    const s = new Scanner('\\draw')
    expect(s.readControlSequence()).toBe('\\draw')
    expect(s.done).toBe(true)
  })

  test('reads a single-char control sequence', () => {
    const s = new Scanner('\\{')
    expect(s.readControlSequence()).toBe('\\{')
  })

  test('reads backslash-backslash', () => {
    const s = new Scanner('\\\\')
    expect(s.readControlSequence()).toBe('\\\\')
  })

  test('stops at end of word', () => {
    const s = new Scanner('\\draw ')
    expect(s.readControlSequence()).toBe('\\draw')
    expect(s.peek()).toBe(' ')
  })
})

describe('Scanner.splitCells (tikzcd)', () => {
  test('splits a single row', () => {
    const s = new Scanner('A & B & C')
    const cells = s.splitCells()
    expect(cells).toEqual([['A', 'B', 'C']])
  })

  test('splits multiple rows', () => {
    const s = new Scanner('A & B \\\\ C & D')
    const cells = s.splitCells()
    expect(cells).toHaveLength(2)
    expect(cells[0]).toEqual(['A', 'B'])
    expect(cells[1]).toEqual(['C', 'D'])
  })

  test('does not split & inside braces', () => {
    const s = new Scanner('{A & B}')
    const cells = s.splitCells()
    expect(cells[0][0]).toBe('{A & B}')
  })

  test('does not split \\\\ inside math mode', () => {
    const s = new Scanner('$A \\\\ B$')
    const cells = s.splitCells()
    expect(cells).toHaveLength(1) // no row split inside $
  })

  test('trims cell content', () => {
    const s = new Scanner('  A  &  B  ')
    const cells = s.splitCells()
    expect(cells[0]).toEqual(['A', 'B'])
  })
})

describe('Scanner.readEnvironmentBody', () => {
  test('reads simple environment body', () => {
    const s = new Scanner('hello \\end{myenv}')
    expect(s.readEnvironmentBody('myenv')).toBe('hello ')
  })

  test('handles nested same-name environments', () => {
    const s = new Scanner('\\begin{myenv}inner\\end{myenv}\\end{myenv}')
    expect(s.readEnvironmentBody('myenv')).toBe('\\begin{myenv}inner\\end{myenv}')
  })

  test('throws on unterminated environment', () => {
    const s = new Scanner('unclosed')
    expect(() => s.readEnvironmentBody('myenv')).toThrow(ScanError)
  })
})

describe('splitCommaList', () => {
  test('splits simple comma list', () => {
    expect(splitCommaList('a,b,c')).toEqual(['a', 'b', 'c'])
  })

  test('handles spaces around commas (items are trimmed)', () => {
    // splitCommaList trims each item by design (TikZ ignores surrounding spaces in options)
    expect(splitCommaList('a, b, c')).toEqual(['a', 'b', 'c'])
  })

  test('does not split inside braces', () => {
    expect(splitCommaList('fill={blue,50},draw')).toEqual(['fill={blue,50}', 'draw'])
  })

  test('handles empty list', () => {
    expect(splitCommaList('')).toEqual([])
  })

  test('handles trailing comma', () => {
    expect(splitCommaList('a,b,')).toEqual(['a', 'b'])
  })

  test('handles single item', () => {
    expect(splitCommaList('draw=red')).toEqual(['draw=red'])
  })
})

describe('parseKeyValue', () => {
  test('parses key only', () => {
    expect(parseKeyValue('draw')).toEqual({ key: 'draw' })
  })

  test('parses key=value', () => {
    expect(parseKeyValue('draw=red')).toEqual({ key: 'draw', value: 'red' })
  })

  test('strips braces from value', () => {
    expect(parseKeyValue('fill={blue!50}')).toEqual({ key: 'fill', value: 'blue!50' })
  })

  test('parses arrow shorthand', () => {
    expect(parseKeyValue('->')).toEqual({ key: '->' })
    expect(parseKeyValue('<->')).toEqual({ key: '<->' })
  })

  test('handles value with spaces', () => {
    expect(parseKeyValue('bend left=30')).toEqual({ key: 'bend left', value: '30' })
  })
})

describe('stripComments', () => {
  test('strips a line comment', () => {
    expect(stripComments('a % comment\nb')).toBe('a \nb')
  })

  test('preserves escaped percent', () => {
    expect(stripComments('a\\%b')).toBe('a\\%b')
  })

  test('strips multiple comments', () => {
    const src = '\\draw % first\n(0,0) % second\n-- (1,1);'
    const result = stripComments(src)
    expect(result).not.toContain('first')
    expect(result).not.toContain('second')
    expect(result).toContain('\\draw')
    expect(result).toContain('(0,0)')
    expect(result).toContain('-- (1,1)')
  })
})
