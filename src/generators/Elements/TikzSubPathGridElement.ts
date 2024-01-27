import { TikzSubPathPart } from './TikzSubPathElement'
import { AbsoluteCoordinate, cm2px, toAbsoluteCoordinate, toAbsoluteOffset } from '../utils'
import { BoundingBox } from '../utils'
export class TikzSubPathGridElement implements TikzSubPathPart {
  _start?: AbsoluteCoordinate
  _end?: AbsoluteCoordinate
  _step_vec: AbsoluteCoordinate = { x: cm2px, y: cm2px }

  constructor(start?: AbsoluteCoordinate, end?: AbsoluteCoordinate, step?: AbsoluteCoordinate) {
    this._start = start
    this._end = end
    if (step) this._step_vec = step
  }

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
      console.log('grid box', JSON.stringify(this._start), JSON.stringify(this._end), JSON.stringify(box))
      return box
    }
  }

  renderD(): string {
    if (!this._end || !this._start) throw console.error('start end still undefined in render stage')
    const xsign: boolean = (this._end.x - this._start.x) * this._step_vec.x > 0
    const ysign: boolean = (this._end.y - this._start.y) * this._step_vec.y > 0
    let xNum = Math.ceil(Math.abs(this._end.x - this._start.x) / Math.abs(this._step_vec.x)) - 1
    let yNum = Math.ceil(Math.abs(this._end.y - this._start.y) / Math.abs(this._step_vec.y)) - 1
    let result: string[] = []
    let xRange = Array.from(Array(xNum).keys()).map((x) => x + 1)
    let yRange = Array.from(Array(yNum).keys()).map((x) => x + 1)
    result.push(
      `M ${this._start.x} ${this._start.y} H ${this._end.x} V ${this._end.y} H ${this._start.x} V ${this._start.y} z`,
    )
    for (let xIdx of xRange) {
      let Head = xsign ? this._start.x + this._step_vec.x * xIdx : this._start.x - this._step_vec.x * xIdx
      result.push(`M ${Head} ${this._start.y}`)
      result.push(`V ${this._end.y}`)
    }
    for (let yIdx of yRange) {
      let Head = ysign ? this._start.y + this._step_vec.y * yIdx : this._start.y - this._step_vec.y * yIdx
      result.push(`M ${this._start.x} ${Head}`)
      result.push(`H ${this._end.x}`)
    }
    result.push(`M ${this._end.x} ${this._end.y}`)
    return result.join(' ')
  }
}
