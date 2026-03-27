module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: 'tsconfig.test.json',
    }],
  },
  testMatch: [
    '**/test/**/*.test.ts',
  ],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/test/e2e/',
  ],
  moduleNameMapper: {
    // Only strip .js extension from relative imports (./foo.js, ../bar.js)
    // NOT from node_modules paths
    '^(\\.{1,2}/.*)\\.js$': '$1',
    // Stub D3 modules in Node.js tests — the D3 editor is browser-only
    '^d3-selection$': '<rootDir>/test/__mocks__/d3-stub.js',
    '^d3-drag$': '<rootDir>/test/__mocks__/d3-stub.js',
    '^d3-zoom$': '<rootDir>/test/__mocks__/d3-stub.js',
  },
}
