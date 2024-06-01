import { TikzSubPathPart } from './TikzSubPathElement'
import { AbsoluteCoordinate, BoundingBox } from '../utils'
import { ESimpleLineType } from '../../parser/TikzPathOperations'
import { TikzNodeElement } from './TikzNodeElement'
import { Context } from '../Context'
export class TikzSubPathLineToElement implements TikzSubPathPart {
  _ctx: Context
  _start?: AbsoluteCoordinate
  _end?: AbsoluteCoordinate
  _attachedNodes: TikzNodeElement[] = []
  _line_type?: ESimpleLineType
  constructor(ctx: Context, start?: AbsoluteCoordinate, end?: AbsoluteCoordinate, line_type?: ESimpleLineType) {
    this._ctx = ctx
    this._start = start
    this._end = end
    this._line_type = line_type
  }

  /**
   * Computes the bounding box of the line segment defined by the start and end points.
   * @returns The bounding box of the line segment, or undefined if either the start or end point is missing.
   */
  computeBoundingBox(): BoundingBox | undefined {
    if (this._start && this._end) {
      let box: BoundingBox = {
        lowerLeft: {
          x: Math.min(this._start.x, this._end.x),
          y: Math.min(this._start.y, this._end.y),
        },
        upperRight: {
          x: Math.max(this._start.x, this._end.x),
          y: Math.max(this._start.y, this._end.y),
        },
      }
      return box
    }
  }

  renderD(): string {
    if (this._line_type === ESimpleLineType.horizontal2vertical)
      return `M ${this._start?.x} ${this._start?.y} H ${this._end?.x} V ${this._end?.y}`
    else if (this._line_type === ESimpleLineType.vertical2horizontal)
      return `M ${this._start?.x} ${this._start?.y} V ${this._end?.y} H ${this._end?.x}`
    else return `M ${this._start?.x} ${this._start?.y} L ${this._end?.x} ${this._end?.y}`
  }

  /**
   * Attaches a TikzNodeElement to the current TikzSubPathLineToElement.
   *
   * @param n The TikzNodeElement to attach.
   * @returns A boolean indicating whether the attachment was successful.
   */
  attachNode(n: TikzNodeElement): boolean {
    this._attachedNodes.push(n)
    return true
  }

  tryPoseSelf(): boolean {
    if (this._start && this._end && this._line_type !== undefined) {
      return true
    }
    return false
  }

  /**
   * Tries to pose the attached nodes based on the start and end points of the line element.
   * @returns A boolean indicating whether the attached nodes were successfully posed.
   */
  tryPoseAattachedNodes(): boolean {
    if (this._start && this._end && this._line_type !== undefined) {
      let corner: AbsoluteCoordinate
      if (this._line_type === ESimpleLineType.streight) {
        corner = { x: (this._start.x + this._end.x) / 2, y: (this._start.y + this._end.y) / 2 }
      } else if (this._line_type === ESimpleLineType.horizontal2vertical) {
        corner = { x: this._end.x, y: this._start.y }
      } else if (this._line_type === ESimpleLineType.vertical2horizontal) {
        corner = { x: this._start.x, y: this._end.y }
      }

      let norm = Math.sqrt((this._start.x - this._end.x) ** 2 + (this._start.y - this._end.y) ** 2)
      if (norm === 0) {
        throw console.error('identical start and end points for line to element')
      }
      this._attachedNodes.forEach((node: TikzNodeElement) => {
        let pos = node.getAttachPosition()
        let normalVec: AbsoluteCoordinate = { x: 0, y: 1 }
        let attachCenter: AbsoluteCoordinate = { x: 0, y: 0 }
        if (!this._start || !this._end) {
          throw console.error('Undefined line to element')
        }
        if (this._line_type === ESimpleLineType.streight) {
          normalVec = {
            x: (this._start.y - this._end.y) / norm,
            y: -(this._start.x - this._end.x) / norm,
          }
          attachCenter = {
            x: (1 - pos) * this._start.x + pos * this._end.x,
            y: (1 - pos) * this._start.y + pos * this._end.y,
          }
        } else if (this._line_type === ESimpleLineType.horizontal2vertical) {
          normalVec = pos > 0.5 ? { x: 1, y: 0 } : { x: 0, y: 1 }
          let cpos = pos > 0.5 ? (pos - 0.5) / 0.5 : pos / 0.5
          attachCenter =
            pos > 0.5
              ? { x: (1 - cpos) * corner.x + cpos * this._end.x, y: (1 - cpos) * corner.y + cpos * this._end.y }
              : { x: (1 - cpos) * this._start.x + cpos * corner.x, y: (1 - cpos) * this._start.y + cpos * corner.y }
        } else if (this._line_type === ESimpleLineType.vertical2horizontal) {
          normalVec = pos > 0.5 ? { x: 0, y: 1 } : { x: 1, y: 0 }
          let cpos = pos > 0.5 ? (pos - 0.5) / 0.5 : pos / 0.5
          attachCenter =
            pos > 0.5
              ? { x: (1 - cpos) * corner.x + cpos * this._end.x, y: (1 - cpos) * corner.y + cpos * this._end.y }
              : { x: (1 - cpos) * this._start.x + cpos * corner.x, y: (1 - cpos) * this._start.y + cpos * corner.y }
        }
        if (node.tryPoseAgainst(attachCenter, normalVec)) this._ctx.pushNode(node)
      })
      return true
    }
    return false
  }
}
