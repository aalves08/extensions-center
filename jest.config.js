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

  // Without this, jsdom makes jest prefer each package's `browser` export. For
  // `@vue/test-utils` that is an IIFE bundle expecting a global `Vue`, so
  // merely requiring it throws `ReferenceError: Vue is not defined`. Asking for
  // the `node` condition gets the CommonJS build, which imports Vue properly.
  testEnvironmentOptions: { customExportConditions: ['node'] },

  roots:     ['<rootDir>/pkg'],
  // Both conventions: a `__tests__` folder beside the code, or a `.test.ts`
  // sitting next to the file it covers.
  testMatch: ['**/__tests__/**/*.test.ts', '**/*.test.ts'],

  moduleFileExtensions: ['ts', 'js', 'json', 'vue'],

  transform: {
    // `configFile`/`babelrc` off on purpose. The root `babel.config.js` just
    // re-exports the shell's, which is a *build* config: it loads plugins such
    // as `babel-plugin-transform-require-context` that only exist among the
    // shell's own devDependencies and so are not installed here. The presets
    // below are everything a test needs, and leaving the root config out keeps
    // the transform from depending on packages this project never declares.
    '^.+\\.ts$': ['babel-jest', {
      configFile: false,
      babelrc:    false,
      presets:    [
        ['@babel/preset-env', { targets: { node: 'current' } }],
        '@babel/preset-typescript',
      ],
    }],
    '^.+\\.js$': ['babel-jest', {
      configFile: false,
      babelrc:    false,
      presets:    [['@babel/preset-env', { targets: { node: 'current' } }]],
    }],
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
