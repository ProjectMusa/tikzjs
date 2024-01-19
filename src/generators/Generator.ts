import { AstNode } from '../parser/TikzAST'
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
    ctx.generator = EGenerators.svg
    return new RootElementSVG().render(root, ctx)
  }
}

export const generator_svg = new GeneratorSVG()
