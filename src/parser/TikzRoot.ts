import { AstNode, AstLocation } from './TikzAST'
import { TikzOption } from './TikzOptions'
import { TikzPathOperation } from './TikzPathOperations'
import { TikzPath } from './TikzPath'
export class TikzRoot extends AstNode {
  constructor(location: AstLocation, children: AstNode[]) {
    super(location, children)
    this._type = this.constructor.name
  }
}

export class TikzInline extends AstNode {
  _options: TikzOption[]
  _contents: TikzPath[]
  constructor(location: AstLocation, options: TikzOption[], contents: TikzPath[]) {
    super(location, [])
    this._type = this.constructor.name
    this._options = options
    this._contents = contents
  }

  options(): TikzOption[] {
    return this._options
  }

  contents(): TikzPath[] {
    return this._contents
  }
}

export class TikzPicture extends AstNode {
  _options: TikzOption[]
  _contents: TikzPath[]
  constructor(location: AstLocation, options: TikzOption[], contents: TikzPath[]) {
    super(location, [])
    this._type = this.constructor.name
    this._options = options
    this._contents = contents
  }

  options(): TikzOption[] {
    return this._options
  }

  contents(): TikzPath[] {
    return this._contents
  }
}
