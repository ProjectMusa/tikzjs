import { AbsoluteCoordinate, assembleBoundingBox } from '../utils'
import { OptionableElementInterface } from '../Element'
import { GeometryInterface } from '../utils'
import { Context } from '../Context'
import { TikzNodeElement } from './TikzNodeElement'
import { BoundingBox } from '../utils'
import { defaultArrowMarker, defaultReversedArrowMarker, TikzMarkerElement } from './TikzMarkerElement'
import { TikzColorOption, TikzOption } from '../../parser/TikzOptions'

export interface TikzSubPathPart extends GeometryInterface {
  _start?: AbsoluteCoordinate
  _end?: AbsoluteCoordinate
  _attachedNodes: TikzNodeElement[] // dangling nodes can be attached to SubPathPart
  renderD(): string
  attachNode(n: TikzNodeElement): boolean // will not influence the geometry
  tryPoseSelf(): boolean // return true if the subpath it self is well-posed
  tryPoseAattachedNodes(): boolean // return true if all attached nodes are well-posed
  // when subpath geometry is fixed, pose the dangling nodes attached and push to Context
  setStartNode?(n: TikzNodeElement): void // influence geometry
  setEndNode?(n: TikzNodeElement): void // influence geometry
}

export class TikzSubPathElement implements OptionableElementInterface, GeometryInterface {
  // sub path : means something you need to draw in svg with a single <path> elemnet
  // While TizkPathElement means a group of TikzSubPathElement that are specified with a single
  // regard less wether it is streight lines or curves arcs
  // render with svg tag <path>
  _parts: TikzSubPathPart[] = []
  _coordinate_stack: (AbsoluteCoordinate | string)[] = []
  _ctx: Context
  _subCtx: Context
  _startMarker?: TikzMarkerElement
  _endMarker?: TikzMarkerElement
  _fill?: string
  _stroke?: string
  constructor(ctx: Context) {
    this._ctx = ctx
    this._subCtx = new Context(this._ctx)
    for (let option of ctx._options) {
      this.applyOption(option)
    }
  }

  applyOption(option: TikzOption): void {
    if (option instanceof TikzColorOption) {
      if (option._fill) this._fill = option._fill
      if (option._stroke) this._stroke = option._stroke
      this._subCtx.pushOption(option)
    } else {
      switch (option._option_key) {
        case '->':
          this._endMarker = defaultArrowMarker
          this._ctx.useMarker(defaultArrowMarker._uid)
          return
        case '<-':
          this._startMarker = defaultReversedArrowMarker
          this._ctx.useMarker(defaultReversedArrowMarker._uid)
          return
        case '<->':
          this._startMarker = defaultReversedArrowMarker
          this._endMarker = defaultArrowMarker
          this._ctx.useMarker(defaultArrowMarker._uid)
          this._ctx.useMarker(defaultReversedArrowMarker._uid)
          return
      }
    }
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

  pushNodeAlias(alias: string) {
    this._coordinate_stack.push(alias)
  }

  pushPart(part: TikzSubPathPart) {
    this._parts.push(part)
  }

  peekCoordinateOrNodeAlias(): AbsoluteCoordinate | string | undefined {
    return this._coordinate_stack.at(-1)
  }

  peekCoordinate(): AbsoluteCoordinate | undefined {
    let top = this._coordinate_stack.at(-1)
    if (typeof top === 'string') {
      return this._ctx.getNodeCoordinate(top)
    } else {
      return top
    }
  }

  peekPart(): TikzSubPathPart | undefined {
    return this._parts.at(-1)
  }

  render(): HTMLElement[] {
    let subPath = document.createElement('path')
    let dlist: string[] = []
    let d: string = ''
    for (let part of this._parts) {
      dlist.push(part.renderD())
    }
    d = dlist.join(' ')
    subPath.setAttribute('d', d)
    if (this._startMarker) {
      subPath.setAttribute('marker-start', `url(#${this._startMarker._uid})`)
    }
    if (this._endMarker) {
      subPath.setAttribute('marker-end', `url(#${this._endMarker._uid})`)
    }

    if (this._fill) {
      subPath.setAttribute('fill', this._fill)
    }

    if (this._stroke) {
      subPath.setAttribute('stroke', this._stroke)
    }

    return [subPath]
  }
}
