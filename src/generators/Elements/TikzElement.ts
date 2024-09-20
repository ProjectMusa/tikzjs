import { TikzInline, TikzPicture, TikzRoot } from '../../parser/TikzRoot'
import { ElementInterface } from '../Element'
import { Context } from '../Context'
import { TikzPathElement } from './TikzPathElement'
import { EGenerators } from '../Generator'
import { GeometryInterface, BoundingBox, assembleBoundingBox } from '../utils'
import { defaultArrowMarker, defaultReversedArrowMarker } from './TikzMarkerElement'

export class TikzInlineElement implements ElementInterface, GeometryInterface {
  _ast: TikzInline
  _ctx: Context
  _contents: TikzPathElement[]
  _padding: number = 20
  constructor(ctx: Context, tikz: TikzInline) {
    this._ast = tikz
    this._ctx = ctx
    this._ctx.registerMarker(defaultArrowMarker)
    this._ctx.registerMarker(defaultReversedArrowMarker)
    this._contents = []
    for (let path of this._ast.contents()) {
      this._contents.push(new TikzPathElement(this._ctx, path))
    }
  }

  computeBoundingBox(): BoundingBox | undefined {
    return assembleBoundingBox([...this._contents, ...this._ctx._nodes])
  }

  render(): HTMLElement[] {
    let result: HTMLElement[] = []
    if (this._ctx.generator === EGenerators.svg) {
      let svg = document.createElement('svg')
      svg.classList.add('inline')
      svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
      // TOOD compute global geometry
      // svg.style.width = width + 'em'
      // svg.style.height = height + 'em'
      // svg.setAttribute('viewBox', `0 0 ${width} ${height}`)
      // svg.setAttribute('version', '1.1')
      if (!this._ctx._uid_marker_map.empty) {
        let defs = document.createElement('defs')
        for (let uid in this._ctx._uid_marker_map) {
          let markerElememt = this._ctx._uid_marker_map[uid]
          defs.append(...markerElememt.render())
        }
        svg.append(defs)
      }

      for (let pathElement of this._contents) {
        svg.append(...pathElement.render())
      }
      for (let nodeElement of this._ctx._nodes) {
        svg.append(...nodeElement.render())
      }
      result.push(svg)
      let box = this.computeBoundingBox()
      if (box) {
        svg.setAttribute(
          'viewBox',
          `${box.lowerLeft.x - this._padding} ${box.lowerLeft.y - this._padding} ${box.upperRight.x - box.lowerLeft.x + 2 * this._padding} ${box.upperRight.y - box.lowerLeft.y + 2 * this._padding}`,
        )
      } else {
        svg.setAttribute('viewBox', '-100 -100 200 200')
      }
    } else if (this._ctx.generator === EGenerators.html) {
      // TODO for html add overlay path svg
      // add node katex
      // add css
      // add katex
    }
    return result
  }
}

export class TikzPictureElement implements ElementInterface {
  _ast: TikzPicture
  _ctx: Context
  _contents: TikzPathElement[]
  constructor(ctx: Context, tikz: TikzPicture) {
    this._ast = tikz
    this._ctx = ctx
    this._contents = []
    for (let path of this._ast.contents()) {
      this._contents.push(new TikzPathElement(this._ctx, path))
    }
  }
  render(): HTMLElement[] {
    let result: HTMLElement[] = []
    if (this._ctx.generator === EGenerators.svg) {
      let svg = document.createElement('svg')
      result.push(svg)
    } else if (this._ctx.generator === EGenerators.html) {
      // TODO for html add overlay path svg
      // add node katex
      // add css
      // add katex
    }
    return result
  }
}
