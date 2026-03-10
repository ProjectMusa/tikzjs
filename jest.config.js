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
  moduleNameMapper: {
    // Only strip .js extension from relative imports (./foo.js, ../bar.js)
    // NOT from node_modules paths
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
}
