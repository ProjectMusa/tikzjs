import { JSDOM } from 'jsdom'

const window = new JSDOM(``).window
global.document = window.document

import { TikzRoot } from './parser/TikzRoot'
import { parse } from './parser/_tikzjs'
import { generator_svg } from './generators/Generator'

export function runWorker(s: string): Object {
  return parse(s, {}) as TikzRoot
}

if (require.main === module) {
  // Uncomment to compile ./test/test.btx to ./test/test.html
  const ast = runWorker('\\tikz[]{\\path[draw](0,0)-|++(1,1 cm)--++(2,2cm);}')
  const result = generator_svg.generate(ast as TikzRoot)
  console.log(JSON.stringify(result))
  console.log(result[0].outerHTML)
}
