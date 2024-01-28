import { AbsoluteCoordinate, assembleBoundingBox } from '../utils'
import { ElementInterface } from '../Element'
import { GeometryInterface } from '../utils'
import { Context } from '../Context'
import { TikzNodeElement } from './TikzNodeElement'
import { BoundingBox } from '../utils'

export interface TikzSubPathPart extends GeometryInterface {
  _start?: AbsoluteCoordinate
  _end?: AbsoluteCoordinate
  _attachedNodes: TikzNodeElement[] // dangling nodes can be attached to SubPathPart
  renderD(): string
  attachNode(n: TikzNodeElement): boolean // will not influence the geometry
  tryPoseSelf(): boolean // return is the subpath it self is well-posed
  tryPoseAattachedNodes(): boolean
  // when subpath geometry is fixed, pose the dangling nodes attached and push to Context
  setStartNode?(n: TikzNodeElement): void // influence geometry
  setEndNode?(n: TikzNodeElement): void // influence geometry
}

export class TikzSubPathElement implements ElementInterface, GeometryInterface {
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

  computeBoundingBox(): BoundingBox | undefined {
    return assembleBoundingBox(this._parts)
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
