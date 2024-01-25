import { runWorker } from '../src/main'

const beautifyReplacer = () => {
  const seen = new WeakSet()
  return (key: string, value: any) => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) {
        return
      }
      seen.add(value)
    }
    if (key === '_location') {
      return
    }
    if (key === '_children' && value.length === 0) {
      return
    }
    return value
  }
}

const tabsize = 2

test('empty_tikz_test', () => {
  const result = runWorker('\\tikz{}')
  console.log(JSON.stringify(result, beautifyReplacer(), tabsize))
  expect(result)
})

test('empty_tikz_test_1', () => {
  const result = runWorker('\\tikz[]{}')
  console.log(JSON.stringify(result, beautifyReplacer(), tabsize))
  expect(result)
})

test('empty_tikzpicture_test', () => {
  const result = runWorker('\\begin{tikzpicture}\\end{tikzpicture}')
  console.log(JSON.stringify(result, beautifyReplacer(), tabsize))
  expect(result)
})

test('empty_tikzpicture_test_1', () => {
  const result = runWorker('\\begin{tikzpicture}[]\\end{tikzpicture}')
  console.log(JSON.stringify(result, beautifyReplacer(), tabsize))
  expect(result)
})

test('path_null_test', () => {
  const result = runWorker('\\begin{tikzpicture}[]\\path[draw];\\end{tikzpicture}')
  console.log(JSON.stringify(result, beautifyReplacer(), tabsize))
  expect(result)
})

test('path_--_test', () => {
  const result = runWorker('\\begin{tikzpicture}[]\\path[draw](0,0)--(1,1);\\end{tikzpicture}')
  console.log(JSON.stringify(result, beautifyReplacer(), tabsize))
  expect(result)
})

test('path_-|_test', () => {
  const result = runWorker('\\tikz[]{\\path[draw](0,0)-|++(1,1 cm)--++(2,2cm);}')
  console.log(JSON.stringify(result, beautifyReplacer(), tabsize))
  expect(result)
})

test('grid_test', () => {
  const result = runWorker('\\tikz[]{\\path[draw](0,0) grid (1,1 cm) -- ++(2,2cm);}')
  console.log(JSON.stringify(result, beautifyReplacer(), tabsize))
  expect(result)
})

test('bezier_quadra_test', () => {
  const result = runWorker('\\tikz[]{\\path[draw](0,0).. controls  (1,1 cm) .. (2,2cm);}')
  console.log(JSON.stringify(result, beautifyReplacer(), tabsize))
  expect(result)
})

test('bezier_cubic_test', () => {
  const result = runWorker('\\tikz[]{\\path[draw](0,0).. controls  (1,1 cm) and (3,3) .. (2,2cm);}')
  console.log(JSON.stringify(result, beautifyReplacer(), tabsize))
  expect(result)
})

test('to_path_test', () => {
  const result = runWorker('\\tikz[]{\\path[draw](0,0) to[] (2,2cm);}')
  console.log(JSON.stringify(result, beautifyReplacer(), tabsize))
  expect(result)
})

test('node_latex_test', () => {
  const result = runWorker(
    '\\tikz[]{ \\path[draw](0,0) -- node[draw] {\\textcolor{red}{sd}$x^{\\frac{1}{2}}$} (2,2cm); }',
  )
  console.log(JSON.stringify(result, beautifyReplacer(), tabsize))
  expect(result)
})
