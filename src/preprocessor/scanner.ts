/**
 * Balanced-group scanner for TikZ/LaTeX source.
 *
 * LaTeX text cannot be safely processed with simple regexes because:
 * - Braces `{}` and brackets `[]` must be balanced before you can find
 *   delimiters like `\\`, `&`, `\end{...}`, etc.
 * - Math mode `$...$` and `\(...\)` suppress some special characters.
 * - Comments `%...` should be stripped before other processing.
 *
 * This scanner provides:
 * - `readGroup()`    — consume a brace-delimited group, return its contents
 * - `readOptions()`  — consume a bracket-delimited option list
 * - `readToken()`    — consume one TeX token (control sequence or character)
 * - `skipSpaces()`   — skip whitespace
 * - `readUntil()`    — read until a condition, respecting group nesting
 * - `splitCells()`   — split text by `&` and `\\` respecting nesting (for tikzcd)
 */
export class Scanner {
  private src: string
  pos: number

  constructor(src: string, startPos = 0) {
    this.src = src
    this.pos = startPos
  }

  get source(): string {
    return this.src
  }

  get length(): number {
    return this.src.length
  }

  /** True when we've consumed all input. */
  get done(): boolean {
    return this.pos >= this.src.length
  }

  /** Peek at current character without consuming. */
  peek(offset = 0): string {
    return this.src[this.pos + offset] ?? ''
  }

  /** Peek at a multi-character substring. */
  peekStr(len: number): string {
    return this.src.slice(this.pos, this.pos + len)
  }

  /** Consume and return current character. */
  consume(): string {
    return this.src[this.pos++] ?? ''
  }

  /** Consume `n` characters and return them. */
  consumeN(n: number): string {
    const s = this.src.slice(this.pos, this.pos + n)
    this.pos += n
    return s
  }

  /** Match a literal string at current position; consume and return true if found. */
  match(s: string): boolean {
    if (this.src.startsWith(s, this.pos)) {
      this.pos += s.length
      return true
    }
    return false
  }

  /** Skip whitespace (space, tab, newline, carriage return). */
  skipSpaces(): void {
    while (this.pos < this.src.length && /[ \t\r\n]/.test(this.src[this.pos])) {
      this.pos++
    }
  }

  /** Skip a LaTeX comment from current `%` to end of line (inclusive). */
  skipComment(): void {
    // Caller should check peek() === '%' first
    while (this.pos < this.src.length && this.src[this.pos] !== '\n') {
      this.pos++
    }
    if (this.pos < this.src.length) this.pos++ // consume the newline
  }

  /** Skip whitespace and comments. */
  skipWhitespaceAndComments(): void {
    while (this.pos < this.src.length) {
      const ch = this.src[this.pos]
      if (ch === '%') {
        this.skipComment()
      } else if (/[ \t\r\n]/.test(ch)) {
        this.pos++
      } else {
        break
      }
    }
  }

  /**
   * Read a TeX control sequence starting at current `\`.
   * Returns the full token including the backslash, e.g. `\draw` or `\ ` or `\{`.
   * Assumes current char is `\`.
   */
  readControlSequence(): string {
    const start = this.pos
    this.pos++ // consume '\'
    if (this.pos >= this.src.length) return '\\'
    const ch = this.src[this.pos]
    if (/[a-zA-Z]/.test(ch)) {
      // Word control sequence: consume letters
      while (this.pos < this.src.length && /[a-zA-Z]/.test(this.src[this.pos])) {
        this.pos++
      }
      // Skip trailing spaces after word control sequences (TeX rule)
      // NOTE: we do NOT skip here because it changes the source string; callers
      // may or may not want to skip trailing space. Use skipSpaces() explicitly.
    } else {
      // Single-character control sequence: \{ \} \\ \, \; \! \: \" \' etc.
      this.pos++
    }
    return this.src.slice(start, this.pos)
  }

