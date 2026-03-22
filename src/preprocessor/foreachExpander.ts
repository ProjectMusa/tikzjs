/**
 * \foreach expander.
 *
 * Handles:
 *   \foreach \x in {a,b,c}{body}
 *   \foreach \x in {1,...,5}{body}      — numeric ranges
 *   \foreach \x in {1,3,...,9}{body}    — stepped ranges
 *   \foreach \x/\y in {a/1,b/2,c/3}{body}  — multi-variable
 *
 * Body may contain #1 as shorthand for the current value (rare but valid).
 * The loop variable `\x` is substituted literally.
 */

import { Scanner, ScanError, splitCommaList } from './scanner.js'

/**
 * Expand a \foreach loop and return the unrolled body.
 *
 * @param scanner  Positioned AFTER the \foreach token
 * @returns Expanded string to splice into the output
 */
export function expandForeach(scanner: Scanner): string {
  scanner.skipWhitespaceAndComments()

  // Read variable(s): \x or \x/\y or \x/\y/\z
  const variables = readForeachVariables(scanner)

  // Read 'in'
  scanner.skipWhitespaceAndComments()
  if (!scanner.match('in')) {
    // Try consuming the 'in' as a control sequence (shouldn't happen but be safe)
    throw new ScanError(`Expected 'in' in \\foreach at position ${scanner.pos}`)
  }

  // Read the value list {a,b,c} or [a,b,c]
  scanner.skipWhitespaceAndComments()
  let listStr: string
  if (scanner.peek() === '{') {
    listStr = scanner.readGroup()
  } else if (scanner.peek() === '[') {
    listStr = scanner.readOptions() ?? ''
  } else {
    throw new ScanError(`Expected '{' or '[' after 'in' in \\foreach at position ${scanner.pos}`)
  }

  // Read the body {body} or STATEMENT; (brace-less form)
  scanner.skipWhitespaceAndComments()
  let body: string
  if (scanner.peek() === '{') {
    body = scanner.readGroup()
  } else {
    // Brace-less body: read until ';' at top-level brace depth (inclusive of ';')
    body = ''
    let depth = 0
    while (!scanner.done) {
      const ch = scanner.peek()
      if (ch === '{') { depth++; body += scanner.consume() }
      else if (ch === '}') { depth--; body += scanner.consume() }
      else if (ch === ';' && depth === 0) { body += scanner.consume(); break }
      else { body += scanner.consume() }
    }
  }

  // Parse the value list into arrays
  const values = parseForeachList(listStr)

  // Expand: one copy of body per value set
  let result = ''
  for (const valueSet of values) {
    let expanded = body
    for (let i = 0; i < variables.length; i++) {
      const varName = variables[i] // e.g. "\\x"
      const value = valueSet[i] ?? ''
      // Replace \x with value (use global replace, respecting word boundaries)
      expanded = replaceVariable(expanded, varName, value)
    }
    result += expanded + '\n'
  }

  return result
}

/**
 * Read \foreach variable list: \x or \x/\y or \x/\y/\z
 * Returns array of variable names including the backslash.
 */
function readForeachVariables(scanner: Scanner): string[] {
  const variables: string[] = []

  scanner.skipWhitespaceAndComments()
  if (scanner.peek() !== '\\') {
    throw new ScanError(`Expected variable in \\foreach at position ${scanner.pos}`)
  }

  variables.push(scanner.readControlSequence())

  // Check for /\y /\z pattern (handles optional spaces: \x/\y or \x / \y)
  while (!scanner.done) {
    scanner.skipSpaces()
    if (scanner.peek() === '/') {
      // Look ahead past optional spaces for a backslash
      const saved = scanner.pos
      scanner.consume() // '/'
      scanner.skipSpaces()
      if (!scanner.done && scanner.peek() === '\\') {
        variables.push(scanner.readControlSequence())
      } else {
        // Not a variable separator — rewind
        scanner.pos = saved
        break
      }
    } else {
      break
    }
  }

  return variables
}

/**
 * Parse a foreach value list string into arrays of value sets.
 *
 * Handles:
 *   "a,b,c"                   → [["a"],["b"],["c"]]
 *   "1,2,...,5"               → [["1"],["2"],["3"],["4"],["5"]]
 *   "a/1,b/2"                 → [["a","1"],["b","2"]]
 *   "1,3,...,9"               → [["1"],["3"],["5"],["7"],["9"]]
 */
export function parseForeachList(src: string): string[][] {
  const raw = splitCommaList(src).map((s) => s.trim())

  // Detect ellipsis pattern: [..., "...", last]
  const ellipsisIdx = raw.findIndex((v) => v === '...')
  if (ellipsisIdx !== -1) {
    return expandEllipsisList(raw, ellipsisIdx)
  }

  // Split each item by '/' for multi-variable
  return raw.map((item) => splitSlash(item))
}

