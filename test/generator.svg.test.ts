import { generate } from '../src/index'

test('svg_path_-|_test', () => {
  const result = generate('\\tikz[]{\\path[draw](0,0)-|++(1,1 cm)--++(2,2cm);}')
  console.log(result)
  expect(result)
})

test('svg_grid_test', () => {
  const result = generate('\\tikz[]{\\path[draw](0,0) grid (1,1 cm) -- ++(2,2cm);}')
  console.log(result)
  expect(result)
})

test('svg_quadratic_bezier_test', () => {
  const result = generate('\\tikz[]{\\path[draw](0,0) .. controls (1,1 cm) .. ++(2,0cm);}')
  console.log(result)
  expect(result)
})

test('svg_cubic_bezier_test', () => {
  const result = generate('\\tikz[]{\\path[draw](0,0) .. controls (1,1 cm) and (2,1) .. ++(3,0cm);}')
  console.log(result)
  expect(result)
})

test('svg_node_latex_test', () => {
  const result = generate('\\tikz[]{\\path[draw](0,0) .. controls (1,1 cm) and (2,1) .. node[]{$x^2$} ++(3,0cm);}')
  console.log(result)
  expect(result)
})

test('svg_node_alias_test', () => {
  const result = generate(
    '\\tikz[]{\\path[draw] node (a) at (0, 0) {$zx\\ \\left(\\begin{pmatrix} x & y \\\\ z & w \\end{pmatrix} \\right.$};\n \\path[draw] (1,1) -- (a);}',
  )
  console.log(result)
  expect(result)
})

test('svg_node_alias_anchor_test', () => {
  const result = generate(
    '\\tikz[]{\\path[draw] node (a) at (0, 0) {$zx\\ \\left(\\begin{pmatrix} x & y \\\\ z & w \\end{pmatrix} \\right.$};\n \\path[draw] (a.east) -- (a.west);}',
  )
  console.log(result)
  expect(result)
})

test('svg_arrow_test', () => {
  const result = generate('\\tikz[]{\\path[draw, <->] (0,0) -- (1,1);}')
  console.log(result)
  expect(result)
})
