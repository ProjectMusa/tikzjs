/* eslint-disable no-undef */
module.exports = {
    root: true,
    parserOptions: {
      parser: '@typescript-eslint/parser', // for .ts
    },
    plugins: ['@typescript-eslint'],
    extends: [
      'eslint:recommended',
      'plugin:vue/vue3-recommended',
      'plugin:prettier/recommended',
      'prettier',
      'plugin:@typescript-eslint/recommended',
    ],
  }