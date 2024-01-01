import { SyntaxError, parse as _parse } from './tikzjs'

export class Parser {
  name: 'parser' = 'parser'
  rawText?: string
  ast?: any
  output?: string

  constructor() {}

  parse(s: string) {
    this.rawText = s
    _parse(s, {})
  }

  getRawText() {
    return this.rawText
  }

  getAST() {
    return this.ast
  }
}
