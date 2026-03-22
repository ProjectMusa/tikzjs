/**
 * Macro expander for \def and \newcommand definitions.
 *
 * Handles:
 *   \def\cmdname{body}
 *   \newcommand{\cmdname}{body}
 *   \newcommand{\cmdname}[n]{body}          — n positional arguments
 *   \renewcommand{\cmdname}{body}           — same as \newcommand
 *   \newcommand{\cmdname}[n][default]{body} — n args with optional first arg
 *
 * Substitutes #1..#9 with actual arguments in the body.
 *
 * This is not a full TeX macro system — it handles the common patterns
 * used in TikZ diagram preambles. For full TeX expansion, TexLive should
 * be used via the golden test pipeline.
 */

import { Scanner, ScanError } from './scanner.js'

export interface MacroDefinition {
  name: string
  argCount: number
  optionalFirstDefault?: string // if first arg is optional, its default value
  body: string
}

export class MacroTable {
  private _macros: Map<string, MacroDefinition> = new Map()

  define(macro: MacroDefinition): void {
    this._macros.set(macro.name, macro)
  }

  get(name: string): MacroDefinition | undefined {
    return this._macros.get(name)
  }

  has(name: string): boolean {
    return this._macros.has(name)
  }

  clone(): MacroTable {
    const copy = new MacroTable()
    for (const [name, def] of this._macros) {
      copy._macros.set(name, def)
    }
    return copy
  }
}

/**
 * Expand a macro call by substituting arguments into the body.
 * @param body  The macro body string containing #1..#n placeholders
 * @param args  Array of argument strings (0-indexed, so args[0] = #1)
 */
export function expandMacroBody(body: string, args: string[]): string {
  // Replace #1..#9 with corresponding args
  return body.replace(/#(\d)/g, (_, d) => {
    const idx = parseInt(d, 10) - 1
    return args[idx] ?? ''
  })
}

/**
 * Read macro arguments from the scanner for a macro definition with argCount args.
 * Each argument is either:
 *   - A single non-space token (e.g. `A` or `\cmd`)
 *   - A brace-delimited group `{...}` (braces stripped from result)
 *
 * @returns Array of argument strings (length = argCount)
 */
export function readMacroArgs(
  scanner: Scanner,
  argCount: number,
  optionalFirstDefault?: string
): string[] {
  const args: string[] = []

  for (let i = 0; i < argCount; i++) {
    scanner.skipWhitespaceAndComments()

    // First argument might be optional [...]
    if (i === 0 && optionalFirstDefault !== undefined) {
      const saved = scanner.save()
      if (scanner.peek() === '[') {
        const opt = scanner.readOptions()
        args.push(opt ?? optionalFirstDefault)
      } else {
        args.push(optionalFirstDefault)
      }
      continue
    }

    if (scanner.peek() === '{') {
      args.push(scanner.readGroup())
    } else {
      // Single token arg
      const token = scanner.readToken()
      args.push(token)
    }
  }

  return args
}

/**
 * Parse a \def\cmdname{body} or \def\cmdname#1#2{body} definition.
 * @param scanner  Positioned AFTER the \def token
 * @returns MacroDefinition or null if parsing fails
 */
export function parseDefDefinition(scanner: Scanner): MacroDefinition | null {
  scanner.skipWhitespaceAndComments()

  if (scanner.peek() !== '\\') return null
  const nameFull = scanner.readControlSequence()
  const name = nameFull.slice(1) // strip leading '\'

  // Count #n parameter specs
  let argCount = 0
  scanner.skipSpaces()
  while (scanner.peek() === '#') {
    scanner.consume() // '#'
    const digit = scanner.peek()
    if (/\d/.test(digit)) {
      const n = parseInt(scanner.consume(), 10)
      argCount = Math.max(argCount, n)
    }
  }

  scanner.skipSpaces()
  if (scanner.peek() !== '{') return null
  const body = scanner.readGroup()

  return { name, argCount, body }
}

/**
 * Parse a \newcommand{\cmdname}[n][default]{body} definition.
 * @param scanner  Positioned AFTER the \newcommand token
 * @returns MacroDefinition or null if parsing fails
 */
