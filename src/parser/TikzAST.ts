export interface AstLocation {
  start?: {
    offset?: number
    line?: number
    column?: number
  }
  end?: {
    offset?: number
    line?: number
    column?: number
  }
}

interface AstLocatable {
  location(): AstLocation
  parent(): AstLocatable | undefined
  children(): AstLocatable[]
}

export class AstNode implements AstLocatable {
  _location: AstLocation
  _parent: AstNode | undefined
  _children: AstNode[]
  constructor(location: AstLocation, children: AstNode[]) {
    this._location = location
    this._parent = undefined
    this._children = children
    this._children.forEach((child) => {
      child._parent = this
    })
  }

  location() {
    return this._location
  }

  parent(): AstNode | undefined {
    return this._parent
  }

  children(): AstNode[] {
    return this._children
  }
}
