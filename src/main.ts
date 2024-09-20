import { JSDOM } from 'jsdom'

const window = new JSDOM(``).window
global.document = window.document

import { TikzRoot } from './parser/TikzRoot'
import { parse } from './parser/_tikzjs'
import { generator_svg } from './generators/Generator'
import * as fs from 'fs'
export function runWorker(s: string): Object {
  return parse(s, {}) as TikzRoot
}

export function Generate(s: string): string {
  const ast = runWorker(s)
  const result = generator_svg.generate(ast as TikzRoot)
  return result[0].outerHTML
}

if (require.main === module) {
  // Uncomment to compile ./test/test.btx to ./test/test.html
  let strTikz = fs.readFileSync('./sample/test.tikz', 'utf8')
  const ast = runWorker(strTikz)
  const result = generator_svg.generate(ast as TikzRoot)
  fs.writeFileSync('./sample/test.svg', result[0].outerHTML)
}
