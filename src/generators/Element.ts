import { AstNode } from '../parser/TikzAST'
import { TikzRoot } from '../parser/TikzRoot'
import { Context } from './Context'

export interface ElementInterface {
  render(): HTMLElement[]
}
