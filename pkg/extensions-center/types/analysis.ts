/**
 * Data models for the two analysis pages.
 *
 * Both answer a version of the same question — how much of `@rancher/shell` an
 * extension actually pulls in — from opposite ends. Import analysis reads the
 * *source* at a released tag and counts what it asks for. Bundle analysis reads
 * the *built* output on `gh-pages` and reports what survived tree-shaking and
 * externalization. They disagree in interesting ways, which is the point of
 * having both.
 */

/** One extension at one released version: the unit both pipelines work on. */
export interface AnalysisTarget {
  /** Chart name — the manifest key, and the directory name used on gh-pages */
  name: string;
  /** `owner/name` */
  repo: string;
  /** Release tag exactly as GitHub reports it, e.g. `kubewarden-4.2.1` */
  tag: string;
  /** Bare semver pulled out of the tag, e.g. `4.2.1` */
  semver: string;
  /** Git ref the sources are read at */
  ref: string;
  /** Where the version came from, so the UI can admit when it is a guess */
  source: 'release' | 'tag' | 'branch';
}

// ─── Import analysis ─────────────────────────────────────────────────────────

/**
 * Where an import points.
 *
 * `components` covers every `@rancher/*` package that is not shell, plus the
 * `@components` webpack alias. Grouping them is deliberate: in practice the
 * non-shell `@rancher/*` surface an extension touches is almost entirely
 * `@rancher/components`, and splitting out the handful of `@rancher/auto-import`
 * lines would mean a table with one row in it.
 */
export type ImportKind = 'shell' | 'components' | 'external' | 'internal';

/** One row of the per-extension totals table. */
export interface ExtensionImportTotals {
  name: string;
  repo: string;
  semver: string;
  /** Source files that contained at least one import */
  fileCount: number;
  shell: number;
  components: number;
  external: number;
  internal: number;
  uniqueShellPaths: number;
  /** Summed source bytes behind every shell path it imports, resolved ones only */
  shellBytes: number;
  componentsBytes: number;
  /** Set when this extension could not be read, so the row can explain itself */
  error?: string;
}

/** An import path aggregated across every extension that uses it. */
export interface AggregateImportPath {
  path: string;
  total: number;
  /** Extension names, so the table can say who uses it */
  exts: string[];
  /**
   * Raw source bytes of the matching file in rancher/dashboard.
   *
   * Null means the path did not resolve to anything in the repo — a wrong path,
   * a private internal, or an API that has since been removed. Those are worth
   * seeing on their own, so the page lists them separately.
   */
  bytes: number | null;
}

/** One import path as used by a single extension. */
export interface ExtensionImportPath {
  path: string;
  count: number;
  /** Deduped named specifiers. Only collected for shell imports. */
  specifiers?: string[];
  bytes?: number | null;
}

export interface ExtensionImportDetail {
  shell: ExtensionImportPath[];
  components: ExtensionImportPath[];
  external: ExtensionImportPath[];
}

export interface ImportAnalysisDoc {
  /** Matches `IMPORT_ANALYSIS_CACHE_VERSION`; anything else is discarded */
  version: number;
  fetchedAt: string;
  /** Branch of rancher/dashboard the module sizes were resolved against */
  dashboardRef: string;
  totals: ExtensionImportTotals[];
  shellPaths: AggregateImportPath[];
  componentsPaths: AggregateImportPath[];
  externalPkgs: AggregateImportPath[];
  /** Per-extension breakdown, keyed by extension name */
  detail: Record<string, ExtensionImportDetail>;
}

// ─── Bundle analysis ─────────────────────────────────────────────────────────

/**
 * What a file in a source map turned out to be.
 *
 * `shell`, `components` and `host-provided` are all failures: the host supplies
 * those at runtime, so finding them inside an extension's bundle means they
 * were shipped twice.
 */
export type BundleCategory =
  | 'shell'
  | 'components'
  | 'host-provided'
  | 'extension-code'
  | 'external-lib'
  | 'externalized'
  | 'webpack-runtime';

export interface BundleChunk {
  name: string;
  bytes: number;
}

export interface BundlePackage {
  pkg: string;
  category: BundleCategory;
  bytes: number;
  files: number;
}

export interface BundleCategoryTotal {
  category: BundleCategory;
  bytes: number;
  files: number;
}

/** Packages that should have been externalized but were bundled anyway. */
export interface BundleLeaks {
  shellFiles: number;
  componentsFiles: number;
  hostPkgs: string[];
}

export interface ExtensionBundle {
  name: string;
  repo: string;
  semver: string;
  /** Path on gh-pages, null when nothing is published there */
  pluginDir: string | null;
  chunkCount: number;
  /** Minified JS across every code-split chunk */
  totalBundleBytes: number;
  chunks: BundleChunk[];
  hasSourceMaps: boolean;
  /**
   * Null when the source maps were not read.
   *
   * Chunk sizes come free with the directory listing, but the per-package
   * breakdown costs tens of megabytes of downloads, so the two are fetched in
   * one pass and this stays null if that pass found no usable maps.
   */
  byCategory: BundleCategoryTotal[] | null;
  byPackage: BundlePackage[] | null;
  leaks: BundleLeaks | null;
  /** Set when the plugin directory could not be read at all */
  error?: string;
}

export interface BundleAnalysisDoc {
  /** Matches `BUNDLE_ANALYSIS_CACHE_VERSION`; anything else is discarded */
  version: number;
  fetchedAt: string;
  extensions: ExtensionBundle[];
}

// ─── Shared UI plumbing ──────────────────────────────────────────────────────

/**
 * Progress for a rebuild in flight.
 *
 * Both rebuilds run for minutes. A spinner with no detail on a five-minute job
 * is indistinguishable from a hang, so every phase reports a count.
 */
export interface AnalysisProgress {
  phase: 'targets' | 'modules' | 'listing' | 'sources' | 'maps' | 'saving';
  done: number;
  total: number;
  /** Extension currently being worked on, when the phase has one */
  label?: string;
}
