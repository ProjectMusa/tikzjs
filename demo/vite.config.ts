import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  base: '/tikzjs/',
  build: {
    outDir: '../gh-pages',
    emptyOutDir: false,
  },
  resolve: {
    alias: {
      // Prevent Vite from bundling Node.js-only jsdom
      jsdom: path.resolve(__dirname, 'src/lib/jsdomStub.ts'),
      // Resolve tikzjs source directly
      'tikzjs': path.resolve(__dirname, '../src'),
    },
  },
  optimizeDeps: {
    exclude: ['jsdom'],
  },
})
