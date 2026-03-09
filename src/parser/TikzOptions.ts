import { AstNode, AstLocation } from './TikzAST'
import { TikzCoordinateOffset } from './TikzPathOperations'
export class TikzOption extends AstNode {
  _option_key: string
  _option_override?: string
  constructor(location: AstLocation, option_key: string, option_override?: string) {
    super(location, [])
    this._type = this.constructor.name
    this._option_key = option_key
    this._option_override = option_override
  }
}

export class TikzColorOption extends TikzOption {
  _fill?: string
  _stroke?: string
  constructor(location: AstLocation, fill?: string, stroke?: string) {
    super(location, 'color', `fill=${fill},stroke=${stroke}`)
    this._fill = fill
    this._stroke = stroke
  }
}

export class TikzNodeOption extends TikzOption {
  _offset?: TikzCoordinateOffset
  constructor(location: AstLocation, option_key: string, option_offset?: TikzCoordinateOffset) {
    super(location, option_key, `${option_offset?._offset}${option_offset?._unit}`)
    this._offset = option_offset
  }
}
