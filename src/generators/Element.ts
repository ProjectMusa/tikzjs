import { AstNode } from '../parser/TikzAST'
import { Context } from './Context'

export interface ElementInterface<DeriveNode extends AstNode> {
  render(n: DeriveNode, ctx?: Context): Node[]
}
