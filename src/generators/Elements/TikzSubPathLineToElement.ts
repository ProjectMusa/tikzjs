import { TikzSubPathPart } from './TikzSubPathElement'
import { AbsoluteCoordinate } from '../utils'
import { ESimpleLineType } from '../../parser/TikzPathOperations'

export class TikzSubPathLineToElement implements TikzSubPathPart {
  _start?: AbsoluteCoordinate
  _end?: AbsoluteCoordinate
  _line_type?: ESimpleLineType
  constructor(start?: AbsoluteCoordinate, end?: AbsoluteCoordinate, line_type?: ESimpleLineType) {
    this._start = start
    this._end = end
    this._line_type = line_type
  }
  renderD(): string {
    if (this._line_type === ESimpleLineType.horizontal2vertical) return `H ${this._end?.x} V ${this._end?.y}`
    else if (this._line_type === ESimpleLineType.vertical2horizontal) return `V ${this._end?.y} H ${this._end?.x}`
    else return `L ${this._end?.x} ${this._end?.y}`
  }
}
