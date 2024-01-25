import { TikzSubPathPart } from './TikzSubPathElement'
import { AbsoluteCoordinate, toAbsoluteCoordinate } from '../utils'
import { TikzCoordinate } from '../../parser/TikzPathOperations'
import { ECoordinateMoveType } from '../../parser/TikzPathOperations'

export class TikzSubPathCurveToElement implements TikzSubPathPart {
  _start?: AbsoluteCoordinate
  _end?: AbsoluteCoordinate
  _control0?: TikzCoordinate
  _control1?: TikzCoordinate
  constructor(
    start?: AbsoluteCoordinate,
    end?: AbsoluteCoordinate,
    control0?: TikzCoordinate,
    control1?: TikzCoordinate,
  ) {
    this._start = start
    this._end = end
    this._control0 = control0
    this._control1 = control1
    // special rules:
    // First, a relative first control point is taken relative to the beginning of the curve.
    // Second, a relative second control point is taken relative to the end of the curve.
    // Third control point is not pushed into stack
  }
  renderD(): string {
    if (!this._end || !this._start || !this._control0)
      throw console.error('start/end/control0 still undefined in render stage')
    const absC0 =
      this._control0.moveType() === ECoordinateMoveType.absolute
        ? toAbsoluteCoordinate(this._control0, { x: 0, y: 0 })
        : toAbsoluteCoordinate(this._control0, this._start)
    if (!this._control1) {
      // quadratic bezier
      return `Q ${absC0?.x} ${absC0?.y} ${this._end.x} ${this._end.y}`
    } else {
      const absC1 =
        this._control1.moveType() === ECoordinateMoveType.absolute
          ? toAbsoluteCoordinate(this._control1, { x: 0, y: 0 })
          : toAbsoluteCoordinate(this._control1, this._end)
      return `C ${absC0?.x} ${absC0?.y} ${absC1?.x} ${absC1?.y} ${this._end.x} ${this._end.y}`
    }
  }
}
