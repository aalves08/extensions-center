/**
 * Turning an import path into a file in rancher/dashboard, and that file into a
 * byte count.
 *
 * The Node pipeline this replaces resolved each path by fetching candidate URLs
 * until one returned 200 — six or more requests per path, several hundred paths.
 * Here the whole repo tree arrives in a single `git/trees?recursive=1` call with
 * a `size` on every blob, so resolution is a map lookup and the network cost is
 * one request instead of a thousand.
 */

/** Published as `@rancher/shell`, aliased `@shell` */
const SHELL_DIR = 'shell';

/** Published as `@rancher/components`, aliased `@components` */
const COMPONENTS_DIR = 'pkg/rancher-components/src';

/**
 * An import path → the files a bundler would try, in resolution order.
 *
 * The bare path comes first because plenty of imports already carry their
 * extension — `@shell/components/Loading.vue` is written exactly that way in
 * several extensions. Appending to those produces `Loading.vue.ts` and friends,
 * none of which exist, so the path gets reported as unresolved when the file is
 * sitting right there. For a genuinely extensionless path the bare entry simply
 * never matches a blob, so trying it first costs nothing.
 */
function withExtensions(base: string): string[] {
  return [
    base,
    `${ base }.ts`,
    `${ base }.js`,
    `${ base }.vue`,
    `${ base }/index.ts`,
    `${ base }/index.js`,
    `${ base }/index.vue`,
  ];
}

/** `@rancher/shell/utils/object` → `shell/utils/object.ts`, … */
export function shellCandidates(importPath: string): string[] {
  const sub = importPath.replace(/^@rancher\/shell\/?/, '').replace(/^@shell\/?/, '');

  return withExtensions(sub ? `${ SHELL_DIR }/${ sub }` : SHELL_DIR);
}

/**
 * `@rancher/components/Banner` → `pkg/rancher-components/src/components/Banner.vue`, …
 *
 * Two layouts are tried because the package is not laid out consistently: most
 * components sit under `src/components/`, but a handful are addressed directly
 * off `src/`.
 */
export function componentsCandidates(importPath: string): string[] {
  const sub = importPath.replace(/^@rancher\/components\/?/, '').replace(/^@components\/?/, '');

  if (!sub) {
    return withExtensions(COMPONENTS_DIR);
  }

  return [
    ...withExtensions(`${ COMPONENTS_DIR }/components/${ sub }`),
    ...withExtensions(`${ COMPONENTS_DIR }/${ sub }`),
  ];
}

/**
 * Size of the first candidate that exists in the tree.
 *
 * Null when none of them do, which is a real finding rather than an error: it
 * means the extension imports something the current dashboard branch no longer
 * has, so the page lists those separately.
 */
export function resolveSize(candidates: string[], sizes: Map<string, number>): number | null {
  for (const candidate of candidates) {
    const bytes = sizes.get(candidate);

    if (bytes !== undefined) {
      return bytes;
    }
  }

  return null;
}
