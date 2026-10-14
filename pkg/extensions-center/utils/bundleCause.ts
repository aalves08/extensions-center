/**
 * Who caused a package to be inside an extension's bundle.
 *
 * `classifySource` in `sourceMapStats` answers *where a file came from*, which
 * is enough to draw a treemap and not enough to fix anything. This answers
 * *who put it there*, which is the only version that maps onto an owner and a
 * change.
 *
 * The distinction matters most for what used to be one undifferentiated
 * `external-lib` bucket. A third-party library inside a bundle can be there
 * for four quite different reasons — the extension imported it, shell imported
 * it, shell's webpack config injected it, or a build-time loader leaked into
 * the module graph — and each has a different fix in a different repository.
 *
 * Ported from `14-duplication.mjs` in the shell-ext-analysis project, which
 * measured these against `@rancher/shell` 3.0.13 and the ten published bundles
 * then on gh-pages. The one thing not ported is its use of shell's internal
 * import graph to decide what shell imports: building that graph needs every
 * shell source file, so this uses shell's declared `dependencies` instead. The
 * substitution is safe in the direction that matters — a package can only be
 * in a bundle because something imported it, so a declared dependency found in
 * a bundle really was pulled in by shell.
 */

/**
 * Why a package is in the bundle, and therefore whose problem it is.
 *
 * The first six are shell-caused and recoverable without any extension author
 * changing a line of code; see `SHELL_CAUSED`.
 */
export type BundleCause =
  | 'shell-code'
  | 'shell-dep'
  | 'shell-dep-transitive'
  | 'node-polyfill'
  | 'build-tooling'
  | 'already-external'
  | 'extension-code'
  | 'extension-dep'
  | 'generated'
  | 'webpack-runtime'
  | 'externalized';

/** Shell's own compiled code, including the components it vendors. */
const SHELL_CODE = new Set(['@rancher/shell', '@rancher/components']);

/**
 * Node core shims.
 *
 * These are in every bundle because shell's own `pkg/vue.config.js`
 * unconditionally registers `NodePolyfillPlugin`, whose `ProvidePlugin`
 * injects `Buffer`, `process` and `console` into every build whether anything
 * asked for them or not — and `assert` drags in `util`, which drags in the
 * es-abstract helper cluster that makes up most of the list below.
 *
 * Measured at 1.03 MB on disk across the ten published bundles, spread over 58
 * packages, none individually large enough to notice.
 */
const POLYFILLS = new Set([
  'assert', 'util', 'buffer', 'process', 'console-browserify', 'events', 'url',
  'stream-http', 'https-browserify', 'string_decoder', 'punycode', 'querystring-es3',
  'inherits', 'base64-js', 'ieee754', 'safe-buffer', 'util-deprecate',
  'builtin-status-codes', 'xtend', 'readable-stream', 'domain-browser',
  'os-browserify', 'path-browserify', 'tty-browserify', 'vm-browserify',
  'browserify-zlib', 'crypto-browserify', 'stream-browserify', 'timers-browserify',
  'constants-browserify',
  // es-abstract helper cluster, reached via assert -> util
  'get-intrinsic', 'call-bind', 'call-bound', 'call-bind-apply-helpers', 'function-bind',
  'has-symbols', 'has-proto', 'has-tostringtag', 'has-property-descriptors', 'hasown',
  'define-properties', 'define-data-property', 'set-function-length', 'es-define-property',
  'es-errors', 'es-object-atoms', 'gopd', 'get-proto', 'dunder-proto', 'math-intrinsics',
  'object-keys', 'object.assign', 'object-is', 'object-inspect', 'is-nan', 'is-callable',
  'is-arguments', 'is-regex', 'is-typed-array', 'is-generator-function', 'generator-function',
  'which-typed-array', 'available-typed-arrays', 'possible-typed-array-names', 'for-each',
  'safe-regex-test', 'side-channel', 'side-channel-list', 'side-channel-map',
  'side-channel-weakmap',
]);

/**
 * Build-time code that ended up inside a runtime bundle.
 *
 * None of this executes in a browser. It is present because a loader or plugin
 * module got pulled into the module graph, which is a packaging accident
 * rather than a dependency decision.
 */
const BUILD_TOOLING = new Set([
  'node-polyfill-webpack-plugin', '@vue/cli-service', 'vue-loader', 'vue-style-loader',
  'css-loader', '@vue/test-utils', '@vue/devtools-api', '@vue/compiler-core',
  '@vue/compiler-dom', '@vue/server-renderer', '@vue/shared',
]);

