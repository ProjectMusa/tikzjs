import { TikzNodeElement } from './Elements/TikzNodeElement'
import { EGenerators } from './Generator'

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

  pushuNode(node: TikzNodeElement) {
    this._nodes.push(node)
  }
}
