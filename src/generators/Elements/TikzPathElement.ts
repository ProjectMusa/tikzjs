import {
  ECoordinateMoveType,
  ESimpleLineType,
  TikzCoordinate,
  TikzCurveOperation,
  TikzGridOperation,
  TikzLineOperation,
  TikzNodeOperation,
  TikzPath,
  TikzPathOperation,
} from '../../parser/TikzRoot'
import { Context } from '../Context'
import { ElementInterface } from '../Element'
import { AbsoluteCoordinate } from '../utils'
import { toAbsoluteCoordinate } from '../utils'

export class TikzPathElement implements ElementInterface {
  _ast: TikzPath
  _ctx: Context
  _operations: TikzPathOperation[]
  _nodes: TikzNodeElement[]
  _subpaths: TikzSubPathElement[]
  constructor(ctx: Context, path: TikzPath) {
    // in the constructor
    // 1. validate the syntax
    // 2. transfer all unit to standard
    // 3. relative coordinate to absolute
    // 4. build nodes and subpaths
    this._ast = path
    this._ctx = ctx
    this._operations = path._operation_list
    this._nodes = []
    this._subpaths = []

    let subPath = new TikzSubPathElement(this._ctx)

    for (let current of this._operations) {
      let bSubPathFinish = false

      if (current instanceof TikzCoordinate) {
        // compute the absolute coordinate of node
        const move_type = current.moveType()
        if (move_type !== ECoordinateMoveType.absolute && subPath.peekCoordinate() === undefined) {
          throw console.error('Relave Coordinate Encountered but coordinate_stack is empty')
        }
        let newNode = new TikzNodeElement(
          ctx,
          current,
          move_type === ECoordinateMoveType.absolute ? { x: 0, y: 0 } : subPath.peekCoordinate(),
        )
        const newAbsC = newNode.absoluteCoordinate()
        if (!newAbsC) throw console.error('')
        if (move_type !== ECoordinateMoveType.relativePass) {
          subPath.pushCoordinate(newAbsC)
        }

        // handle _end in SubPathPart
        let lastPart = subPath.peekPart()
        if (lastPart && lastPart._end === undefined) {
          lastPart._end = newAbsC
        }
      } else if (current instanceof TikzLineOperation) {
        if (!subPath.ableToInsertNewPart())
          throw console.log('new subPathPath part encounterd when last path end undefined')
        const startCoordinate = subPath.peekCoordinate()
        if (!startCoordinate) {
          throw console.log(`Unknown start coordinate for TikzLineOperation ${JSON.stringify(current)}`)
        }
        let newLineToElement = new TikzLineToElement(startCoordinate, undefined, current._line_type)

        subPath.pushPart(newLineToElement)
      } else if (current instanceof TikzNodeOperation) {
      } else if (current instanceof TikzGridOperation) {
        if (!subPath.ableToInsertNewPart())
          throw console.log('new subPathPath part encounterd when last path end undefined')
        const startCoordinate = subPath.peekCoordinate()
        if (!startCoordinate) {
          throw console.log(`Unknown start coordinate for TikzGridOperation ${JSON.stringify(current)}`)
        }
        let newGridElement = new TikzGridElement(startCoordinate, undefined)
        subPath.pushPart(newGridElement)
      } else if (current instanceof TikzCurveOperation) {
        if (!subPath.ableToInsertNewPart())
          throw console.log('new subPathPath part encounterd when last path end undefined')
        const startCoordinate = subPath.peekCoordinate()
        if (!startCoordinate) {
          throw console.log(`Unknown start coordinate for TikzCurveOperation ${JSON.stringify(current)}`)
        }
        let newCurveElement = new TikzCurveToElement(startCoordinate, undefined, current._c0, current._c1)
        subPath.pushPart(newCurveElement)
      } else {
        throw console.error('Unknown Operation on TikzPath')
      }

      if (bSubPathFinish) {
        // Should finish current subPath
        this._subpaths.push(subPath)
      }
    }

    if (subPath.valid()) this._subpaths.push(subPath)
  }

  render(): HTMLElement[] {
    let group = document.createElement('g')
    for (let subPath of this._subpaths) {
      group.append(...subPath.render())
      group.setAttribute('fill', 'none')
      group.setAttribute('stroke', 'black')
    }
    return [group]
  }
}

export class TikzNodeElement implements ElementInterface {
  _ast?: TikzCoordinate
  _ctx: Context
  _alias?: string
  _absolute_coordinate?: AbsoluteCoordinate
  latex?: string

  constructor(ctx: Context, coordinate?: TikzCoordinate, baseC?: AbsoluteCoordinate) {
    this._ctx = ctx
    this._ast = coordinate
    if (coordinate && baseC) {
      this._absolute_coordinate = toAbsoluteCoordinate(coordinate, baseC)
    }
  }

  setAlias(alias: string) {
    this._alias = alias
  }

  setOffsets(offset: AbsoluteCoordinate) {
    this._absolute_coordinate = offset
  }

  absoluteCoordinate(): AbsoluteCoordinate | undefined {
    return this._absolute_coordinate
  }

  render(): HTMLElement[] {
    return []
  }
}

interface TikzSubPathPart {
  _start?: AbsoluteCoordinate
  _end?: AbsoluteCoordinate
  renderD(): string
}

export class TikzLineToElement implements TikzSubPathPart {
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

export class TikzGridElement implements TikzSubPathPart {
  _start?: AbsoluteCoordinate
  _end?: AbsoluteCoordinate
  _step_vec: AbsoluteCoordinate = { x: 10, y: 10 }
  constructor(start?: AbsoluteCoordinate, end?: AbsoluteCoordinate, step?: AbsoluteCoordinate) {
    this._start = start
    this._end = end
    if (step) this._step_vec = step
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

export class TikzCurveToElement implements TikzSubPathPart {
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
export class TikzSubPathElement implements ElementInterface {
  // sub path
  // regard less wether it is streight lines or curves arcs
  // render with svg tag <path>
  _parts: TikzSubPathPart[] = []
  _coordinate_stack: AbsoluteCoordinate[] = []
  _ctx: Context

  constructor(ctx: Context) {
    this._ctx = ctx
  }

  valid(): boolean {
    return (
      this._parts.length > 0 &&
      this._parts.every((part: TikzSubPathPart) => {
        return part._end !== undefined && part._start !== undefined
      })
    )
  }

  ableToInsertNewPart() {
    return this._parts.length === 0 || this.peekPart()?._end !== undefined
  }

  pushCoordinate(absC: AbsoluteCoordinate) {
    this._coordinate_stack.push(absC)
  }

  pushPart(part: TikzSubPathPart) {
    this._parts.push(part)
  }

  peekCoordinate(): AbsoluteCoordinate | undefined {
    return this._coordinate_stack.at(-1)
  }

  peekPart(): TikzSubPathPart | undefined {
    return this._parts.at(-1)
  }

  render(): HTMLElement[] {
    let subPath = document.createElement('path')
    let dlist: string[] = []
    let d: string = ''
    let bFirst = true
    for (let part of this._parts) {
      if (bFirst) {
        dlist.push(`M ${part._start?.x} ${part._start?.y}`)
        bFirst = false
      }
      dlist.push(part.renderD())
    }
    d = dlist.join(' ')
    subPath.setAttribute('d', d)
    return [subPath]
  }
}
