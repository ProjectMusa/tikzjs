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

import { ElementInterface } from '../Element'
import { TikzNodeElement } from './TikzNodeElement'
import { TikzSubPathElement } from './TikzSubPathElement'
import { TikzSubPathLineToElement } from './TikzSubPathLineToElement'
import { TikzSubPathCurveToElement } from './TikzSubPathCurveToElement'
import { TikzSubPathGridElement } from './TikzSubPathGridElement'
import { GeometryInterface, BoundingBox, assembleBoundingBox, toAbsoluteCoordinate, AbsoluteCoordinate } from '../utils'
export class TikzPathElement implements ElementInterface, GeometryInterface {
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
      if (current instanceof TikzNodeAliasCoordinate) {
        let absC = this._ctx.getNodeCoordinate(current._target_alias, current._anchor)
        if (absC === undefined) {
          throw console.error(
            `Unknown node anchor alias ${current._target_alias}.${current._anchor} in current context`,
          )
        }
        subPath.pushCoordinate(absC)

        // handle _end in SubPathPart
        let lastPart = subPath.peekPart()
        if (lastPart && lastPart._end === undefined) {
          lastPart._end = absC
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
        const startCoordinate = subPath.peekCoordinate()
        if (!startCoordinate) {
          throw console.log(`Unknown start coordinate for TikzLineOperation ${JSON.stringify(current)}`)
        }
        let newLineToElement = new TikzSubPathLineToElement(this._ctx, startCoordinate, undefined, current._line_type)

        subPath.pushPart(newLineToElement)
      } else if (current instanceof TikzNodeOperation) {
        if (current._coordinate) {
          // the parser should asign coordinate for well posed node
          // with known coordinate
          const move_type = current._coordinate.moveType()
          if (move_type !== ECoordinateMoveType.absolute && subPath.peekCoordinate() === undefined) {
            throw console.error('Relative Coordinate Encountered but coordinate_stack is empty')
          }
          let newNode = new TikzNodeElement(
            ctx,
            current._coordinate,
            move_type === ECoordinateMoveType.absolute ? { x: 0, y: 0 } : subPath.peekCoordinate(),
          )
          newNode.setLaTeX(current._contents)
          newNode.setAlias(current._alias)
          ctx.pushNode(newNode)
        } else {
          // with no explicit coordinate, only posible if this is attached to a subPath
          let newNode = new TikzNodeElement(ctx)
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
          throw console.log('new subPath part encounterd when last path end undefined')
        const startCoordinate = subPath.peekCoordinate()
        if (!startCoordinate) {
          throw console.log(`Unknown start coordinate for TikzCurveOperation ${JSON.stringify(current)}`)
        }
        let newCurveElement = new TikzSubPathCurveToElement(
          this._ctx,
          startCoordinate,
          undefined,
          current._c0,
          current._c1,
        )
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
