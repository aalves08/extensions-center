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

import { BundleCause } from '../utils/bundleCause';

export type { BundleCause };

/** One extension at one released version: the unit both pipelines work on. */
export interface AnalysisTarget {
  /** Chart name — the `pkg/` directory, and the directory used on gh-pages */
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
  /**
   * False for an extension found in a repo's `pkg/` but absent from
   * rancher/ui-plugin-charts `manifest.json`.
   *
   * It is built and published like its siblings; it is simply not in the
   * official catalogue yet, which is a fact about the catalogue rather than
   * about the extension — so it is analysed and labelled, not hidden.
   */
  inManifest: boolean;
  /**
   * Repo-relative prefixes holding the source this extension ships.
   *
   * More than one when the repo has shared private `pkg/` directories, which
   * every sibling bundles a copy of. Empty when the layout could not be read,
   * leaving the import scan to infer a root from the file tree.
   */
  sourceRoots: string[];
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
  /** See `AnalysisTarget.inManifest` — the table marks these rows */
  inManifest: boolean;
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
  /** Who put it in the bundle, and therefore whose fix it is */
  cause: BundleCause;
  /**
   * Versions this package resolved to in the extension's lockfile.
   *
   * Empty when the lockfile could not be read, or when the name is one of the
   * synthetic ones (`webpack-runtime`, `externalized`, own code) that never
   * appears in a lockfile. Several entries means the lockfile really did
   * resolve it more than once.
   */
  versions: string[];
}

export interface BundleCategoryTotal {
  category: BundleCategory;
  bytes: number;
  files: number;
}

/** One row of the "why is this in the bundle" table. */
export interface BundleCauseTotal {
  cause: BundleCause;
  bytes: number;
  files: number;
  packages: number;
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
  /** See `AnalysisTarget.inManifest` — the table marks these rows */
  inManifest: boolean;
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
  byCause: BundleCauseTotal[] | null;
  byPackage: BundlePackage[] | null;
  leaks: BundleLeaks | null;
  /**
   * Measured source bytes, the denominator of `ratio`.
   *
   * Pre-minification and pre-compression, so meaningless as a size on its own
   * and never rendered. It exists to be divided into `totalBundleBytes`.
   */
  totalSourceBytes: number;
  /**
   * `totalBundleBytes / totalSourceBytes`, or null when either is missing.
   *
   * Multiply any source-byte figure by this to get what a browser actually
   * downloads for it. Per-bundle rather than global because the measured
   * spread across the published bundles is 0.2971 to 0.6619 — a 2.2× range, so
   * one shared constant would be wrong for almost every extension.
   */
  ratio: number | null;
  /** Source bytes whose cause is shell's to fix; see `SHELL_CAUSED` */
  shellCausedBytes: number;
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
export interface ProgressState {
  done: number;
  total: number;
  /** Item currently being worked on, when the job has one */
  label?: string;
}

export interface AnalysisProgress extends ProgressState {
  phase: 'targets' | 'modules' | 'listing' | 'sources' | 'maps' | 'saving';
}
