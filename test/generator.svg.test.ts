// /**
//  * @jest-environment jsdom
//  */
import { runWorker } from '../src/main'
import { generator_svg } from '../src/generators/Generator'
import { TikzRoot } from '../src/parser/TikzRoot'
import { Generate } from '..'

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

test('svg_node_alias_test', () => {
  const ast = runWorker(
    '\\tikz[]{\\path[draw] node (a) at (0, 0) {$zx\\ \\left(\\begin{pmatrix} x & y \\\\ z & w \\end{pmatrix} \\right.$};\n \\path[draw] (1,1) -- (a);}',
  )
  const result = generator_svg.generate(ast as TikzRoot)
  console.log(result[0].outerHTML)
  expect(result)
})

test('svg_node_alias_anchor_test', () => {
  const ast = runWorker(
    '\\tikz[]{\\path[draw] node (a) at (0, 0) {$zx\\ \\left(\\begin{pmatrix} x & y \\\\ z & w \\end{pmatrix} \\right.$};\n \\path[draw] (a.east) -- (a.west);}',
  )
  const result = generator_svg.generate(ast as TikzRoot)
  console.log(result[0].outerHTML)
  expect(result)
})

test('svg_arrow_test', () => {
  let result = Generate('\\tikz[]{\\path[draw, <->] (0,0) -- (1,1);}')
  console.log(result)
  expect(result)
})
