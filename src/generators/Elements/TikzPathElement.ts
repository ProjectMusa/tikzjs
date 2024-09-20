import {
  ECoordinateMoveType,
  TikzCoordinate,
  TikzCurveOperation,
  TikzGridOperation,
  TikzLineOperation,
  TikzNodeAliasCoordinate,
  TikzNodeOperation,
  TikzPathOperation,
} from '../../parser/TikzPathOperations'
import { TikzPath } from '../../parser/TikzPath'
import { Context } from '../Context'

import { ElementInterface, OptionableElementInterface } from '../Element'
import { TikzNodeElement } from './TikzNodeElement'
import { TikzSubPathElement } from './TikzSubPathElement'
import { TikzSubPathLineToElement } from './TikzSubPathLineToElement'
import { TikzSubPathCurveToElement } from './TikzSubPathCurveToElement'
import { TikzSubPathGridElement } from './TikzSubPathGridElement'
import { GeometryInterface, BoundingBox, assembleBoundingBox, toAbsoluteCoordinate, AbsoluteCoordinate } from '../utils'
import { TikzOption } from '../../parser/TikzOptions'
export class TikzPathElement implements OptionableElementInterface, GeometryInterface {
  _ast: TikzPath
  _ctx: Context // Defining Context for self
  _subCtx: Context // Context for Child Elements
  _operations: TikzPathOperation[]
  _subpaths: TikzSubPathElement[]
  constructor(ctx: Context, path: TikzPath) {
    // in the constructor
    // 1. validate the syntax
    // 2. transfer all unit to standard
    // 3. relative coordinate to absolute
    // 4. build nodes and subpaths
    this._ast = path
    this._ctx = ctx
    this._subCtx = new Context(ctx)
    this._operations = path._operation_list
    this._subpaths = []
    for (let option of path._option_list) {
      this.applyOption(option)
    }
    let subPath = new TikzSubPathElement(this._subCtx)

    for (let current of this._operations) {
      let bSubPathFinish = false
      if (current instanceof TikzNodeAliasCoordinate) {
        let absC = this._subCtx.getNodeCoordinate(current._target_alias, current._anchor)
        if (absC === undefined) {
          throw console.error(
            `Unknown node anchor alias ${current._target_alias}.${current._anchor} in current context`,
          )
        }

        var nd = this._subCtx.getNode(current._target_alias)
        if (current._anchor === undefined) {
          subPath.pushNodeAlias(current._target_alias) // push alias to coordinate stack
        } else {
          subPath.pushCoordinate(absC)
        }

        // handle _end in SubPathPart
        let lastPart = subPath.peekPart()
        if (lastPart && lastPart._end === undefined) {
          if (lastPart.setEndNode !== undefined && nd) {
            lastPart.setEndNode(nd)
          } else {
            lastPart._end = absC
          }
          // if lastPart become will-posed
          // also pose the attached nodes on it
          if (lastPart.tryPoseSelf()) {
            lastPart.tryPoseAattachedNodes()
          }
        }
      } else if (current instanceof TikzCoordinate) {
        // compute the absolute coordinate of node
        // Todo haandle the path options that may incflunece the coordinates
        // like \draw[rotate=30] only affect explicit coordinates
        const move_type = current.moveType()
        const lastC = subPath.peekCoordinate()
        if (move_type !== ECoordinateMoveType.absolute && lastC === undefined) {
          throw console.error('Relative Coordinate Encountered but coordinate_stack is empty')
        }

        let newAbsC: AbsoluteCoordinate | undefined
        if (move_type === ECoordinateMoveType.absolute) newAbsC = toAbsoluteCoordinate(current, { x: 0, y: 0 })
        else if (lastC) newAbsC = toAbsoluteCoordinate(current, lastC)

        if (!newAbsC) throw console.error('Invalid Absolute Coordinaate')
        if (move_type !== ECoordinateMoveType.relativePass) {
          subPath.pushCoordinate(newAbsC)
        }

        // handle _end in SubPathPart
        let lastPart = subPath.peekPart()
        if (lastPart && lastPart._end === undefined) {
          lastPart._end = newAbsC
          // if lastPart become will-posed
          // also pose the attached nodes on it
          if (lastPart.tryPoseSelf()) {
            lastPart.tryPoseAattachedNodes()
          }
        }
      } else if (current instanceof TikzLineOperation) {
        if (!subPath.ableToInsertNewPart())
          throw console.log('new subPath part encounterd when last path end undefined')
        const start = subPath.peekCoordinateOrNodeAlias()
        var startCoordinate: AbsoluteCoordinate | undefined = undefined
        var startNode: TikzNodeElement | undefined = undefined
        if (typeof start === 'string') {
          startCoordinate = this._subCtx.getNodeCoordinate(start)
          startNode = this._subCtx.getNode(start)
        } else {
          startCoordinate = start as AbsoluteCoordinate
        }
        if (!startCoordinate) {
          throw console.log(`Unknown start for TikzLineOperation ${JSON.stringify(current)}`)
        }
        let newLineToElement = new TikzSubPathLineToElement(
          this._subCtx,
          startCoordinate,
          undefined,
          current._line_type,
        )
        if (startNode) newLineToElement.setStartNode(startNode)
        subPath.pushPart(newLineToElement)
      } else if (current instanceof TikzNodeOperation) {
        if (current._coordinate) {
          // the parser should asign coordinate for well posed node
          // with known coordinate
          const move_type = current._coordinate.moveType()
          if (move_type !== ECoordinateMoveType.absolute && subPath.peekCoordinateOrNodeAlias() === undefined) {
            throw console.error('Relative Coordinate Encountered but coordinate_stack is empty')
          }
          let newNode = new TikzNodeElement(
            ctx,
            current,
            current._coordinate,
            move_type === ECoordinateMoveType.absolute ? { x: 0, y: 0 } : subPath.peekCoordinate(),
          )
          newNode.setLaTeX(current._contents)
          newNode.setAlias(current._alias)
          ctx.pushNode(newNode)
        } else {
          // with no explicit coordinate, only posible if this is attached to a subPath
          let newNode = new TikzNodeElement(ctx, current)
          newNode.setLaTeX(current._contents)
          newNode.setAlias(current._alias)
          // try to attach it to SubPathPart
          let targetPart = subPath.peekPart()
          if (targetPart) {
            targetPart.attachNode(newNode)
          }
        }
      } else if (current instanceof TikzGridOperation) {
        if (!subPath.ableToInsertNewPart())
          throw console.log('new subPathPath part encounterd when last path end undefined')
        const startCoordinate = subPath.peekCoordinate()
        if (!startCoordinate) {
          throw console.log(`Unknown start coordinate for TikzGridOperation ${JSON.stringify(current)}`)
        }
        let newGridElement = new TikzSubPathGridElement(startCoordinate, undefined)
        subPath.pushPart(newGridElement)
      } else if (current instanceof TikzCurveOperation) {
        if (!subPath.ableToInsertNewPart())
          throw console.log('new subPath part encounterd when last subPath end undefined')
        const start = subPath.peekCoordinateOrNodeAlias()
        var startCoordinate: AbsoluteCoordinate | undefined = undefined
        var startNode: TikzNodeElement | undefined = undefined
        if (typeof start === 'string') {
          startCoordinate = this._subCtx.getNodeCoordinate(start)
          startNode = this._subCtx.getNode(start)
        } else {
          startCoordinate = start as AbsoluteCoordinate
        }
        if (!startCoordinate) {
          throw console.log(`Unknown start for TikzLineOperation ${JSON.stringify(current)}`)
        }
        let newCurveElement = new TikzSubPathCurveToElement(
          this._subCtx,
          startCoordinate,
          undefined,
          current._c0,
          current._c1,
        )
        if (startNode) newCurveElement.setStartNode(startNode)
        subPath.pushPart(newCurveElement)
      } else {
        throw console.error('Unknown Operation on TikzPath')
      }

      if (bSubPathFinish) {
        // Should finish current subPath
        if (subPath.valid()) this._subpaths.push(subPath)
      }
    }

    if (subPath.valid()) this._subpaths.push(subPath)
  }

  applyOption(option: TikzOption): void {
    if (option._option_key) {
      // TODO validate each option for (pathElement)
      this._subCtx.pushOption(option)
    }
  }

  computeBoundingBox(): BoundingBox | undefined {
    return assembleBoundingBox(this._subpaths)
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
