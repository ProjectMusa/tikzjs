import { TikzRoot } from '../../parser/TikzRoot'
import { ElementInterface } from '../Element'
import { Context } from '../Context'

export class RootElementSVG implements ElementInterface<TikzRoot> {
  render(root: TikzRoot, ctx: Context): HTMLElement[] {
    if (root.children().length == 0) return []
    let svg = document.createElement('svg')
    svg.classList.add('overlay')
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    svg.setAttribute('version', '1.1')
    return [svg]
  }
}
