import { SyntaxError, parse } from './parser/tikzjs'

export function runWorker(s: string): Object {
  return parse(s, {})
}
