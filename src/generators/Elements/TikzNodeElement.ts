import { ElementInterface } from '../Element'
import { Context } from '../Context'
import { TikzCoordinate } from '../../parser/TikzPathOperations'
import { AbsoluteCoordinate, GeometryInterface, parseJaxLength, toAbsoluteCoordinate, utils_constants } from '../utils'
import { TikzOption } from '../../parser/TikzOptions'

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
  _center?: AbsoluteCoordinate
  _latex?: string
  _mathJaxSvg?: string
  _height?: number
  _width?: number
  _rotate?: number = 0
  _vertical_align?: number
  _options: TikzOption[]

  constructor(ctx: Context, coordinate?: TikzCoordinate, baseC?: AbsoluteCoordinate) {
    this._ctx = ctx
    this._ast = coordinate
    this._options = []
    if (coordinate && baseC) {
      this._center = toAbsoluteCoordinate(coordinate, baseC)
    }
  }

  getAnchor(strAnchor: string): AbsoluteCoordinate | undefined {
    return this._center
  }

  setAlias(alias: string) {
    this._alias = alias
  }

  setLaTeX(latex?: string) {
    this._latex = latex
    let group = document.createElement('g')
    const node = MathJaxDoc.convert(this._latex || '', {
      display: false,
      em: utils_constants.em2px,
      ex: utils_constants.ex2px,
      containerWidth: utils_constants.mathJaxContainerWidth,
    })
    group.innerHTML = adaptor.innerHTML(node)
    let svg = group.firstElementChild
    if (svg !== null) {
      this._width = parseJaxLength(svg.getAttribute('width')?.toString())
      this._height = parseJaxLength(svg.getAttribute('height')?.toString())
      let style = svg.getAttribute('style')
      this._vertical_align = parseJaxLength(style?.split(':')[1].slice(0, -1))
      svg.setAttribute('width', `${this._width}`)
      svg.setAttribute('height', `${this._height}`)
      svg.removeAttribute('style')
      this._mathJaxSvg = group.innerHTML
    }
  }

  absoluteCoordinate(): AbsoluteCoordinate | undefined {
    return this._center
  }

  tryPoseAgainst(absC: AbsoluteCoordinate, normalVec: AbsoluteCoordinate): boolean {
    // if no options like above/below is set
    this._center = absC
    // TODO if not sloped ignore rotate
    if (normalVec.y < 0) this._rotate = -180 + (Math.acos(normalVec.y) / Math.PI) * 180
    else this._rotate = -(Math.acos(normalVec.y) / Math.PI) * 180
    console.log(this._rotate, normalVec.x, normalVec.y)
    return true
  }

  render(): HTMLElement[] {
    // no boundary if not option draw
    // no text if no latex
    if (this._mathJaxSvg) {
      let group = document.createElement('g')
      group.innerHTML = this._mathJaxSvg

      if (this._center && this._width && this._height && this._vertical_align !== undefined)
        group.setAttribute(
          'transform',
          `rotate(${this._rotate}, ${this._center.x}, ${this._center.y}) translate(${this._center.x - this._width / 2} ${this._center.y - this._height - this._vertical_align + utils_constants.mathJaxBaseShift})`,
        )

      return [group]
    } else return []
  }
}
