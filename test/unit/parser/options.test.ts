/**
 * Unit tests for option parsing and resolution.
 */

import { parseRawOptions, resolveOptions, resolveColor, parseDimension } from '../../../src/parser/optionParser'
import { StyleRegistry } from '../../../src/preprocessor/styleRegistry'

describe('parseRawOptions', () => {
  test('parses empty string', () => {
    expect(parseRawOptions('')).toEqual([])
  })

  test('parses boolean option', () => {
    const opts = parseRawOptions('draw')
    expect(opts).toContainEqual(expect.objectContaining({ key: 'draw' }))
  })

  test('parses key=value option', () => {
    const opts = parseRawOptions('draw=red')
    expect(opts).toContainEqual(expect.objectContaining({ key: 'draw', value: 'red' }))
  })

  test('parses multiple options', () => {
    const opts = parseRawOptions('draw=red, fill=blue, thick')
    expect(opts).toHaveLength(3)
    expect(opts[0]).toMatchObject({ key: 'draw', value: 'red' })
    expect(opts[1]).toMatchObject({ key: 'fill', value: 'blue' })
    expect(opts[2]).toMatchObject({ key: 'thick' })
  })

  test('parses arrow options', () => {
    const opts = parseRawOptions('->')
    expect(opts).toContainEqual(expect.objectContaining({ key: '->' }))
  })
})

describe('resolveOptions', () => {
  const registry = new StyleRegistry()

  test('resolves draw option to color', () => {
    const style = resolveOptions(parseRawOptions('draw=red'), registry)
    expect(style.draw).toBe('#FF0000')
  })

  test('resolves fill option', () => {
    const style = resolveOptions(parseRawOptions('fill=blue'), registry)
    expect(style.fill).toBe('#0000FF')
  })

  test('resolves thick', () => {
    const style = resolveOptions(parseRawOptions('thick'), registry)
    expect(style.drawWidth).toBeGreaterThan(0)
  })

  test('resolves arrow options', () => {
    const style = resolveOptions(parseRawOptions('->'), registry)
    expect(style.arrowEnd).toBeDefined()
    expect(style.arrowEnd?.kind).toBe('default')
  })

  test('resolves bend left', () => {
    const style = resolveOptions(parseRawOptions('bend left=30'), registry)
    expect(style.bend).toBe(30)
    expect(style.bendDirection).toBe('left')
  })

  test('resolves named style from registry', () => {
    const reg = new StyleRegistry()
    reg.define('myStyle', [{ key: 'draw', value: 'red' }])
    const style = resolveOptions([{ key: 'myStyle' }], reg)
    expect(style.draw).toBe('#FF0000')
  })

  test('inherits from base style', () => {
    const style = resolveOptions(
      parseRawOptions('fill=blue'),
      registry,
      { draw: '#000000' }
    )
    expect(style.draw).toBe('#000000')  // inherited
    expect(style.fill).toBe('#0000FF')  // overridden
  })
})

describe('resolveColor', () => {
  test('resolves named colors', () => {
    expect(resolveColor('red')).toBe('#FF0000')
    expect(resolveColor('blue')).toBe('#0000FF')
    expect(resolveColor('black')).toBe('#000000')
  })

  test('passes through hex colors', () => {
    expect(resolveColor('#AABBCC')).toBe('#AABBCC')
  })

  test('resolves color mix', () => {
    const result = resolveColor('red!50!blue')
    // Should be halfway between red and blue
    expect(result).toMatch(/^#/)
  })

  test('resolves 50% tint (mixed with white)', () => {
    const result = resolveColor('red!50')
    expect(result).toMatch(/^#/)
    // Should be lighter than pure red
    expect(result).not.toBe('#FF0000')
  })
})

describe('parseDimension', () => {
  test('parses pt', () => {
    expect(parseDimension('10pt')).toBeCloseTo(10)
  })

  test('parses cm', () => {
    expect(parseDimension('1cm')).toBeCloseTo(28.4528)
  })

  test('parses mm', () => {
    expect(parseDimension('10mm')).toBeCloseTo(28.4528)
  })

  test('parses decimal', () => {
    expect(parseDimension('2.5cm')).toBeCloseTo(71.13)
  })

  test('defaults to pt for bare number', () => {
    expect(parseDimension('10')).toBeCloseTo(10)
  })
})
