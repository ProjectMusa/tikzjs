import { defineConfig, Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

/**
 * Transform bare require() calls in tikzjs source files into ESM imports.
 * Only targets the specific require patterns used in the tikzjs source tree.
 */
function requireToImport(): Plugin {
  return {
    name: 'tikzjs-require-to-import',
    enforce: 'pre',
    transform(code, id) {
      // Only transform tikzjs source files (not node_modules)
      if (!id.includes('/src/') || id.includes('node_modules')) return null
      if (!code.includes('require(')) return null

      let transformed = code

      // For the Peggy-generated parser (_tikzjs.js), do a full CJS→ESM conversion:
      // - require('./xxx') → import * as xxx from "./xxx"
      // - module.exports = { ... } → export { ... }
      if (id.endsWith('_tikzjs.js')) {
        // require('./xxx') → import
        transformed = transformed.replace(
          /const\s+(\w+)\s*=\s*require\(['"]\.\/([^'"]+)['"]\)\s*;?/g,
          'import * as $1 from "./$2"',
        )
        // module.exports = { SyntaxError: peg$SyntaxError, parse: peg$parse };
        transformed = transformed.replace(
          /module\.exports\s*=\s*\{([^}]+)\}\s*;?/,
          (_match, body: string) => {
            const entries = body
              .split(',')
              .map((e: string) => e.trim())
              .filter(Boolean)
              .map((e: string) => {
                const [key, val] = e.split(':').map((s: string) => s.trim())
                return key === val ? key : `${val} as ${key}`
              })
            return `export { ${entries.join(', ')} };`
          },
        )
        // Remove "use strict" (not needed in ESM)
        transformed = transformed.replace(/^"use strict";\s*/m, '')

        if (transformed !== code) {
          return { code: transformed, map: null }
        }
        return null
      }

      // require('./_tikzjs.js') → import (for parser/index.ts)
      transformed = transformed.replace(
        /const\s+(\w+)\s*=\s*require\(['"]\.\/([^'"]+)['"]\)/g,
        'import * as $1 from "./$2"',
      )

      // require('bezier-js') → import
      transformed = transformed.replace(
        /const\s+(\w+)\s*=\s*\(\(\)\s*=>\s*\{\s*try\s*\{\s*return\s+require\(['"]bezier-js['"]\)\s*\}\s*catch\s*\{\s*return\s+null\s*\}\s*\}\)\(\)/g,
        'import * as $1Module from "bezier-js"\nconst $1 = $1Module',
      )

      // require('jsdom') inside lazy function → stub (never called in browser)
      transformed = transformed.replace(
        /const\s*\{\s*JSDOM\s*\}\s*=\s*require\(['"]jsdom['"]\)/g,
        'const { JSDOM } = { JSDOM: class {} }',
      )

      // require('mathjax-full/js/adaptors/jsdomAdaptor.js') → stub
      transformed = transformed.replace(
        /const\s*\{\s*jsdomAdaptor\s*\}\s*=\s*require\(['"]mathjax-full\/js\/adaptors\/jsdomAdaptor\.js['"]\)/g,
        'const { jsdomAdaptor } = { jsdomAdaptor: () => null }',
      )

      // Remaining mathjax requires inside getMathJax() — stub them
      // (the browser uses browserMath.ts, so the Node getMathJax() is never called)
      transformed = transformed.replace(
        /const\s*\{\s*(\w+)\s*\}\s*=\s*require\(['"]mathjax-full\/js\/([^'"]+)['"]\)/g,
        'const { $1 } = { $1: null }',
      )

      if (transformed !== code) {
        return { code: transformed, map: null }
      }
      return null
    },
  }
}

export default defineConfig({
  plugins: [requireToImport(), react()],
  base: '/tikzjs/',
  build: {
    outDir: '../gh-pages',
    emptyOutDir: false,
  },
  resolve: {
    alias: {
      tikzjs: path.resolve(__dirname, '../src/index.ts'),
      jsdom: path.resolve(__dirname, 'src/lib/jsdomStub.ts'),
    },
  },
})
