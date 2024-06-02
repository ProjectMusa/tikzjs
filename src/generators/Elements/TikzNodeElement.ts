import { ElementInterface } from '../Element'
import { Context } from '../Context'
import { TikzCoordinate } from '../../parser/TikzPathOperations'
import {
  AbsoluteCoordinate,
  BoundingBox,
  GeometryInterface,
  parseJaxLength,
  toAbsoluteCoordinate,
  utils_constants,
} from '../utils'
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
    formatError: (jax: any, err: any) => {
      throw Error('TeX error: ' + err.message)
    },
  }),
  OutputJax: new SVG({ fontCache: 'none' }),
})

export enum EShapeType {
  rectangle = 'rectangle',
  circle = 'circle',
  ellipse = 'ellipse',
}

export class TikzNodeElement implements ElementInterface, GeometryInterface {
  _ast?: TikzCoordinate
  _ctx: Context
  _alias?: string
  _center?: AbsoluteCoordinate
  _latex?: string
  _mathJaxSvg?: string
  _height?: number
  _width?: number
  _padding: number = 8
  _rotate: number = 0
  _vertical_align?: number
  _shape: EShapeType = EShapeType.rectangle
  _align_vector: AbsoluteCoordinate = { x: 0, y: -1 }
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
    if (!this._center || !this._width || !this._height) return undefined
    if (strAnchor === 'center') return this._center
    else if (strAnchor === 'west')
      return {
        x: this._center.x - (this._width * 0.5 + this._padding) * Math.cos((this._rotate / 180.0) * Math.PI),
        y: this._center.y - (this._width * 0.5 + this._padding) * Math.sin((this._rotate / 180) * Math.PI),
      }
    else if (strAnchor === 'east')
      return {
        x: this._center.x + (this._width * 0.5 + this._padding) * Math.cos((this._rotate / 180) * Math.PI),
        y: this._center.y + (this._width * 0.5 + this._padding) * Math.sin((this._rotate / 180) * Math.PI),
      }
    else if (strAnchor === 'north')
      return {
        x: this._center.x + (this._height * 0.5 + this._padding) * Math.sin((this._rotate / 180) * Math.PI),
        y: this._center.y - (this._height * 0.5 + this._padding) * Math.cos((this._rotate / 180) * Math.PI),
      }
    else if (strAnchor === 'south')
      return {
        x: this._center.x - (this._height * 0.5 + this._padding) * Math.sin((this._rotate / 180) * Math.PI),
        y: this._center.y + (this._height * 0.5 + this._padding) * Math.cos((this._rotate / 180) * Math.PI),
      }
  }

  setAlias(alias?: string) {
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
    if (normalVec.y < 0) this._align_vector = normalVec
    else this._align_vector = { x: -normalVec.x, y: -normalVec.y }
    // TODO if not sloped ignore rotate
    this._rotate = 90 - (Math.acos(this._align_vector.x) / Math.PI) * 180
    return true
  }

  computeBoundingBox(): BoundingBox | undefined {
    if (this._center && this._width && this._height) {
      let box: BoundingBox = {
        lowerLeft: {
          x: this._center.x - 0.5 * this._width,
          y: this._center.y - 0.5 * this._height,
        },
        upperRight: {
          x: this._center.x + 0.5 * this._width,
          y: this._center.y + 0.5 * this._height,
        },
      }
      return box
    }
    return undefined
  }
  getAttachPosition(): number {
    return 0.5
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
