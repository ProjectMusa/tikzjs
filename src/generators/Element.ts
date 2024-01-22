import { AstNode } from '../parser/TikzAST'
import { TikzRoot } from '../parser/TikzRoot'
import { Context } from './Context'

export interface ElementInterface {
  render(): HTMLElement[]
}

// export interface ElementConstructorInterface<DeriveNode extends AstNode> {
//   new (n: DeriveNode, ctx: Context): ElementInterface
// }
