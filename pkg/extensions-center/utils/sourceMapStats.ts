import {
  BundleCategory, BundleCategoryTotal, BundleCauseTotal, BundleLeaks, BundlePackage
} from '../types/analysis';
import { utf8Length } from './bytes';
import { BundleCause, classifyCause, SHELL_CAUSED } from './bundleCause';

/**
 * Reading what actually shipped, out of the source maps published alongside a
 * built extension.
 *
 * A map's `sources` array names every file webpack pulled in and
 * `sourcesContent` holds each one's pre-minification text, so classifying the
 * paths and measuring the contents gives a per-package breakdown of the bundle
 * without ever downloading the bundle itself.
 *
 * This is an accumulator rather than a function over an array of maps because
 * the maps are big — harvester's largest single chunk map is 11MB, and all
 * eleven extensions together are around 98MB. Feeding them in one at a time
 * lets each be parsed, measured and dropped before the next arrives, so peak
 * memory is one map instead of all of them.
 */

/** Paths that mean the host's own shell leaked into the bundle. */
const SHELL_MARKERS = ['/@rancher/shell/', '/node_modules/@shell/'];

const COMPONENTS_MARKERS = [
  '/@rancher/components/',
  '/@rancher/ui-components/',
  '/node_modules/@components/',
];

/** Packages the host supplies at runtime; a second copy is dead weight. */
const HOST_PKGS = ['vue', 'pinia', 'vue-router', '@vue/'];

const WEBPACK_MARKERS = ['webpack/runtime', '(webpack)', 'webpack-dev', '|webpack'];

/** The package name immediately after one `node_modules/`, scoped or not. */
const NODE_MODULES_PKG = /^((?:@[^/]+\/[^/]+)|(?:[^@/][^/]*))/;

export interface SourceClass {
  category: BundleCategory;
  pkg: string;
  /**
   * Package this one was nested inside, where the path shows nesting.
   *
   * Only set for `node_modules/a/node_modules/b`, which is npm saying it could
   * not hoist `b` — direct evidence that `a` is what wanted it. `null` for the
   * hoisted majority, where the path records no relationship at all.
   */
  nestedUnder?: string | null;
}

/**
 * The innermost package in a path, plus whatever it was nested under.
 *
 * `node_modules/webpack/node_modules/acorn/dist/acorn.js` is acorn's code, not
 * webpack's, and attributing those bytes to webpack would be wrong twice over:
 * the treemap would blame the wrong package, and a vulnerability feed looking
 * for acorn would not find it. So the search starts from the last
 * `node_modules/` and works out, rather than matching the first one.
 */
function innermostPackage(path: string): { pkg: string; nestedUnder: string | null } | null {
  const MARKER = 'node_modules/';
  const last = path.lastIndexOf(MARKER);

  if (last < 0) {
    return null;
  }

  const inner = NODE_MODULES_PKG.exec(path.slice(last + MARKER.length));

  if (!inner) {
    return null;
  }

  // One level out only. Deeper ancestry exists but adds nothing: the immediate
  // parent is the one that declared the dependency.
  const before = path.slice(0, last);
  const prev = before.lastIndexOf(MARKER);
  const outer = prev < 0 ? null : NODE_MODULES_PKG.exec(before.slice(prev + MARKER.length));

  return { pkg: inner[1], nestedUnder: outer ? outer[1] : null };
}

/**
 * What one entry in a map's `sources` array is.
 *
 * Both the normalised and the raw path are checked: normalising strips the
 * `webpack://` prefix that some markers rely on, while the shell and components
 * markers need the leading slash the raw form still has.
 */
