import { ElementInterface } from '../Element'
import { Context } from '../Context'
import { TikzCoordinate } from '../../parser/TikzPathOperations'
import { AbsoluteCoordinate, toAbsoluteCoordinate } from '../utils'

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

const MathJaxTex = new TeX({
  packages: AllPackages,
  inlineMath: [
    ['$', '$'],
    ['\\(', '\\)'],
  ],
})
const MathJaxSVG = new SVG({ fontCache: 'none' })
const MathJaxDoc = mathjax.document('', { InputJax: MathJaxTex, OutputJax: MathJaxSVG })

export class TikzNodeElement implements ElementInterface {
  _ast?: TikzCoordinate
  _ctx: Context
  _alias?: string
  _absolute_coordinate?: AbsoluteCoordinate
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
      let svg = document.createElement('svg')
      const node = MathJaxDoc.convert(this._latex || '', {
        display: false,
        em: 16,
        ex: 8,
        containerWidth: 500,
      })
      svg.innerHTML = adaptor.innerHTML(node)

      console.log(svg.innerHTML)
      return [svg]
    } else return []
  }
}