  /**
   * Read the next TeX token from current position.
   * Returns the token string. Does NOT skip leading whitespace.
   *
   * Token types:
   * - Control sequence: `\word` or `\X` for any single char X
   * - Single character: any other character
   */
  readToken(): string {
    if (this.done) return ''
    const ch = this.src[this.pos]
    if (ch === '\\') {
      return this.readControlSequence()
    }
    this.pos++
    return ch
  }

  /**
   * Read a brace-delimited group `{...}`, returning the inner content.
   * The outer braces are consumed but not returned.
   * Throws if the opening `{` is not found or the group is unbalanced.
   */
  readGroup(): string {
    this.skipWhitespaceAndComments()
    if (this.peek() !== '{') {
      throw new ScanError(`Expected '{' at position ${this.pos}, found '${this.peek()}'`)
    }
    this.pos++ // consume '{'
    const start = this.pos
    let depth = 1
    let mathMode = false

    while (this.pos < this.src.length) {
      const ch = this.src[this.pos]

      if (ch === '%') {
        this.skipComment()
        continue
      }

      if (ch === '\\') {
        // Skip over control sequence without recursing into readGroup
        this.readControlSequence()
        continue
      }

      if (ch === '$') {
        mathMode = !mathMode
        this.pos++
        continue
      }

      if (!mathMode) {
        if (ch === '{') {
          depth++
        } else if (ch === '}') {
          depth--
          if (depth === 0) {
            const content = this.src.slice(start, this.pos)
            this.pos++ // consume closing '}'
            return content
          }
        }
      }

      this.pos++
    }

    throw new ScanError(`Unbalanced '{' starting at position ${start - 1}`)
  }

  /**
   * Read a bracket-delimited option list `[...]`, returning the inner content.
   * The outer brackets are consumed but not returned.
   * Returns null if the next non-whitespace character is not `[`.
   */
  readOptions(): string | null {
    const saved = this.pos
    this.skipWhitespaceAndComments()
    if (this.peek() !== '[') {
      this.pos = saved
      return null
    }
    this.pos++ // consume '['
    const start = this.pos
    let depth = 0
    let braceDepth = 0
    let mathMode = false

    while (this.pos < this.src.length) {
      const ch = this.src[this.pos]

      if (ch === '%') {
        this.skipComment()
        continue
      }

      if (ch === '\\') {
        this.readControlSequence()
        continue
      }

      if (ch === '$') {
        mathMode = !mathMode
        this.pos++
        continue
      }

      if (!mathMode) {
        if (ch === '{') {
          braceDepth++
        } else if (ch === '}') {
          braceDepth--
        } else if (braceDepth === 0) {
          if (ch === '[') {
            depth++
          } else if (ch === ']') {
            if (depth === 0) {
              const content = this.src.slice(start, this.pos)
              this.pos++ // consume ']'
              return content
            }
            depth--
          }
        }
      }

      this.pos++
    }

    throw new ScanError(`Unbalanced '[' starting at position ${start - 1}`)
  }

  /**
   * Read content until `stopFn` returns true, respecting brace/bracket nesting
   * and math mode. The stopping character is NOT consumed.
   *
   * @param stopFn  Called with the scanner at each candidate stop position.
   *                Return true to stop reading.
   * @param stopAtDepthZero  If true, only call stopFn when nesting depth is 0.
   */
  readUntil(stopFn: (scanner: Scanner) => boolean, stopAtDepthZero = true): string {
    const start = this.pos
    let braceDepth = 0
    let mathMode = false
    let mathDoubleDollar = false

    while (this.pos < this.src.length) {
      const ch = this.src[this.pos]

      if (ch === '%') {
        this.skipComment()
        continue
      }

      if (ch === '\\') {
        const saved = this.pos
        this.readControlSequence()
        // Don't call stopFn for control sequences — we already advanced past them
        continue
      }

      // Math mode tracking
      if (!mathMode && this.peekStr(2) === '$$') {
        mathMode = true
        mathDoubleDollar = true
        this.pos += 2
        continue
      }
      if (mathMode && mathDoubleDollar && this.peekStr(2) === '$$') {
        mathMode = false
        mathDoubleDollar = false
        this.pos += 2
        continue
      }
      if (!mathDoubleDollar && ch === '$') {
        mathMode = !mathMode
        this.pos++
        continue
      }

      if (!mathMode) {
        if (ch === '{') braceDepth++
        else if (ch === '}') braceDepth--

        if (!stopAtDepthZero || braceDepth === 0) {
          if (stopFn(this)) {
            break
          }
        }

        if (ch === '{' || ch === '}') {
          this.pos++
          continue
        }
      }

      this.pos++
    }

    return this.src.slice(start, this.pos)
  }

