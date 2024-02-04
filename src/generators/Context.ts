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

  constructor(base?: Context) {
    this.generator = base ? base.generator : undefined
    this.global = base ? base.global : this
    this.base = base ? base : undefined
    this._nodes = base ? base._nodes : []
  }

  pushNode(node: TikzNodeElement) {
    if (!node._center) console.error('Trying to push an undefined node into contex')
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
