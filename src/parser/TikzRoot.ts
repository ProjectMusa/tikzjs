import { option } from 'yargs'
import { AstNode, AstLocation } from './TikzAST'
export class TikzRoot extends AstNode {
  constructor(location: AstLocation, children: AstNode[]) {
    super(location, children)
    this._type = this.constructor.name
  }
}

export class TikzInline extends AstNode {
  _options: TikzOption[]
  _contents: TikzPath[]
  constructor(location: AstLocation, options: TikzOption[], contents: TikzPath[]) {
    super(location, [])
    this._type = this.constructor.name
    this._options = options
    this._contents = contents
  }

  options(): TikzOption[] {
    return this._options
  }

  contents(): TikzPath[] {
    return this._contents
  }
}

export class TikzPicture extends AstNode {
  _options: TikzOption[]
  _contents: TikzPath[]
  constructor(location: AstLocation, options: TikzOption[], contents: TikzPath[]) {
    super(location, [])
    this._type = this.constructor.name
    this._options = options
    this._contents = contents
  }

  options(): TikzOption[] {
    return this._options
  }

  contents(): TikzPath[] {
    return this._contents
  }
}

export class TikzLiteral extends AstNode {
  _literal: string | number
  constructor(location: AstLocation, literal: string | number) {
    super(location, [])
    this._type = this.constructor.name
    this._literal = literal
    console.log(`literal:${this._literal}`)
  }
}

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

export class TikzPathOperation extends AstNode {
  constructor(location: AstLocation) {
    super(location, [])
    this._type = this.constructor.name
  }
}

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

export enum ECoordinateMoveType {
  absolute,
  relative,
  relativePass,
}

const move_type_map: { [name: string]: ECoordinateMoveType } = {
  '': ECoordinateMoveType.absolute,
  '++': ECoordinateMoveType.relative,
  '+': ECoordinateMoveType.relativePass,
}

export class TikzCoordinate extends TikzPathOperation {
  _cs_type: string = 'canvas'
  _move_type: ECoordinateMoveType = ECoordinateMoveType.absolute
  _offset_list: TikzCoordinateOffset[]
  constructor(location: AstLocation, offset_list: TikzCoordinateOffset[], move_type?: string, cs_type?: string) {
    super(location)
    this._type = this.constructor.name
    if (move_type) this._move_type = move_type_map[move_type]
    this._cs_type = cs_type ? cs_type : 'canvas'
    this._offset_list = offset_list
  }
  offsets(): TikzCoordinateOffset[] {
    return this._offset_list
  }
  moveType(): ECoordinateMoveType {
    return this._move_type
  }
}

export class TikzCoordinateOffset extends AstNode {
  _unit?: string
  _offset: number
  constructor(location: AstLocation, offset: number, unit?: string) {
    super(location, [])
    this._type = this.constructor.name
    this._offset = offset
    this._unit = unit
  }
}

export enum ESimpleLineType {
  streight,
  horizontal2vertical,
  vertical2horizontal,
}

const simple_line_type_map: { [symbol: string]: ESimpleLineType } = {
  '--': ESimpleLineType.streight,
  '-|': ESimpleLineType.horizontal2vertical,
  '|-': ESimpleLineType.vertical2horizontal,
}

export class TikzLineOperation extends TikzPathOperation {
  _line_type: ESimpleLineType
  constructor(location: AstLocation, line_type: string) {
    super(location)
    this._type = this.constructor.name
    this._line_type = simple_line_type_map[line_type]
  }
}

export class TikzGridOperation extends TikzPathOperation {
  _options: TikzOption[]
  constructor(location: AstLocation, options: TikzOption[]) {
    super(location)
    this._type = this.constructor.name
    this._options = options
  }
}

export class TikzCurveOperation extends TikzPathOperation {
  _c0: TikzCoordinate
  _c1?: TikzCoordinate
  constructor(location: AstLocation, c0: TikzCoordinate, c1?: TikzCoordinate) {
    super(location)
    this._type = this.constructor.name
    this._c0 = c0
    this._c1 = c1
  }
}

export class TikzToPathOperation extends TikzPathOperation {
  _options: TikzOption[]
  constructor(location: AstLocation, options: TikzOption[]) {
    super(location)
    this._type = this.constructor.name
    this._options = options
  }
}

export class TikzNodeOperation extends TikzPathOperation {
  _coordinate?: TikzCoordinate
  _contents?: string
  _options: TikzOption[]
  constructor(location: AstLocation, options: TikzOption[], coordinate?: TikzCoordinate, contents?: string) {
    super(location)
    this._type = this.constructor.name
    this._options = options
    this._coordinate = coordinate
    this._contents = contents
  }
}
