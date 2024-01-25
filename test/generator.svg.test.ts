// /**
//  * @jest-environment jsdom
//  */
import { runWorker } from '../src/main'
import { generator_svg } from '../src/generators/Generator'
import { TikzRoot } from '../src/parser/TikzRoot'

test('svg_path_-|_test', () => {
  const ast = runWorker('\\tikz[]{\\path[draw](0,0)-|++(1,1 cm)--++(2,2cm);}')
  const result = generator_svg.generate(ast as TikzRoot)
  console.log(result[0].outerHTML)
  expect(result)
})

test('svg_grid_test', () => {
  const ast = runWorker('\\tikz[]{\\path[draw](0,0) grid (1,1 cm) -- ++(2,2cm);}')
  const result = generator_svg.generate(ast as TikzRoot)
  console.log(result[0].outerHTML)
  expect(result)
})

test('svg_quadratic_bezier_test', () => {
  const ast = runWorker('\\tikz[]{\\path[draw](0,0) .. controls (1,1 cm) .. ++(2,0cm);}')
  const result = generator_svg.generate(ast as TikzRoot)
  console.log(result[0].outerHTML)
  expect(result)
})

test('svg_cubic_bezier_test', () => {
  const ast = runWorker('\\tikz[]{\\path[draw](0,0) .. controls (1,1 cm) and (2,1) .. ++(3,0cm);}')
  const result = generator_svg.generate(ast as TikzRoot)
  console.log(result[0].outerHTML)
  expect(result)
})

test('svg_node_latex_test', () => {
  const ast = runWorker('\\tikz[]{\\path[draw](0,0) .. controls (1,1 cm) and (2,1) .. node[]{$x^2$} ++(3,0cm);}')
  const result = generator_svg.generate(ast as TikzRoot)
  console.log(result[0].outerHTML)
  expect(result)
})
