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

if (require.main === module) {
  // Uncomment to compile ./test/test.btx to ./test/test.html
  let strTikz = fs.readFileSync('./sample/test.tikz', 'utf8')
  const ast = runWorker(strTikz)
  const result = generator_svg.generate(ast as TikzRoot)
  console.log(JSON.stringify(result))
  console.log(result[0].outerHTML)
  fs.writeFileSync('./sample/test.svg', result[0].outerHTML)
}
