import { TikzInline, TikzPicture, TikzRoot } from '../../parser/TikzRoot'
import { ElementInterface } from '../Element'
import { Context } from '../Context'
import { TikzPathElement } from './TikzPathElement'
import { EGenerators } from '../Generator'

export class TikzInlineElement implements ElementInterface {
  _ast: TikzInline
  _ctx: Context
  _contents: TikzPathElement[]
  constructor(ctx: Context, tikz: TikzInline) {
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
      svg.classList.add('inline')
      svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
      // TOOD compute global geometry
      // svg.style.width = width + 'em'
      // svg.style.height = height + 'em'
      // svg.setAttribute('viewBox', `0 0 ${width} ${height}`)
      // svg.setAttribute('version', '1.1')
      for (let pathElement of this._contents) {
        svg.append(...pathElement.render())
      }
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
