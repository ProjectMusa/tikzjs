/**
 * Style resolver: merges the style inheritance chain.
 *
 * In TikZ, styles are resolved in this precedence order (later overrides earlier):
 *   1. Global \tikzset defaults
 *   2. \begin{scope}[...] options (outermost scope first)
 *   3. \path[...] / \draw[...] / etc. options
 *   4. Local inline options on the operation
 *
 * When a named style is referenced (e.g. [my style, thick]), it is expanded
 * by looking up the style in the registry and merging its options in.
 */

import { ResolvedStyle, RawOption } from '../ir/types.js'
import { StyleRegistry } from '../preprocessor/styleRegistry.js'
import { resolveOptions } from './optionParser.js'

export type StyleChain = ResolvedStyle[]

/**
 * Resolve a complete style chain into a single ResolvedStyle.
 * Later entries in the chain take precedence.
 */
export function resolveChain(chain: StyleChain): ResolvedStyle {
  return chain.reduce((acc, style) => mergeStyles(acc, style), {})
}

/**
 * Merge two ResolvedStyle objects. Properties in `override` take precedence.
 * The `extra` records are merged (not replaced).
 */
export function mergeStyles(base: ResolvedStyle, override: ResolvedStyle): ResolvedStyle {
  const result: ResolvedStyle = { ...base, ...override }
  if (base.extra || override.extra) {
    result.extra = { ...(base.extra ?? {}), ...(override.extra ?? {}) }
  }
  return result
}

/**
 * Resolve raw options against the style registry, returning a ResolvedStyle.
 * Named style references are expanded recursively (up to a depth limit to
 * prevent infinite loops from circular style definitions).
 */
export function resolveRawOptions(
  rawOptions: RawOption[],
  registry: StyleRegistry,
  inherited?: ResolvedStyle,
  depth = 0
): ResolvedStyle {
  if (depth > 10) return inherited ?? {}
  return resolveOptions(rawOptions, registry, inherited)
}

/**
 * A scope stack that tracks the current style inheritance chain.
 * Pushed when entering a scope, popped when leaving.
 */
export class ScopeStack {
  private _stack: ResolvedStyle[] = [{}]
  private _registry: StyleRegistry

  constructor(registry: StyleRegistry, globalStyle?: ResolvedStyle) {
    this._registry = registry
    if (globalStyle) this._stack[0] = globalStyle
  }

  /** Current inherited style (accumulated from all scopes). */
  get current(): ResolvedStyle {
    return resolveChain(this._stack)
  }

  /** Push a new scope with the given raw options. */
  push(rawOptions: RawOption[]): void {
    const scopeStyle = resolveRawOptions(rawOptions, this._registry)
    this._stack.push(scopeStyle)
  }

  /** Pop the most recently pushed scope. */
  pop(): void {
    if (this._stack.length > 1) {
      this._stack.pop()
    }
  }

  /**
   * Resolve a path's raw options against the current scope stack.
   * Returns the fully resolved style for the path.
   */
  resolvePathStyle(rawOptions: RawOption[]): ResolvedStyle {
    const inherited = this.current
    return resolveRawOptions(rawOptions, this._registry, inherited)
  }

  clone(): ScopeStack {
    const copy = new ScopeStack(this._registry)
    copy._stack = [...this._stack]
    return copy
  }
}

/**
 * Determine the anchor implied by placement options (above, below, left, right).
 * When [above] is set, the node's south anchor sits at the given point.
 */
export function anchorFromPlacement(rawOptions: RawOption[]): string {
  for (const opt of rawOptions) {
    switch (opt.key) {
      case 'above': return 'south'
      case 'below': return 'north'
      case 'left':  return 'east'
      case 'right': return 'west'
      case 'above left':  return 'south east'
      case 'above right': return 'south west'
      case 'below left':  return 'north east'
      case 'below right': return 'north west'
      case 'anchor': return typeof opt.value === 'string' ? opt.value : 'center'
    }
  }
  return 'center'
}
