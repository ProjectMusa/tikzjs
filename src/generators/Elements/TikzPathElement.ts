import {
  ECoordinateMoveType,
  ESimpleLineType,
  TikzCoordinate,
  TikzLineOperation,
  TikzNodeOperation,
  TikzPath,
  TikzPathOperation,
} from '../../parser/TikzRoot'
import { Context } from '../Context'
import { ElementInterface } from '../Element'
interface AbsoluteCoordinate {
  x: number
  y: number
}

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
          subPath.peekCoordinate() ? subPath.peekCoordinate() : { x: 0, y: 0 },
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
      this._absolute_coordinate = this.toAbsoluteCoordinate(coordinate, baseC)
    }
  }

  toAbsoluteCoordinate(coordinate: TikzCoordinate, baseC: AbsoluteCoordinate): AbsoluteCoordinate | undefined {
    let offsets = coordinate.offsets()
    if (offsets.length === 2) {
      // 2D coordinate input
      if (coordinate._cs_type === 'canvas') {
        return {
          x: offsets[0]._offset + baseC.x,
          y: offsets[1]._offset + baseC.y,
        }
      } else {
        throw console.error('Unknow coordinate system encountered')
      }
    } else if (offsets.length === 3) {
      throw console.error('3D coordiniate is currently not supported')
    }
    return undefined
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
    return `L ${this._end?.x} ${this._end?.y}\n`
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
    let d: string = ''
    let bFirst = true
    for (let part of this._parts) {
      if (bFirst) {
        d = `M ${part._start?.x} ${part._start?.y}\n`
        bFirst = false
      }
      d = d.concat(part.renderD())
    }
    subPath.setAttribute('d', d)
    return [subPath]
  }
}
