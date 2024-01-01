import { runWorker } from '../src/main'

test('simple_test', () => {
  const result = {
    res: runWorker('\\tikz[option , option ]{}'),
  }
  console.log(JSON.stringify(result))
  expect(result)
})