/**
 * The five packages `pkg/vue.config.js` and `core/plugins-loader.js` already
 * externalise.
 *
 * Finding one inside a bundle means that bundle was built against a shell old
 * enough to predate the externalisation — so it is residue, cleared by a
 * rebuild and nothing else.
 */
const ALREADY_EXTERNAL = new Set(['vue', 'vue-router', 'jquery', 'jszip', 'js-yaml']);

/**
 * Transitive dependencies large enough to matter, mapped to the shell
 * dependency that pulls each one in.
 *
 * A fallback only. Nesting observed in the source map paths is better evidence
 * and is preferred where it exists — see `nestedUnder` in `classifyCause` —
 * but a hoisted dependency leaves no nesting to observe, and these are the
 * hoisted ones big enough to change a total. Each was verified against the
 * registry at the version shell pins (`npm view <pkg> dependencies`).
 */
const TRANSITIVE_PARENT: Record<string, string> = {
  'highlight.js':       'diff2html',
  'hogan.js':           'diff2html',
  tabbable:             'focus-trap',
  '@oozcitak/dom':      'xmlbuilder2',
  '@oozcitak/infra':    'xmlbuilder2',
  '@oozcitak/util':     'xmlbuilder2',
  '@oozcitak/url':      'xmlbuilder2',
  '@babel/runtime':     'jexl',
  'color-convert':      'color',
  'color-name':         'color',
  'color-string':       'color',
  'simple-swizzle':     'color',
  '@floating-ui/core':  'floating-vue',
  '@floating-ui/dom':   'floating-vue',
  '@floating-ui/utils': 'floating-vue',
  'lru-cache':          'semver',
  yallist:              'semver',
};

/**
 * Causes that are shell's to fix.
 *
 * The complement — `extension-code` and `extension-dep` — is the extension
 * author's own business, and the three bookkeeping causes belong to nobody.
 */
export const SHELL_CAUSED: ReadonlySet<BundleCause> = new Set<BundleCause>([
  'shell-code', 'shell-dep', 'shell-dep-transitive', 'node-polyfill', 'build-tooling',
  'already-external',
]);

/** Ordered worst-first, which is also the order the cause table renders in. */
export const CAUSES: readonly BundleCause[] = [
  'shell-code',
  'shell-dep',
  'shell-dep-transitive',
  'node-polyfill',
  'build-tooling',
  'already-external',
  'extension-code',
  'extension-dep',
  'generated',
  'webpack-runtime',
  'externalized',
];

export interface CauseInput {
  /** Package name, or `<ext> (own code)` for the extension's own sources */
  pkg: string;
  /**
   * Package this one was nested inside, from the source map path.
   *
   * `node_modules/foo/node_modules/bar` means npm could not hoist `bar`, which
   * is direct evidence that `foo` is what wanted it. Preferred over
   * `TRANSITIVE_PARENT` because it is observed rather than recorded.
   */
  nestedUnder?: string | null;
  /** Keys of `dependencies` in shell's own `package.json` */
  shellDeps: ReadonlySet<string>;
}

/**
 * Which of `CAUSES` a package falls under.
 *
 * Order is load-bearing. Build tooling and polyfills are checked before the
 * shell-dependency test because several of them are also declared in shell's
 * `package.json`, and the more specific cause carries the more specific fix.
 */
export function classifyCause({ pkg, nestedUnder, shellDeps }: CauseInput): BundleCause {
  if (SHELL_CODE.has(pkg)) {
    return 'shell-code';
  }

  if (pkg === '@rancher/auto-import') {
    return 'generated';
  }

  if (pkg === 'webpack-runtime') {
    return 'webpack-runtime';
  }

  if (pkg === 'externalized') {
    return 'externalized';
  }

  if (pkg.endsWith(' (own code)')) {
    return 'extension-code';
  }

  if (BUILD_TOOLING.has(pkg)) {
    return 'build-tooling';
  }

  if (POLYFILLS.has(pkg)) {
    return 'node-polyfill';
  }

  if (ALREADY_EXTERNAL.has(pkg)) {
    return 'already-external';
  }

  if (shellDeps.has(pkg)) {
    return 'shell-dep';
  }

  // Observed nesting first, then the recorded fallback for hoisted packages.
  const parent = nestedUnder || TRANSITIVE_PARENT[pkg];

  if (parent && shellDeps.has(parent)) {
    return 'shell-dep-transitive';
  }

  if (parent && POLYFILLS.has(parent)) {
    return 'node-polyfill';
  }

  if (parent && BUILD_TOOLING.has(parent)) {
    return 'build-tooling';
  }

  return 'extension-dep';
}

/** The parent recorded for a package, for display beside a transitive row. */
export function recordedParent(pkg: string): string | null {
  return TRANSITIVE_PARENT[pkg] || null;
}
