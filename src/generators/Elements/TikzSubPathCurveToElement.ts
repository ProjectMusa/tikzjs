import { TikzSubPathPart } from './TikzSubPathElement'
import { AbsoluteCoordinate, toAbsoluteCoordinate } from '../utils'
import { TikzCoordinate } from '../../parser/TikzPathOperations'
import { ECoordinateMoveType } from '../../parser/TikzPathOperations'
import { BoundingBox } from '../utils'
import { Bezier, BBox } from 'bezier-js'
import { TikzNodeElement } from './TikzNodeElement'
import { Context } from '../Context'

export class TikzSubPathCurveToElement implements TikzSubPathPart {
  _ctx: Context
  _start?: AbsoluteCoordinate
  _end?: AbsoluteCoordinate
  _startNode?: TikzNodeElement
  _endNode?: TikzNodeElement
  _control0?: TikzCoordinate
  _control1?: TikzCoordinate
  _bezier?: Bezier
  _attachedNodes: TikzNodeElement[] = []
  constructor(
    ctx: Context,
    start?: AbsoluteCoordinate,
    end?: AbsoluteCoordinate,
    control0?: TikzCoordinate,
    control1?: TikzCoordinate,
  ) {
    this._ctx = ctx
    this._start = start
    this._end = end
    this._control0 = control0
    this._control1 = control1
    // special rules:
    // First, a relative first control point is taken relative to the beginning of the curve.
    // Second, a relative second control point is taken relative to the end of the curve.
    // Third control point is not pushed into stack
  }

  computeBoundingBox(): BoundingBox | undefined {
    if (this._start && this._end && this._control0 && this._control1) {
      const absC0 =
        this._control0.moveType() === ECoordinateMoveType.absolute
          ? toAbsoluteCoordinate(this._control0, { x: 0, y: 0 })
          : toAbsoluteCoordinate(this._control0, this._start)
      const absC1 =
        this._control1.moveType() === ECoordinateMoveType.absolute
          ? toAbsoluteCoordinate(this._control1, { x: 0, y: 0 })
          : toAbsoluteCoordinate(this._control1, this._end)
      if (absC0 && absC1) {
        this._bezier = new Bezier(
          this._start.x,
          this._start.y,
          absC0.x,
          absC0.y,
          absC1.x,
          absC1.y,
          this._end.x,
          this._end.y,
        )
        let bezierBox: BBox = this._bezier.bbox()
        let box: BoundingBox = {
          lowerLeft: {
            x: bezierBox.x.min,
            y: bezierBox.y.min,
          },
          upperRight: {
            x: bezierBox.x.max,
            y: bezierBox.y.max,
          },
        }
        console.log('bezier', JSON.stringify(bezierBox))
        return box
      }
    }
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
      return `M ${this._start.x} ${this._start.y}Q ${absC0?.x} ${absC0?.y} ${this._end.x} ${this._end.y}`
    } else {
      const absC1 =
        this._control1.moveType() === ECoordinateMoveType.absolute
          ? toAbsoluteCoordinate(this._control1, { x: 0, y: 0 })
          : toAbsoluteCoordinate(this._control1, this._end)
      return `M ${this._start.x} ${this._start.y} C ${absC0?.x} ${absC0?.y} ${absC1?.x} ${absC1?.y} ${this._end.x} ${this._end.y}`
    }
  }

  attachNode(n: TikzNodeElement): boolean {
    this._attachedNodes.push(n)
    return true
  }

  setEndNode(n: TikzNodeElement): void {
    this._endNode = n
    // temporary solution
    this._end = n.getAnchor('center')
  }

  setStartNode(n: TikzNodeElement): void {
    this._startNode = n
    this._start = n.getAnchor('center')
  }

  tryPoseSelf(): boolean {
    if (this._start && this._end && this._control0 && this._control1) {
      const absC0 =
        this._control0.moveType() === ECoordinateMoveType.absolute
          ? toAbsoluteCoordinate(this._control0, { x: 0, y: 0 })
          : toAbsoluteCoordinate(this._control0, this._start)
      const absC1 =
        this._control1.moveType() === ECoordinateMoveType.absolute
          ? toAbsoluteCoordinate(this._control1, { x: 0, y: 0 })
          : toAbsoluteCoordinate(this._control1, this._end)
      if (absC0 && absC1) {
        this._bezier = new Bezier(
          this._start.x,
          this._start.y,
          absC0.x,
          absC0.y,
          absC1.x,
          absC1.y,
          this._end.x,
          this._end.y,
        )
        return true
      }
    } else if (this._start && this._end && this._control0) {
      const absC0 =
        this._control0.moveType() === ECoordinateMoveType.absolute
          ? toAbsoluteCoordinate(this._control0, { x: 0, y: 0 })
          : toAbsoluteCoordinate(this._control0, this._start)
      if (absC0) {
        this._bezier = new Bezier(this._start.x, this._start.y, absC0.x, absC0.y, this._end.x, this._end.y)
        return true
      }
    }
    return false
  }

  tryPoseAattachedNodes(): boolean {
    // attach at 0.5 by default
    // TODO add more position options
    if (!this._bezier) console.error('Error, curve is not well-posed')
    this._attachedNodes.forEach((node: TikzNodeElement) => {
      let pt = this._bezier?.compute(0.5)
      let normal = this._bezier?.normal(0.5)
      let attachCenter: AbsoluteCoordinate = pt ? { x: pt.x, y: pt.y } : { x: 0, y: 0 }
      let normalVec: AbsoluteCoordinate = normal ? { x: normal.x, y: normal.y } : { x: 0, y: -1 }
      if (node.tryPoseAgainst(attachCenter, normalVec)) this._ctx.pushNode(node)
    })
    return true
  }
}
