import { AstNode, AstLocation } from './TikzAST'
import { TikzOption } from './TikzOptions'
import { TikzPathOperation } from './TikzPathOperations'
export class TikzPath extends AstNode {
  _start: string
  _option_list: TikzOption[]
  _operation_list: TikzPathOperation[]
  constructor(location: AstLocation, start: string, option_list: TikzOption[], operation_list: TikzPathOperation[]) {
    super(location, [])
    this._type = this.constructor.name
    this._start = start
    this._option_list = option_list
    this._operation_list = operation_list
  }
  operations(): TikzPathOperation[] {
    return this._operation_list
  }
  options(): TikzOption[] {
    return this._option_list
  }
}
