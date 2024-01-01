interface AstLocation {
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

class AstNode implements AstLocatable {
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

  parent(): AstLocatable | undefined {
    return this._parent
  }

  children(): AstLocatable[] {
    return this._children
  }
}

export class TikzRoot extends AstNode {
  _inline: boolean = false
  _options: AstNode[]
  _content: AstNode
  constructor(location: AstLocation, inline: boolean, option_list: AstNode, content: AstNode) {
    super(location, [option_list, content])
    this._inline = inline
    this._options = [...option_list.children()] as AstNode[]
    this._content = content
  }
}
