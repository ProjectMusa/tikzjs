/**
 * @jest-environment jsdom
 */
import { runWorker } from '../src/main'
import { generator_svg } from '../src/generators/Generator'
import { TikzRoot } from '../src/parser/TikzRoot'

test('svg_path_-|_test', () => {
  const ast = runWorker('\\tikz[]{\\path[draw](0,0)-|++(1,1 cm)--++(2,2cm);}')
  const result = generator_svg.generate(ast as TikzRoot)
  console.log(JSON.stringify(result))
  console.log(result[0].outerHTML)
  expect(result)
})
