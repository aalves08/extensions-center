/**
 * Jest for the extension package.
 *
 * Everything this needs — jest, jsdom, @vue/vue3-jest, @vue/test-utils — is
 * already installed as part of `@rancher/shell`, so there is nothing new in
 * `package.json` beyond the `test` script.
 *
 * The TypeScript transform is Babel rather than ts-jest: the shell does not
 * ship ts-jest, and these tests do not want type-checking at run time anyway —
 * `yarn typecheck` already covers that and does it over the whole package
 * rather than only the files a test happens to import.
 */
module.exports = {
  testEnvironment: 'jsdom',
  roots:           ['<rootDir>/pkg'],
  // Both conventions: a `__tests__` folder beside the code, or a `.test.ts`
  // sitting next to the file it covers.
  testMatch:       ['**/__tests__/**/*.test.ts', '**/*.test.ts'],

  moduleFileExtensions: ['ts', 'js', 'json', 'vue'],

  // There are no test files yet. Until there are, `yarn test` reporting "no
  // tests" as a failure is noise rather than a signal; remove this once the
  // suite exists so an empty run goes back to being an error.
  passWithNoTests: true,

  transform: {
    '^.+\\.ts$': ['babel-jest', {
      presets: [
        ['@babel/preset-env', { targets: { node: 'current' } }],
        '@babel/preset-typescript',
      ],
    }],
    '^.+\\.js$':  ['babel-jest', { presets: [['@babel/preset-env', { targets: { node: 'current' } }]] }],
    '^.+\\.vue$': '@vue/vue3-jest',
  },

  // The same aliases `tsconfig.json` declares, so an import reads identically
  // in a test and in the built extension.
  moduleNameMapper: {
    '^@shell/(.*)$':       '<rootDir>/node_modules/@rancher/shell/$1',
    '^@components/(.*)$':  '<rootDir>/node_modules/@rancher/shell/rancher-components/$1',
    '^@pkg/(.*)$':         '<rootDir>/pkg/$1',
    '\\.(css|scss|sass)$': '<rootDir>/jest/styleStub.js',
  },

  // Shell components are published as untranspiled source.
  transformIgnorePatterns: ['/node_modules/(?!@rancher/shell)'],

  setupFilesAfterEnv: ['<rootDir>/jest/setup.js'],

  collectCoverageFrom: [
    'pkg/extensions-center/**/*.{ts,vue}',
    '!pkg/extensions-center/**/__tests__/**',
    '!pkg/extensions-center/types/**',
  ],
};
