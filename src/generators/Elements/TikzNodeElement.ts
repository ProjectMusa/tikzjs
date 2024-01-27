import { ElementInterface } from '../Element'
import { Context } from '../Context'
import { TikzCoordinate } from '../../parser/TikzPathOperations'
import { AbsoluteCoordinate, parseJaxLength, toAbsoluteCoordinate, utils_constants } from '../utils'

//
//  Load all the needed components
//
const { mathjax } = require('mathjax-full/js/mathjax.js')
const { TeX } = require('mathjax-full/js/input/tex.js')
const { SVG } = require('mathjax-full/js/output/svg.js')
const { jsdomAdaptor } = require('mathjax-full/js/adaptors/jsdomAdaptor.js')
const { RegisterHTMLHandler } = require('mathjax-full/js/handlers/html.js')
const { AllPackages } = require('mathjax-full/js/input/tex/AllPackages.js')
const { JSDOM } = require('jsdom')
const adaptor = jsdomAdaptor(JSDOM)
RegisterHTMLHandler(adaptor)

const MathJaxDoc = mathjax.document('', {
  InputJax: new TeX({
    packages: AllPackages,
    inlineMath: [
      ['$', '$'],
      ['\\(', '\\)'],
    ],
  }),
  OutputJax: new SVG({ fontCache: 'none' }),
})

export class TikzNodeElement implements ElementInterface {
  _ast?: TikzCoordinate
  _ctx: Context
  _alias?: string
  _absolute_coordinate?: AbsoluteCoordinate = { x: 38, y: -38 }
  _latex?: string

  constructor(ctx: Context, coordinate?: TikzCoordinate, baseC?: AbsoluteCoordinate) {
    this._ctx = ctx
    this._ast = coordinate
    if (coordinate && baseC) {
      this._absolute_coordinate = toAbsoluteCoordinate(coordinate, baseC)
    }
  }

  setAlias(alias: string) {
    this._alias = alias
  }
  setLaTeX(latex?: string) {
    this._latex = latex
  }

  setOffsets(offset: AbsoluteCoordinate) {
    this._absolute_coordinate = offset
  }

  absoluteCoordinate(): AbsoluteCoordinate | undefined {
    return this._absolute_coordinate
  }

  render(): HTMLElement[] {
    // no boundary if not option draw
    // no text if no latex
    if (this._latex) {
      let group = document.createElement('g')
      const node = MathJaxDoc.convert(this._latex || '', {
        display: false,
        em: utils_constants.em2px,
        ex: utils_constants.ex2px,
        containerWidth: 600,
      })
      group.innerHTML = adaptor.innerHTML(node)
      let svg = group.firstElementChild
      if (svg !== null) {
        let w = parseJaxLength(svg.getAttribute('width')?.toString())
        let h = parseJaxLength(svg.getAttribute('height')?.toString())
        let style = svg.getAttribute('style')
        let v = parseJaxLength(style?.split(':')[1].slice(0, -1))
        svg.setAttribute('width', `${w}`)
        svg.setAttribute('height', `${h}`)
        svg.removeAttribute('style')
        if (this._absolute_coordinate)
          group.setAttribute(
            'transform',
            `translate(${this._absolute_coordinate.x - w / 2} ${this._absolute_coordinate.y - h - v + utils_constants.mathJaxBaseShift})`,
          )
      }
      return [group]
    } else return []
  }
}
