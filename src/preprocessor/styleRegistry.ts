/**
 * Style registry: accumulates \tikzset and \tikzstyle definitions.
 *
 * In TikZ, styles are defined with:
 *   \tikzset{my style/.style={draw=red, fill=blue}}
 *   \tikzstyle{my style}=[draw=red, fill=blue]
 *
 * When a style is referenced in an option list like [my style, thick],
 * it is expanded by the styleResolver before the path is constructed.
 */

import { StyleDefinition, RawOption } from '../ir/types.js'
import { splitCommaList, parseKeyValue, Scanner } from './scanner.js'

// ── Built-in TikZ styles ──────────────────────────────────────────────────────

/** Pre-defined TikZ styles that are always available (from the pgf library). */
const BUILTIN_STYLES: Array<{ name: string; rawOptions: RawOption[] }> = [
  // \tikzset{help lines/.style={color=black!25,very thin}}
  { name: 'help lines', rawOptions: [{ key: 'color', value: 'black!25' }, { key: 'very thin' }] },
]

export class StyleRegistry {
  private _styles: Map<string, StyleDefinition> = new Map()

  constructor() {
    for (const s of BUILTIN_STYLES) {
      this._styles.set(s.name, { name: s.name, rawOptions: s.rawOptions })
    }
  }

  /** Register a style definition. Overwrites any existing definition with the same name. */
  define(name: string, rawOptions: RawOption[], base?: string): void {
    this._styles.set(name, { name, rawOptions, base })
  }

  /** Look up a style by name. Returns undefined if not found. */
  get(name: string): StyleDefinition | undefined {
    return this._styles.get(name)
  }

  /** Check if a name is a registered style. */
  has(name: string): boolean {
    return this._styles.has(name)
  }

  /** Return all registered styles as a plain Record for serialization. */
  toRecord(): Record<string, StyleDefinition> {
    const result: Record<string, StyleDefinition> = {}
    for (const [name, def] of this._styles) {
      result[name] = def
    }
    return result
  }

  /** Merge another registry into this one (used for scope inheritance). */
  merge(other: StyleRegistry): void {
    for (const [name, def] of other._styles) {
      this._styles.set(name, def)
    }
  }

  clone(): StyleRegistry {
    const copy = new StyleRegistry()
    copy.merge(this)
    return copy
  }
}

/**
 * Parse a \tikzset{...} body and register all style definitions found.
 *
 * The body can contain:
 *   name/.style={key=value, ...}
 *   name/.append style={key=value, ...}
 *   name/.default={value}
 *   key=value              (global option — stored as '.global' internally)
 *
 * This function handles top-level comma-separated entries in the body.
 */
export function parseTikzset(body: string, registry: StyleRegistry): void {
  const entries = splitCommaList(body)

  for (const entry of entries) {
    if (!entry.trim()) continue

    // Look for suffix: name/.style={...}, name/.append style={...}
    const styleSuffixMatch = entry.match(/^(.+?)\/(\.(?:style|append style|default))\s*=\s*(.*)$/s)
    if (styleSuffixMatch) {
      const name = styleSuffixMatch[1].trim()
      const suffix = styleSuffixMatch[2].trim()
      let body = styleSuffixMatch[3].trim()

      // Strip surrounding braces if present
      if (body.startsWith('{') && body.endsWith('}')) {
        body = body.slice(1, -1)
      }
      // Strip surrounding brackets if present
      if (body.startsWith('[') && body.endsWith(']')) {
        body = body.slice(1, -1)
      }

      const rawOptions = parseOptionString(body)
      const base = suffix === '.append style' ? name : undefined
      registry.define(name, rawOptions, base)
      continue
    }

    // Plain key=value — global TikZ option, store for potential future use
    // (e.g. \tikzset{every node/.style={...}} is a special case handled above)
    const { key, value } = parseKeyValue(entry)
    if (key && value !== undefined) {
      // Try to parse as style reference
      const rawOptions = parseOptionString(value)
      registry.define(key, rawOptions)
    }
  }
}

/**
 * Parse a \tikzstyle{name}=[...] definition.
 */
export function parseTikzstyle(name: string, optionBody: string, registry: StyleRegistry): void {
  const rawOptions = parseOptionString(optionBody)
  registry.define(name, rawOptions)
}

/**
 * Parse a comma-separated option string into RawOption array.
 * e.g. "draw=red, fill=blue, rounded corners=2pt"
 */
export function parseOptionString(src: string): RawOption[] {
  const items = splitCommaList(src)
  return items
    .map((item) => {
      const { key, value } = parseKeyValue(item)
      if (!key) return null
      return { key, value } as RawOption
    })
    .filter((x): x is RawOption => x !== null)
}
