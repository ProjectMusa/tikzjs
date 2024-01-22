import { TikzRoot } from '../parser/TikzRoot'
import { Context } from './Context'
import { RootElementSVG } from './Elements/RootElementSVG'

export enum EGenerators {
  svg,
  html,
}

class GeneratorSVG {
  generate(root: TikzRoot) {
    let ctx = new Context()
    let rootElement = new RootElementSVG(ctx, root)
    return rootElement.render()
  }
}

export const generator_svg = new GeneratorSVG()