export function classifySource(rawPath: string, extName: string): SourceClass {
  const path = rawPath
    .replace(/^webpack:\/\/[^/]*\//, '')
    .replace(/^\/_+\//, '')
    .replace(/^\/+/, '')
    .replace(/\?.*$/, '');

  // `external "vue"` — webpack recorded it but left it out of the bundle. Good.
  if (path.startsWith('external ') || path.includes(' external ')) {
    return { category: 'externalized', pkg: 'externalized' };
  }

  if (WEBPACK_MARKERS.some((m) => path.includes(m))) {
    return { category: 'webpack-runtime', pkg: 'webpack-runtime' };
  }

  if (SHELL_MARKERS.some((m) => rawPath.includes(m))) {
    return { category: 'shell', pkg: '@rancher/shell' };
  }

  if (COMPONENTS_MARKERS.some((m) => rawPath.includes(m))) {
    return { category: 'components', pkg: '@rancher/components' };
  }

  const nodeModules = innermostPackage(path);

  if (nodeModules) {
    const { pkg, nestedUnder } = nodeModules;

    return {
      category: HOST_PKGS.some((h) => pkg.startsWith(h)) ? 'host-provided' : 'external-lib',
      pkg,
      nestedUnder,
    };
  }

  return { category: 'extension-code', pkg: `${ extName } (own code)` };
}

interface PkgStat {
  category: BundleCategory;
  bytes: number;
  files: number;
  /** First nesting parent seen for this package, if any file showed one */
  nestedUnder: string | null;
}

export interface SourceMapAccumulator {
  extName: string;
  pkgs: Map<string, PkgStat>;
  shellFiles: number;
  componentsFiles: number;
  hostPkgs: Set<string>;
  mapsRead: number;
  /** True once any chunk turned out to carry `sourcesContent` */
  hasContent: boolean;
  /**
   * Every measured source byte, across every category.
   *
   * The denominator of the source-to-disk ratio. Source bytes are
   * pre-minification and pre-compression, so they run two to three times the
   * size of what a browser downloads — and by a different multiple for each
   * bundle, since the ratio depends on what kind of code dominates it.
   * Measured across the ten published bundles the spread is 0.2971 to 0.6619,
   * which is wide enough that comparing two extensions' source bytes says more
   * about their coding style than their download size.
   */
  totalSourceBytes: number;
}

export function createAccumulator(extName: string): SourceMapAccumulator {
  return {
    extName,
    pkgs:             new Map(),
    shellFiles:       0,
    componentsFiles:  0,
    hostPkgs:         new Set(),
    mapsRead:         0,
    hasContent:       false,
    totalSourceBytes: 0,
  };
}

/** Minimum of a source map that this cares about. */
interface RawSourceMap {
  sources?: string[];
  sourcesContent?: (string | null)[];
}

/**
 * Fold one chunk's map into the running totals.
 *
 * Takes the map as text rather than as an object so a malformed one is this
 * function's problem to swallow, not the caller's — a single unparseable chunk
 * should cost that chunk's numbers, not the whole extension's.
 */
export function addSourceMap(acc: SourceMapAccumulator, mapText: string): void {
  let map: RawSourceMap;

  try {
    map = JSON.parse(mapText);
  } catch {
    return;
  }

  const sources = map.sources || [];
  const contents = map.sourcesContent || [];

  acc.mapsRead++;

  if (contents.length) {
    acc.hasContent = true;
  }

  sources.forEach((rawPath, i) => {
    const { category, pkg, nestedUnder } = classifySource(rawPath, acc.extName);
    // No `sourcesContent` means the file counts as present but unmeasurable.
    const bytes = contents[i] ? utf8Length(contents[i] as string) : 0;

    const stat = acc.pkgs.get(pkg) || {
      category, bytes: 0, files: 0, nestedUnder: null
    };

    stat.bytes += bytes;
    stat.files++;
    stat.nestedUnder = stat.nestedUnder || nestedUnder || null;
    acc.pkgs.set(pkg, stat);
    acc.totalSourceBytes += bytes;

    if (category === 'shell') {
      acc.shellFiles++;
    } else if (category === 'components') {
      acc.componentsFiles++;
    } else if (category === 'host-provided') {
      acc.hostPkgs.add(pkg);
    }
  });
}

export interface SourceMapTotals {
  byCategory: BundleCategoryTotal[];
  byCause: BundleCauseTotal[];
  byPackage: BundlePackage[];
  leaks: BundleLeaks;
  totalSourceBytes: number;
  shellCausedBytes: number;
}

export interface FinaliseContext {
  /** Keys of `dependencies` in shell's own `package.json` */
  shellDeps?: ReadonlySet<string>;
  /** Resolved versions per package, from the extension's `yarn.lock` */
  versions?: Map<string, string[]>;
}

/**
 * Collapse the accumulator into the shape the tables render.
 *
 * The context is optional and every consumer of the output has to cope with it
 * being absent: shell's `package.json` and the extension's lockfile are two
 * more network fetches, and one of them failing should degrade a column rather
 * than lose an extension's whole analysis.
 */
export function finaliseTotals(acc: SourceMapAccumulator, ctx: FinaliseContext = {}): SourceMapTotals {
  const shellDeps = ctx.shellDeps || new Set<string>();

  const byPackage: BundlePackage[] = [...acc.pkgs.entries()]
    .map(([pkg, stat]) => ({
      pkg,
      category: stat.category,
      bytes:    stat.bytes,
      files:    stat.files,
      cause:    classifyCause({
        pkg, nestedUnder: stat.nestedUnder, shellDeps
      }),
      versions: ctx.versions?.get(pkg) || [],
    }))
    .sort((a, b) => b.bytes - a.bytes);

  const categories = new Map<BundleCategory, BundleCategoryTotal>();
  const causes = new Map<BundleCause, BundleCauseTotal>();

  for (const entry of byPackage) {
    const total = categories.get(entry.category) || {
      category: entry.category, bytes: 0, files: 0
    };

    total.bytes += entry.bytes;
    total.files += entry.files;
    categories.set(entry.category, total);

    const cause = causes.get(entry.cause) || {
      cause: entry.cause, bytes: 0, files: 0, packages: 0
    };

    cause.bytes += entry.bytes;
    cause.files += entry.files;
    cause.packages++;
    causes.set(entry.cause, cause);
  }

  // Deliberately not derived from `SHELL_CAUSED` over the cause totals in the
  // page: the set is the classifier's business and the page should not have to
  // know which causes are shell's.
  const shellCausedBytes = byPackage
    .filter((p) => SHELL_CAUSED.has(p.cause))
    .reduce((sum, p) => sum + p.bytes, 0);

  return {
    byCategory: [...categories.values()].sort((a, b) => b.bytes - a.bytes),
    byCause:    [...causes.values()].sort((a, b) => b.bytes - a.bytes),
    byPackage,
    leaks:      {
      shellFiles:      acc.shellFiles,
      componentsFiles: acc.componentsFiles,
      hostPkgs:        [...acc.hostPkgs],
    },
    totalSourceBytes: acc.totalSourceBytes,
    shellCausedBytes,
  };
}
