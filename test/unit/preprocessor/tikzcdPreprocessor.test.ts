/**
 * Unit tests for tikzcd preprocessor.
 */

import { parseTikzcdBody, extractTikzcdEnvironments } from '../../../src/preprocessor/tikzcdPreprocessor'

describe('parseTikzcdBody', () => {
  test('parses a simple 1x2 diagram', () => {
    const grid = parseTikzcdBody('A & B', '')
    expect(grid.rowCount).toBe(1)
    expect(grid.colCount).toBe(2)
    expect(grid.cells[0].label).toBe('A')
    expect(grid.cells[1].label).toBe('B')
  })

  test('parses a 2x2 diagram', () => {
    const grid = parseTikzcdBody('A & B \\\\ C & D', '')
    expect(grid.rowCount).toBe(2)
    expect(grid.colCount).toBe(2)
    expect(grid.cells[0]).toMatchObject({ row: 0, col: 0, label: 'A' })
    expect(grid.cells[3]).toMatchObject({ row: 1, col: 1, label: 'D' })
  })

  test('parses \\ar arrows', () => {
    const grid = parseTikzcdBody('A \\ar[r] & B', '')
    const cellA = grid.cells[0]
    expect(cellA.arrows).toHaveLength(1)
    expect(cellA.arrows[0].direction).toBe('r')
    expect(cellA.arrows[0].colDelta).toBe(1)
    expect(cellA.arrows[0].rowDelta).toBe(0)
  })

  test('parses \\ar with label', () => {
    const grid = parseTikzcdBody('A \\ar[r]{f} & B', '')
    const arrow = grid.cells[0].arrows[0]
    expect(arrow.label).toBe('f')
  })

  test('parses multi-step direction', () => {
    const grid = parseTikzcdBody('A \\ar[rr] & B & C', '')
    const arrow = grid.cells[0].arrows[0]
    expect(arrow.colDelta).toBe(2)
  })

  test('parses diagonal direction', () => {
    const grid = parseTikzcdBody('A \\ar[dr] & B \\\\ C & D', '')
    const arrow = grid.cells[0].arrows[0]
    expect(arrow.rowDelta).toBe(1)
    expect(arrow.colDelta).toBe(1)
  })

  test('handles empty cells', () => {
    const grid = parseTikzcdBody('A & & B', '')
    expect(grid.colCount).toBe(3)
    // Middle cell has empty label
    const middleCell = grid.cells.find(c => c.col === 1)
    expect(middleCell?.label).toBe('')
  })
})

describe('extractTikzcdEnvironments', () => {
  test('extracts and replaces tikzcd environment', () => {
    const src = '\\begin{tikzcd} A \\ar[r] & B \\end{tikzcd}'
    const { expandedSource, grids } = extractTikzcdEnvironments(src)
    expect(grids.size).toBe(1)
    expect(expandedSource).toContain('\\tikzjsTikzcd{')
    expect(expandedSource).not.toContain('\\begin{tikzcd}')
  })

  test('extracts multiple tikzcd environments', () => {
    const src = '\\begin{tikzcd}A\\end{tikzcd} text \\begin{tikzcd}B\\end{tikzcd}'
    const { expandedSource, grids } = extractTikzcdEnvironments(src)
    expect(grids.size).toBe(2)
  })

  test('leaves non-tikzcd content unchanged', () => {
    const src = '\\begin{tikzpicture}\\draw (0,0) -- (1,1);\\end{tikzpicture}'
    const { expandedSource, grids } = extractTikzcdEnvironments(src)
    expect(grids.size).toBe(0)
    expect(expandedSource).toBe(src)
  })
})