  /**
   * Split the current scanner's remaining content into cells separated by
   * `&` (column separator) and `\\` (row separator), respecting brace nesting
   * and math mode.
   *
   * Used for parsing tikzcd environments and matrices.
   *
   * Returns a 2D array: rows[rowIndex][colIndex] = cell content string.
   */
  splitCells(): string[][] {
    const rows: string[][] = []
    let currentRow: string[] = []
    const start = this.pos
    let cellStart = this.pos
    let braceDepth = 0
    let mathMode = false
    let mathDoubleDollar = false

    const flushCell = () => {
      currentRow.push(this.src.slice(cellStart, this.pos).trim())
    }

    while (this.pos < this.src.length) {
      const ch = this.src[this.pos]

      if (ch === '%') {
        this.skipComment()
        continue
      }

      if (ch === '\\') {
        // Check for \\ (row separator) before parsing control sequence
        if (braceDepth === 0 && !mathMode && this.src[this.pos + 1] === '\\') {
          flushCell()
          currentRow.push(...[]) // already pushed
          rows.push(currentRow)
          currentRow = []
          this.pos += 2
          this.skipWhitespaceAndComments()
          cellStart = this.pos
          continue
        }
        this.readControlSequence()
        continue
      }

      // Math mode tracking
      if (!mathMode && this.peekStr(2) === '$$') {
        mathMode = true
        mathDoubleDollar = true
        this.pos += 2
        continue
      }
      if (mathMode && mathDoubleDollar && this.peekStr(2) === '$$') {
        mathMode = false
        mathDoubleDollar = false
        this.pos += 2
        continue
      }
      if (!mathDoubleDollar && ch === '$') {
        mathMode = !mathMode
        this.pos++
        continue
      }

      if (!mathMode) {
        if (ch === '{') {
          braceDepth++
        } else if (ch === '}') {
          if (braceDepth === 0) {
            // Hit the end of the enclosing group (e.g. end of tikzcd body)
            break
          }
          braceDepth--
        } else if (ch === '&' && braceDepth === 0) {
          flushCell()
          this.pos++
          this.skipWhitespaceAndComments()
          cellStart = this.pos
          continue
        }
      }

      this.pos++
    }

    // Flush last cell
    currentRow.push(this.src.slice(cellStart, this.pos).trim())
    rows.push(currentRow)

    return rows
  }

  /**
   * Read the body of a LaTeX environment — everything between
   * `\begin{envName}` (already consumed) and `\end{envName}`.
   * Returns the body content; `\end{envName}` is consumed.
   * Handles nested environments of the same name.
   */
  readEnvironmentBody(envName: string): string {
    const start = this.pos
    let depth = 1

    while (this.pos < this.src.length) {
      const ch = this.src[this.pos]

      if (ch === '%') {
        this.skipComment()
        continue
      }

      if (ch === '\\') {
        const tokenStart = this.pos
        const token = this.readControlSequence()

        if (token === '\\begin') {
          this.skipWhitespaceAndComments()
          if (this.peek() === '{') {
            const savedPos = this.pos
            const name = this.readGroup()
            if (name === envName) depth++
          }
          continue
        }

        if (token === '\\end') {
          this.skipWhitespaceAndComments()
          if (this.peek() === '{') {
            const savedPos = this.pos
            const name = this.readGroup()
            if (name === envName) {
              depth--
              if (depth === 0) {
                return this.src.slice(start, tokenStart)
              }
            }
          }
          continue
        }

        continue
      }

      this.pos++
    }

    throw new ScanError(`Unterminated environment '${envName}' starting at position ${start}`)
  }

