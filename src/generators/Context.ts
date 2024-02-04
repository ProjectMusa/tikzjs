import { string } from 'yargs'
import { TikzNodeElement } from './Elements/TikzNodeElement'
import { EGenerators } from './Generator'
import { AbsoluteCoordinate } from './utils'

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

  _nodes: TikzNodeElement[]
  _alias_node_map: {[key:string]: TikzNodeElement}

  constructor(base?: Context) {
    this.generator = base ? base.generator : undefined
    this.global = base ? base.global : this
    this.base = base ? base : undefined
    this._nodes = base ? base._nodes : []
    this._alias_node_map = {}
  }

  pushNode(node: TikzNodeElement) {
    if (!node._center) console.error('Trying to push an undefined node into contex')
    if(node._alias !== undefined) {
      if( this._alias_node_map[node._alias] !== undefined) {
        throw console.error(`node with alias ${node._alias} already exists in current context, aborting`)
      }
      this._alias_node_map[node._alias] = node
    }
    this._nodes.push(node)
  }

  getNodeCoordinate(alias:string, anchor?: string): AbsoluteCoordinate | undefined {
    for( let nd of this._nodes) {
      if(nd._alias === alias){
        return nd.getAnchor(anchor? anchor : 'center')
      }
    }
    return undefined
  }
}
