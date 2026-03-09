import { TikzNodeElement } from './Elements/TikzNodeElement'
import { EGenerators } from './Generator'
import { AbsoluteCoordinate } from './utils'
import { TikzMarkerElement } from './Elements/TikzMarkerElement'
import { TikzOption } from '../parser/TikzOptions'

export class Context {
  generator?: EGenerators
  /**
   * The parent scope.
   */
  base?: Context

  /**
   * The global scope.
   */
  global?: Context
  _markers: TikzMarkerElement[]
  _nodes: TikzNodeElement[]
  _options: TikzOption[]
  _alias_node_map: { [key: string]: TikzNodeElement }
  _uid_marker_map: { [key: string]: TikzMarkerElement }

  constructor(base?: Context) {
    this.generator = base ? base.generator : undefined
    this.global = base ? base.global : this
    this.base = base ? base : undefined
    this._nodes = base ? base._nodes : [] // nodes are registered globally for now
    this._markers = base ? base._markers : [] // markers are registered globally for now
    this._options = [] // options for rendering elements in current context
    this._alias_node_map = {}
    this._uid_marker_map = base ? base._uid_marker_map : {}
  }

  pushNode(node: TikzNodeElement) {
    if (!node._center) console.error('Trying to push an undefined node into contex')
    if (node._alias !== undefined) {
      if (this._alias_node_map[node._alias] !== undefined) {
        throw console.error(`node with alias ${node._alias} already exists in current context, aborting`)
      }
      this._alias_node_map[node._alias] = node
    }
    this._nodes.push(node)
  }

  getNode(alias: string): TikzNodeElement | undefined {
    return this._alias_node_map[alias]
  }

  getNodeCoordinate(alias: string, anchor?: string): AbsoluteCoordinate | undefined {
    for (let nd of this._nodes) {
      if (nd._alias === alias) {
        return nd.getAnchor(anchor ? anchor : 'center')
      }
    }
    return undefined
  }

  registerMarker(mkr: TikzMarkerElement) {
    this._markers.push(mkr)
  }

  useMarker(uid: string) {
    if (this._uid_marker_map[uid] === undefined) {
      let found = false
      for (let marker of this._markers) {
        if (marker._uid === uid) {
          this._uid_marker_map[uid] = marker
          found = true
          break
        }
      }
      if (!found) {
        throw console.error(`Unknow maker ${uid} referenced`)
      }
    }
  }

  getMarker(uid: string): TikzMarkerElement | undefined {
    return this._uid_marker_map[uid]
  }

  usingMarker(uid: string): boolean {
    if (this._uid_marker_map[uid] !== undefined) {
      return true
    }
    return false
  }

  pushOption(option: TikzOption) {
    this._options.push(option)
  }
}