/**
 * Expand a list containing '...' into a full numeric sequence.
 * e.g. ["1","2","...","5"] → [["1"],["2"],["3"],["4"],["5"]]
 * e.g. ["1","3","...","9"] → [["1"],["3"],["5"],["7"],["9"]]
 */
function expandEllipsisList(items: string[], ellipsisIdx: number): string[][] {
  const before = items.slice(0, ellipsisIdx)
  const after = items.slice(ellipsisIdx + 1)

  if (before.length === 0 || after.length === 0) {
    // Can't expand — return as-is without ellipsis
    return [...before, ...after].map((v) => [v])
  }

  const first = parseFloat(before[0])
  const last = parseFloat(after[after.length - 1])

  if (isNaN(first) || isNaN(last)) {
    // Non-numeric — try alphabetic range (A, B, ..., F)
    const firstChar = before[0].trim()
    const lastChar = after[after.length - 1].trim()
    if (firstChar.length === 1 && /[A-Za-z]/.test(firstChar) && lastChar.length === 1 && /[A-Za-z]/.test(lastChar)) {
      const startCode = firstChar.charCodeAt(0)
      const endCode = lastChar.charCodeAt(0)
      const step = startCode <= endCode ? 1 : -1
      const result: string[][] = []
      for (let c = startCode; step > 0 ? c <= endCode : c >= endCode; c += step) {
        result.push([String.fromCharCode(c)])
      }
      return result
    }
    // Can't expand — return before + after without ellipsis
    return [...before, ...after].map((v) => [v])
  }

  // Determine step
  const step = before.length >= 2 ? parseFloat(before[1]) - first : last > first ? 1 : -1

  if (step === 0 || isNaN(step)) {
    return [[String(first)]]
  }

  const result: string[][] = []
  // Add the explicit 'before' items (excluding the step item if present)
  result.push([String(first)])

  const startFrom = before.length >= 2 ? parseFloat(before[1]) : first + step

  for (
    let v = startFrom;
    step > 0 ? v <= last + 1e-9 : v >= last - 1e-9;
    v += step
  ) {
    // Round to avoid floating point artifacts
    const rounded = Math.round(v * 1e9) / 1e9
    result.push([formatNumber(rounded)])
  }

  return result
}

/** Format a number, omitting unnecessary trailing zeros. */
function formatNumber(n: number): string {
  if (Number.isInteger(n)) return String(n)
  return String(n)
}

/** Split "a/b/c" by top-level slash. */
function splitSlash(s: string): string[] {
  const parts: string[] = []
  let current = ''
  let depth = 0

  for (const ch of s) {
    if (ch === '{') {
      depth++
      current += ch
    } else if (ch === '}') {
      depth--
      current += ch
    } else if (ch === '/' && depth === 0) {
      parts.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }
  parts.push(current.trim())
  return parts
}

/**
 * Replace all occurrences of a variable (e.g. `\x`) in body with value.
 * The variable name must match as a complete token — not as a prefix of
 * a longer control sequence.
 */
function replaceVariable(body: string, varName: string, value: string): string {
  if (!varName.startsWith('\\')) {
    return body.split(varName).join(value)
  }

  const csName = varName.slice(1) // e.g. "x"
  if (!/^[a-zA-Z]+$/.test(csName)) {
    // Single-char control sequence — replace \X not followed by letter
    return body.replace(new RegExp(`\\\\${escapeRegex(csName)}(?![a-zA-Z])`, 'g'), value)
  }

  // Word control sequence — replace \word not followed by letter
  return body.replace(new RegExp(`\\\\${escapeRegex(csName)}(?![a-zA-Z])`, 'g'), value)
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Scan source for \foreach loops, expand them, and return the result.
 * Nested \foreach are handled by recursive expansion.
 */
export function expandAllForeach(src: string): string {
  const scanner = new Scanner(src)
  let result = ''

  while (!scanner.done) {
    const ch = scanner.peek()

    if (ch === '%') {
      const start = scanner.save()
      while (!scanner.done && scanner.peek() !== '\n') scanner.consume()
      result += scanner.source.slice(start, scanner.save())
      continue
    }

    if (ch === '\\') {
      const token = scanner.readControlSequence()

      if (token === '\\foreach') {
        try {
          const expanded = expandForeach(scanner)
          // Recursively expand any nested \foreach
          result += expandAllForeach(expanded)
        } catch (e) {
          // If expansion fails, emit the token as-is and continue
          result += token
        }
        continue
      }

      result += token
      continue
    }

    result += scanner.consume()
  }

  return result
}
