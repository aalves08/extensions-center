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
];
