/**
 * Unit tests for macro expansion.
 */

import { MacroTable, collectAndStripMacros, expandMacros } from '../../../src/preprocessor/macroExpander'
import { expandAllForeach, parseForeachList } from '../../../src/preprocessor/foreachExpander'

describe('collectAndStripMacros', () => {
  test('collects \\def macro', () => {
    const table = new MacroTable()
    const result = collectAndStripMacros('\\def\\myfunc{hello}', table)
    expect(table.has('myfunc')).toBe(true)
    expect(result.trim()).toBe('')
  })

  test('collects \\newcommand macro', () => {
    const table = new MacroTable()
    collectAndStripMacros('\\newcommand{\\greet}[1]{Hello, #1!}', table)
    expect(table.has('greet')).toBe(true)
    const macro = table.get('greet')!
    expect(macro.argCount).toBe(1)
    expect(macro.body).toBe('Hello, #1!')
  })

  test('leaves non-macro content intact', () => {
    const table = new MacroTable()
    const result = collectAndStripMacros('\\draw (0,0) -- (1,1);', table)
    expect(result).toBe('\\draw (0,0) -- (1,1);')
  })
})

describe('expandMacros', () => {
  test('expands a zero-arg macro', () => {
    const table = new MacroTable()
    table.define({ name: 'foo', argCount: 0, body: 'bar' })
    expect(expandMacros('\\foo', table)).toBe('bar')
  })

  test('expands a one-arg macro', () => {
    const table = new MacroTable()
    table.define({ name: 'greet', argCount: 1, body: 'Hello, #1!' })
    expect(expandMacros('\\greet{World}', table)).toBe('Hello, World!')
  })

  test('does not expand unknown macros', () => {
    const table = new MacroTable()
    expect(expandMacros('\\draw', table)).toBe('\\draw')
  })
})

describe('expandAllForeach', () => {
  test('expands simple foreach', () => {
    const result = expandAllForeach('\\foreach \\x in {a,b,c}{\\x}')
    expect(result).toContain('a')
    expect(result).toContain('b')
    expect(result).toContain('c')
  })

  test('expands numeric range with ellipsis', () => {
    const result = expandAllForeach('\\foreach \\x in {1,...,4}{X}')
    // Should contain 4 repetitions
    const matches = result.match(/X/g)
    expect(matches?.length).toBe(4)
  })

  test('expands multi-variable foreach', () => {
    const result = expandAllForeach('\\foreach \\x/\\y in {a/1,b/2}{\\x=\\y}')
    expect(result).toContain('a=1')
    expect(result).toContain('b=2')
  })
})
