import { AstNode, AstLocation } from './TikzAST'
export class TikzLiteral extends AstNode {
  _literal: string | number
  constructor(location: AstLocation, literal: string | number) {
    super(location, [])
    this._type = this.constructor.name
    this._literal = literal
    console.log(`literal:${this._literal}`)
  }
}
