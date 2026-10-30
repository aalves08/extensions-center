/**
 * Flat ESLint config.
 *
 * The ruleset lives in `@rancher/shell` so it stays in step with the dashboard's
 * own linting; this file only re-exports it plus anything specific to this repo.
 */
import shellConfig from '@rancher/shell/eslint.config.base.mjs';

export default [
  ...shellConfig,
  {
    ignores: [
      'dist/**',
      'dist-pkg/**',
      'node_modules/**',
    ],
  },
  {
    // The shell's ruleset is written for extension source, which runs in a
    // browser and has no test runner in scope. Jest injects its globals rather
    // than exporting them, so without this every `describe`/`it`/`jest` in the
    // suite is an undefined variable.
    files:           ['**/__tests__/**/*.{js,ts}', '**/*.test.{js,ts}', 'jest/**/*.js'],
    languageOptions: {
      globals: {
        afterAll:    'readonly',
        afterEach:   'readonly',
        beforeAll:   'readonly',
        beforeEach:  'readonly',
        describe:    'readonly',
        expect:      'readonly',
        it:          'readonly',
        jest:        'readonly',
        test:        'readonly',
      },
    },
  },
];
