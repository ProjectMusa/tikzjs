/**
 * tikzcd preprocessor.
 *
 * Converts \begin{tikzcd}...\end{tikzcd} into a structured representation
 * that the main parser can handle.
 *
 * tikzcd grid syntax:
 *   A & B & C \\
 *   D & E & F
 *
 * Each cell may contain:
 *   - A label (raw LaTeX)
 *   - Zero or more \ar[direction, opts]{label} declarations
 *
 * Direction strings for \ar:
 *   r, l, u, d  — right, left, up, down (1 step)
 *   rr, uu, ...  — 2 steps
 *   Combined: rd = down-right diagonal
 *
 * Output: a TikzcdGrid structure describing the matrix and its arrows.
 */

import { Scanner, ScanError, splitCommaList, parseKeyValue } from './scanner.js'
import { RawOption } from '../ir/types.js'
import { parseOptionString } from './styleRegistry.js'

export interface TikzcdCell {
  row: number
  col: number
  label: string // raw LaTeX, excluding \ar commands
  arrows: TikzcdArrow[]
}

export interface TikzcdArrow {
  /** Direction string e.g. "rr", "d", "rd". */
  direction: string
  /** Row delta (positive = down). */
  rowDelta: number
  /** Col delta (positive = right). */
  colDelta: number
  /** Raw options from \ar[opts]. */
  rawOptions: RawOption[]
  /** Optional label from \ar[opts]{label}. */
  label?: string
  /** Additional label above/below: \ar[opts]'{label}. */
  labelPrime?: string
}

export interface TikzcdGrid {
  /** Global options from \begin{tikzcd}[opts]. */
  rawOptions: RawOption[]
  cells: TikzcdCell[]
  rowCount: number
  colCount: number
}

/**
 * Parse a tikzcd environment body into a TikzcdGrid.
 * @param body  Content between \begin{tikzcd}[opts] and \end{tikzcd}
 * @param optStr  The option string from [opts] (may be empty)
 */
export function parseTikzcdBody(body: string, optStr: string): TikzcdGrid {
  const rawOptions = parseOptionString(optStr)

  // Split into rows and columns
  const scanner = new Scanner(body)
  const rawRows = scanner.splitCells()

  const cells: TikzcdCell[] = []
  let maxCols = 0

  for (let rowIdx = 0; rowIdx < rawRows.length; rowIdx++) {
    const row = rawRows[rowIdx]
    maxCols = Math.max(maxCols, row.length)

    for (let colIdx = 0; colIdx < row.length; colIdx++) {
      const cellContent = row[colIdx]
      const cell = parseTikzcdCell(cellContent, rowIdx, colIdx)
      cells.push(cell)
    }
  }

  return {
    rawOptions,
    cells,
    rowCount: rawRows.length,
    colCount: maxCols,
  }
}

/**
 * Parse a single tikzcd cell: extract label and \ar commands.
 */
function parseTikzcdCell(content: string, row: number, col: number): TikzcdCell {
  const scanner = new Scanner(content)
  let label = ''
  const arrows: TikzcdArrow[] = []

  while (!scanner.done) {
    scanner.skipWhitespaceAndComments()
    if (scanner.done) break

    const ch = scanner.peek()

    if (ch === '\\') {
      const tokenStart = scanner.save()
      const token = scanner.readControlSequence()

      if (token === '\\ar' || token === '\\arrow') {
        const arrow = parseArCommand(scanner)
        if (arrow) arrows.push(arrow)
        continue
      }

      // Not an \ar — part of the label
      label += token
      continue
    }

    label += scanner.consume()
  }

  return {
    row,
    col,
    label: label.trim(),
    arrows,
  }
}

/**
 * Parse an \ar command. Scanner is positioned AFTER \ar or \arrow.
 * Syntax:  \ar[direction, opts]{label}  or  \ar[direction, opts]
 */
function parseArCommand(scanner: Scanner): TikzcdArrow | null {
  scanner.skipWhitespaceAndComments()

  if (scanner.peek() !== '[') return null
  const optStr = scanner.readOptions() ?? ''

  // Parse options: first token(s) that are direction chars, rest are style opts
  const { direction, rowDelta, colDelta, remainingOpts } = parseArDirection(optStr)

  const rawOptions = parseOptionString(remainingOpts)

  // Optional label argument(s)
  scanner.skipWhitespaceAndComments()
  let label: string | undefined
  let labelPrime: string | undefined

  if (scanner.peek() === '{') {
    label = scanner.readGroup().trim()
  }

  // \ar[...]{label}'{label'} — alternate label syntax
  if (scanner.peek() === "'") {
    scanner.consume()
    scanner.skipWhitespaceAndComments()
    if (scanner.peek() === '{') {
      labelPrime = scanner.readGroup().trim()
    }
  }

  return { direction, rowDelta, colDelta, rawOptions, label, labelPrime }
}

/**
 * Parse the direction from an \ar option string.
 * Directions are sequences of 'r', 'l', 'u', 'd' at the beginning of the option string.
 * Returns the direction string, computed deltas, and the remaining option text.
 */
function parseArDirection(optStr: string): {
  direction: string
  rowDelta: number
  colDelta: number
  remainingOpts: string
} {
  // Options are comma-separated; first item(s) might be direction chars
  const items = splitCommaList(optStr)

  let direction = ''
  let rowDelta = 0
  let colDelta = 0
  const styleItems: string[] = []

  for (const item of items) {
    const trimmed = item.trim()
    if (/^[rlud]+$/.test(trimmed)) {
      // Pure direction string
      direction += trimmed
      for (const ch of trimmed) {
        switch (ch) {
          case 'r': colDelta++; break
          case 'l': colDelta--; break
          case 'd': rowDelta++; break
          case 'u': rowDelta--; break
        }
      }
    } else {
      styleItems.push(item)
    }
  }

  return { direction, rowDelta, colDelta, remainingOpts: styleItems.join(',') }
}

/**
 * Scan source for \begin{tikzcd}...\end{tikzcd} environments,
 * parse them, and return structured grids alongside stripped source
 * (with the environments replaced by placeholder tokens for the main parser).
 */
export interface TikzcdExtraction {
  /** Source with \begin{tikzcd}...\end{tikzcd} replaced by \tikzjs@tikzcd{id} markers. */
  expandedSource: string
  /** Map from id → parsed grid. */
  grids: Map<string, TikzcdGrid>
}

export function extractTikzcdEnvironments(src: string): TikzcdExtraction {
  const scanner = new Scanner(src)
  let result = ''
  const grids = new Map<string, TikzcdGrid>()
  let counter = 0

  while (!scanner.done) {
    const ch = scanner.peek()

    if (ch === '\\') {
      const token = scanner.readControlSequence()

      if (token === '\\begin') {
        scanner.skipWhitespaceAndComments()
        if (scanner.peek() === '{') {
          const savedPos = scanner.save()
          const envName = scanner.readGroup()

          if (envName === 'tikzcd') {
            // Read optional options
            const optStr = scanner.readOptions() ?? ''
            // Read body
            const body = scanner.readEnvironmentBody('tikzcd')
            // Parse grid
            const grid = parseTikzcdBody(body, optStr)
            const id = `tikzcd_${counter++}`
            grids.set(id, grid)
            // Emit placeholder
            result += `\\tikzjsTikzcd{${id}}`
            continue
          } else {
            // Restore and emit as-is
            scanner.restore(savedPos)
            result += token
            continue
          }
        } else {
          result += token
          continue
        }
      }

      result += token
      continue
    }

    result += scanner.consume()
  }

  return { expandedSource: result, grids }
}
