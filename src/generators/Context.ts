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

  constructor(base?: Context) {
    this.generator = base ? base.generator : undefined
    this.global = base ? base.global : this
    this.base = base ? base : undefined
  }
}
