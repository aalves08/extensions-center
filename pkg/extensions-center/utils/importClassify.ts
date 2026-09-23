import { ImportKind } from '../types/analysis';

/**
 * Sorting import specifiers into the four buckets the analysis counts.
 *
 * Extensions reach the same code by several names. `@shell/utils/object` and
 * `@rancher/shell/utils/object` are webpack alias and package path for one
 * file, and counting them as two entries would split every total in the report.
 * Normalising happens here so the rest of the pipeline only ever sees the
 * package form.
 */

/** Webpack aliases that resolve to @rancher/shell */
const SHELL_ALIAS = '@shell';
const SHELL_PKG = '@rancher/shell';

/** Webpack alias for pkg/rancher-components, published as @rancher/components */
const COMPONENTS_ALIAS = '@components';

/**
 * Scopes that look like npm packages but never are.
 *
 * `@pkg` is the shell's alias for the extension's own directory and `@common`
 * is a convention several extensions use for shared local code. Both would
 * otherwise show up in the external-dependency table as phantom packages.
 */
const ALWAYS_INTERNAL = new Set(['@common', '@pkg']);

/** `@scope/pkg/sub` → `@scope`, `pkg/sub` → `pkg` */
function scopeOf(source: string): string {
  return source.startsWith('@') ? `@${ source.slice(1).split('/')[0] }` : source.split('/')[0];
}

/** `@shell/utils/object` → `@rancher/shell/utils/object`, others unchanged. */
export function normaliseShellPath(source: string): string {
  if (source === SHELL_ALIAS || source.startsWith(`${ SHELL_ALIAS }/`)) {
    return `${ SHELL_PKG }${ source.slice(SHELL_ALIAS.length) }`;
  }

  return source;
}

/**
 * Where an import points, from the perspective of the extension doing it.
 *
 * `extName` is needed because an extension may alias its own source under its
 * own name (`@kubewarden/…`), which is internal despite looking scoped.
 */
export function classifyImport(source: string, extName: string): ImportKind {
  const scope = scopeOf(source);

  if (source.startsWith(SHELL_PKG) || scope === SHELL_ALIAS) {
    return 'shell';
  }

  if (source.startsWith('@rancher/') || scope === COMPONENTS_ALIAS) {
    return 'components';
  }

  if (source.startsWith('.') || source.startsWith('/')) {
    return 'internal';
  }

  const ownScopes = [`@${ extName }`, `@${ extName.replace(/-/g, '_') }`];

  if (ownScopes.includes(scope) || ALWAYS_INTERNAL.has(scope)) {
    return 'internal';
  }

  return 'external';
}

/**
 * The npm package an import belongs to.
 *
 * External dependencies are counted per package rather than per path — thirty
 * `lodash/…` imports are one dependency, and listing each subpath would bury
 * that.
 */
export function packageName(source: string): string {
  return source.startsWith('@') ? source.split('/').slice(0, 2).join('/') : source.split('/')[0];
}
