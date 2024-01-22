import { TikzInline, TikzPicture, TikzRoot } from '../../parser/TikzRoot'
import { ElementInterface } from '../Element' // Added missing import
import { Context } from '../Context'
import { EGenerators } from '../Generator'
import { TikzInlineElement, TikzPictureElement } from './TikzElement'

export class RootElementSVG implements ElementInterface {
  _ast: TikzRoot
  _ctx: Context
  _inlines?: TikzInlineElement
  _displays?: TikzPictureElement
  constructor(ctx: Context, root: TikzRoot) {
    this._ast = root as TikzRoot
    this._ctx = ctx
    this._ctx.generator = EGenerators.svg
    for (let pic of this._ast.children()) {
      if (pic instanceof TikzInline) this._inlines = new TikzInlineElement(this._ctx, pic)
      else if (pic instanceof TikzPicture) this._displays = new TikzPictureElement(this._ctx, pic)
      break
    }
  }
  render(): HTMLElement[] {
    if (this._inlines) return this._inlines.render()
    else if (this._displays) return this._displays.render()
    else return []
  }
}
