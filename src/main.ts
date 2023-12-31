import { SyntaxError, parse } from './tikzjs'

console.log(parse('1+1', {}))

module.exports = {
  parse: (s: string) => {
    return parse(s, {})
  },
}
