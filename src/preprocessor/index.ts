/**
 * TikZ preprocessor pipeline.
 *
 * Transforms raw TikZ source through several passes before handing
 * to the PEG parser:
 *
 * 1. Collect \def / \newcommand macro definitions → strip from source
 * 2. Collect \tikzset / \tikzstyle style definitions → strip from source
 * 3. Expand \foreach loops
 * 4. Expand user-defined macros
 * 5. Extract \begin{tikzcd} environments → replace with placeholders
 *
 * The result is an ExpandedDoc containing:
 * - The preprocessed source string (ready for the PEG parser)
 * - The style registry (for option resolution during parsing)
 * - The macro table (for any late-bound expansion)
 * - The extracted tikzcd grids
 */

import { MacroTable, collectAndStripMacros, expandMacros } from './macroExpander.js'
import { StyleRegistry, parseTikzset, parseTikzstyle } from './styleRegistry.js'
import { expandAllForeach } from './foreachExpander.js'
import { extractTikzcdEnvironments, TikzcdGrid } from './tikzcdPreprocessor.js'
import { extractKnotEnvironments, KnotEnvironment } from './knotPreprocessor.js'
import { Scanner } from './scanner.js'

export { MacroTable, StyleRegistry }
export type { TikzcdGrid } from './tikzcdPreprocessor.js'
export type { KnotEnvironment, IRKnotBezier, KnotStrand } from './knotPreprocessor.js'

export interface ExpandedDoc {
  /** Preprocessed source string, ready for the PEG parser. */
  source: string
  /** Style definitions accumulated from \tikzset / \tikzstyle. */
  styleRegistry: StyleRegistry
  /** Macro definitions from \def / \newcommand. */
  macroTable: MacroTable
  /** Parsed tikzcd grids keyed by their placeholder IDs. */
  tikzcdGrids: Map<string, TikzcdGrid>
  /** Knot environments keyed by their placeholder IDs. */
  knotEnvs: Map<string, KnotEnvironment>
}

/**
 * Run the full preprocessor pipeline on raw TikZ source.
 *
 * The input may be:
 * - A bare `\tikz{...}` command
 * - A full `\begin{tikzpicture}...\end{tikzpicture}` environment
 * - A `\begin{tikzcd}...\end{tikzcd}` environment
 * - Any combination of the above
 *
 * Whitespace and comment handling:
 * Comments (%) are preserved through the pipeline but stripped before the
 * PEG parser sees them (the PEG grammar handles inline comments).
 */
export function preprocess(rawSource: string): ExpandedDoc {
  const macroTable = new MacroTable()
  const styleRegistry = new StyleRegistry()

  // Pass 1: Collect and strip macro definitions (\def, \newcommand)
  let src = collectAndStripMacros(rawSource, macroTable)

  // Pass 2: Collect and strip style definitions (\tikzset, \tikzstyle)
  src = collectAndStripStyles(src, styleRegistry)

  // Pass 3: Expand \foreach loops
  src = expandAllForeach(src)

  // Pass 4: Expand user macros
  if (macroTable['_macros'] || hasMacros(macroTable)) {
    src = expandMacros(src, macroTable)
  }

  // Pass 5: Extract \begin{knot}...\end{knot} environments
  const { expandedSource: knotExpanded, knots: knotEnvs } = extractKnotEnvironments(src)
  src = knotExpanded

  // Pass 6: Extract tikzcd environments
  const { expandedSource, grids: tikzcdGrids } = extractTikzcdEnvironments(src)
  src = expandedSource

  return {
    source: src,
    styleRegistry,
    macroTable,
    tikzcdGrids,
    knotEnvs,
  }
}

function hasMacros(table: MacroTable): boolean {
  // Check if any macros were defined (using the public has method isn't enough)
  // We use a dummy check here
  return false // MacroTable internal - table.has won't work for iteration
}

/**
 * Pre-scan source for .style definitions embedded in \begin{tikzpicture}[...] option blocks.
 * These are NOT stripped — the grammar still needs them — but they must be registered
 * in the style registry before the content is parsed.
 */
function extractTikzpictureOptionStyles(src: string, registry: StyleRegistry): void {
  const beginRe = /\\begin\s*\{\s*tikz(?:js)?picture\s*\}/g
  let m: RegExpExecArray | null
  while ((m = beginRe.exec(src)) !== null) {
    let i = m.index + m[0].length
    // Skip whitespace and comments up to the option block
    while (i < src.length && /[ \t\r\n]/.test(src[i])) i++
    if (src[i] !== '[') continue
    // Read balanced bracket content
    let depth = 0, j = i
    while (j < src.length) {
      if (src[j] === '[') depth++
      else if (src[j] === ']') { depth--; if (depth === 0) break }
      j++
    }
    const optContent = src.slice(i + 1, j)
    parseTikzset(optContent, registry)
  }
}

/**
 * Scan source for \tikzset{...} and \tikzstyle{name}=[...] commands,
 * collect into registry, and strip them from the source.
 * Also extracts .style definitions from \begin{tikzpicture}[...] option blocks.
 */
function collectAndStripStyles(src: string, registry: StyleRegistry): string {
  // Pre-register any .style definitions from \begin{tikzpicture}[...] option blocks
  // before the main scan, so they're available when node options are resolved.
  extractTikzpictureOptionStyles(src, registry)
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

      if (token === '\\tikzset') {
        scanner.skipWhitespaceAndComments()
        if (scanner.peek() === '{') {
          const body = scanner.readGroup()
          parseTikzset(body, registry)
          continue // strip from output
        }
        result += token
        continue
      }

      if (token === '\\tikzstyle') {
        scanner.skipWhitespaceAndComments()
        // \tikzstyle{name}=[...] or \tikzstyle name=[...]
        let name: string
        if (scanner.peek() === '{') {
          name = scanner.readGroup()
        } else {
          // Read until '=' or space
          const start = scanner.save()
          let n = ''
          while (!scanner.done && scanner.peek() !== '=' && scanner.peek() !== '[' && !/\s/.test(scanner.peek())) {
            n += scanner.consume()
          }
          name = n.trim()
        }

        scanner.skipWhitespaceAndComments()
        let optBody = ''
        if (scanner.peek() === '=') {
          scanner.consume()
          scanner.skipWhitespaceAndComments()
        }
        if (scanner.peek() === '[') {
          optBody = scanner.readOptions() ?? ''
        }
        parseTikzstyle(name, optBody, registry)
        continue // strip from output
      }

      result += token
      continue
    }

    result += scanner.consume()
  }

  return result
}


/**
 * Convenience: preprocess and return just the source string.
 * Useful for testing.
 */
export function preprocessSource(rawSource: string): string {
  return preprocess(rawSource).source
}
