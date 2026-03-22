/**
 * Emit RawOption[] as a TikZ option string: "[key=value, key2, ...]"
 */

import type { RawOption } from '../../ir/types.js'

/**
 * Emit a single option value. If the value is a nested RawOption[],
 * emit it as {key=value, ...}.
 */
function emitValue(value: string | RawOption[]): string {
  if (typeof value === 'string') return value
  // Nested options: decoration={snake, amplitude=2mm}
  const inner = value.map(emitSingleOption).join(', ')
  return `{${inner}}`
}

function emitSingleOption(opt: RawOption): string {
  if (opt.value === undefined || opt.value === '') return opt.key
  return `${opt.key}=${emitValue(opt.value)}`
}

/**
 * Emit an option list as "[key=value, ...]".
 * Returns empty string if no options.
 */
export function emitOptions(opts: RawOption[]): string {
  if (!opts || opts.length === 0) return ''
  const inner = opts.map(emitSingleOption).join(', ')
  return `[${inner}]`
}