  /** Clone scanner at current position (for backtracking). */
  save(): number {
    return this.pos
  }

  /** Restore scanner to a previously saved position. */
  restore(savedPos: number): void {
    this.pos = savedPos
  }

  /** Return remaining unconsumed source. */
  remaining(): string {
    return this.src.slice(this.pos)
  }
}

// ── Utility functions ─────────────────────────────────────────────────────────

/**
 * Strip LaTeX comments (% to end of line) from source text.
 * Handles escaped percent signs (\%).
 */
export function stripComments(src: string): string {
  const scanner = new Scanner(src)
  let result = ''

  while (!scanner.done) {
    const ch = scanner.peek()
    if (ch === '%') {
      scanner.skipComment()
      result += '\n' // preserve line structure
    } else if (ch === '\\' && scanner.peek(1) === '%') {
      // Escaped percent — keep it
      result += scanner.consumeN(2)
    } else {
      result += scanner.consume()
    }
  }

  return result
}

/**
 * Split a comma-separated list respecting brace nesting.
 * e.g. "draw=red, fill={blue!50}, above of=A" → ["draw=red", "fill={blue!50}", "above of=A"]
 */
export function splitCommaList(src: string): string[] {
  const result: string[] = []
  const scanner = new Scanner(src)
  let item = ''
  let braceDepth = 0

  while (!scanner.done) {
    const ch = scanner.peek()

    if (ch === '\\') {
      item += scanner.readControlSequence()
      continue
    }

    if (ch === '{') {
      braceDepth++
      item += scanner.consume()
      continue
    }

    if (ch === '}') {
      braceDepth--
      item += scanner.consume()
      continue
    }

    if (ch === ',' && braceDepth === 0) {
      result.push(item.trim())
      item = ''
      scanner.consume()
      continue
    }

    item += scanner.consume()
  }

  const last = item.trim()
  if (last) result.push(last)

  return result
}

/**
 * Parse a single key=value option string into its key and value parts.
 * Handles cases:
 * - "draw"           → { key: "draw" }
 * - "draw=red"       → { key: "draw", value: "red" }
 * - "fill={blue!50}" → { key: "fill", value: "blue!50" } (braces stripped)
 * - "->"             → { key: "->" }
 * - "<->"            → { key: "<->" }
 */
export function parseKeyValue(item: string): { key: string; value?: string } {
  // Arrow shorthand like ->, <-, <->: no = sign, treat whole thing as key
  if (/^[<>-]+$/.test(item.trim())) {
    return { key: item.trim() }
  }

  const eqIdx = findTopLevelEquals(item)
  if (eqIdx === -1) {
    return { key: item.trim() }
  }

  const key = item.slice(0, eqIdx).trim()
  let value = item.slice(eqIdx + 1).trim()

  // Strip outer braces from value if present
  if (value.startsWith('{') && value.endsWith('}')) {
    value = value.slice(1, -1)
  }

  return { key, value: value || undefined }
}

/** Find the index of the first `=` sign not inside braces or brackets. */
function findTopLevelEquals(s: string): number {
  let depth = 0
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === '{' || ch === '[') depth++
    else if (ch === '}' || ch === ']') depth--
    else if (ch === '=' && depth === 0) return i
  }
  return -1
}

// ── Error type ────────────────────────────────────────────────────────────────

export class ScanError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ScanError'
  }
}
