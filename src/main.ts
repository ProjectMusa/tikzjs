import { TikzRoot } from './parser/TikzRoot'
import { parse } from './parser/_tikzjs'

export function runWorker(s: string): Object {
  return parse(s, {}) as TikzRoot
}
