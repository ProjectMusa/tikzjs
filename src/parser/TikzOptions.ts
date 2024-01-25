import { AstNode, AstLocation } from './TikzAST'
export class TikzOption extends AstNode {
  _option_key: string
  _option_override: string
  constructor(location: AstLocation, option_key: string, option_override: string) {
    super(location, [])
    this._type = this.constructor.name
    this._option_key = option_key
    this._option_override = option_override
  }
}
