/** @type {import('eslint').Linter.Config} */
module.exports = {
  parserOptions: {
    sourceType: 'module',
    ecmaVersion: 'latest',
  },
  overrides: [
    {
      files: ['__tests__/**'],
      env: {jest: true},
    },
  ],
}