export function parseNewcommandDefinition(scanner: Scanner): MacroDefinition | null {
  scanner.skipWhitespaceAndComments()

  // Command name: either {\cmdname} or \cmdname
  let name: string
  if (scanner.peek() === '{') {
    const inner = scanner.readGroup()
    name = inner.startsWith('\\') ? inner.slice(1) : inner
  } else if (scanner.peek() === '\\') {
    const full = scanner.readControlSequence()
    name = full.slice(1)
  } else {
    return null
  }

  // Optional [n] argument count
  let argCount = 0
  const countStr = scanner.readOptions()
  if (countStr !== null) {
    argCount = parseInt(countStr, 10) || 0
  }

  // Optional [default] for optional first arg
  let optionalFirstDefault: string | undefined
  const defaultStr = scanner.readOptions()
  if (defaultStr !== null) {
    optionalFirstDefault = defaultStr
  }

  scanner.skipWhitespaceAndComments()
  if (scanner.peek() !== '{') return null
  const body = scanner.readGroup()

  return { name, argCount, optionalFirstDefault, body }
}

/**
 * Expand all macro usages in the source text.
 *
 * This is a single-pass expander — it scans through the text, and when it
 * encounters a control sequence that is in the macro table, it reads its
 * arguments and replaces the call with the expanded body.
 *
 * Note: This does not recursively re-expand the result. For diagrams that
 * define macros in terms of other macros, multiple passes may be needed.
 * In practice, TikZ diagrams rarely have deep macro chains.
 */
export function expandMacros(src: string, table: MacroTable): string {
  const scanner = new Scanner(src)
  let result = ''

  while (!scanner.done) {
    const ch = scanner.peek()

    if (ch === '%') {
      // Preserve comments as-is (they will be stripped by the caller if needed)
      const start = scanner.save()
      while (!scanner.done && scanner.peek() !== '\n') scanner.consume()
      result += scanner.source.slice(start, scanner.save())
      continue
    }

    if (ch === '\\') {
      const tokenStart = scanner.save()
      const token = scanner.readControlSequence()
      const macroName = token.slice(1)

      const macro = table.get(macroName)
      if (macro) {
        const args = readMacroArgs(scanner, macro.argCount, macro.optionalFirstDefault)
        result += expandMacroBody(macro.body, args)
        // In TeX, {} after a 0-arg macro is a name-terminating empty group — consume it
        if (macro.argCount === 0) {
          const saved = scanner.save()
          if (!scanner.done && scanner.peek() === '{') {
            scanner.consume() // {
            if (!scanner.done && scanner.peek() === '}') {
              scanner.consume() // }
            } else {
              scanner.restore(saved)
            }
          }
        }
      } else {
        result += token
      }
      continue
    }

    result += scanner.consume()
  }

  return result
}

/**
 * Scan source for macro definitions (\def, \newcommand, \renewcommand),
 * collect them into the table, and return the source with the definitions
 * removed (so they don't appear in the output stream).
 */
export function collectAndStripMacros(src: string, table: MacroTable): string {
  const scanner = new Scanner(src)
  let result = ''

  while (!scanner.done) {
    const ch = scanner.peek()

    if (ch === '\\') {
      const tokenStart = scanner.save()
      const token = scanner.readControlSequence()

      if (token === '\\def') {
        const macro = parseDefDefinition(scanner)
        if (macro) {
          table.define(macro)
          continue // strip the \def from output
        }
        result += token
        continue
      }

      if (token === '\\newcommand' || token === '\\renewcommand' || token === '\\providecommand') {
        const macro = parseNewcommandDefinition(scanner)
        if (macro) {
          table.define(macro)
          continue // strip from output
        }
        result += token
        continue
      }

      // Pass \definecolor and \colorlet through — they are handled in collectAndStripStyles
      if (token === '\\definecolor' || token === '\\colorlet') {
        result += token
        continue
      }

      // Replace TeX dimension registers with fixed values
      if (token === '\\linewidth' || token === '\\textwidth' || token === '\\columnwidth') {
        result += '345pt'
        continue
      }
      if (token === '\\pgflinewidth') {
        result += '0.4pt'
        continue
      }

      // Strip single-arg LaTeX commands that have no visual effect in TikZ
      if (token === '\\vspace' || token === '\\hspace' || token === '\\pgfmathsetmacro') {
        scanner.skipWhitespaceAndComments()
        if (scanner.peek() === '{') {
          scanner.readGroup()
          continue
        }
        result += token
        continue
      }

      result += token
      continue
    }

    result += scanner.consume()
  }

  return result
}
