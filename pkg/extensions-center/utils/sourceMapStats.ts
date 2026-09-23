import { BundleCategory, BundleCategoryTotal, BundleLeaks, BundlePackage } from '../types/analysis';
import { utf8Length } from './bytes';

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

const NODE_MODULES_PKG = /node_modules\/((?:@[^/]+\/[^/]+)|(?:[^@/][^/]*))/;

export interface SourceClass {
  category: BundleCategory;
  pkg: string;
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

  const nodeModules = NODE_MODULES_PKG.exec(path);

  if (nodeModules) {
    const pkg = nodeModules[1];

    return {
      category: HOST_PKGS.some((h) => pkg.startsWith(h)) ? 'host-provided' : 'external-lib',
      pkg,
    };
  }

  return { category: 'extension-code', pkg: `${ extName } (own code)` };
}

interface PkgStat {
  category: BundleCategory;
  bytes: number;
  files: number;
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
}

export function createAccumulator(extName: string): SourceMapAccumulator {
  return {
    extName,
    pkgs:            new Map(),
    shellFiles:      0,
    componentsFiles: 0,
    hostPkgs:        new Set(),
    mapsRead:        0,
    hasContent:      false,
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
    const { category, pkg } = classifySource(rawPath, acc.extName);
    // No `sourcesContent` means the file counts as present but unmeasurable.
    const bytes = contents[i] ? utf8Length(contents[i] as string) : 0;

    const stat = acc.pkgs.get(pkg) || {
      category, bytes: 0, files: 0
    };

    stat.bytes += bytes;
    stat.files++;
    acc.pkgs.set(pkg, stat);

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
  byPackage: BundlePackage[];
  leaks: BundleLeaks;
}

/** Collapse the accumulator into the shape the tables render. */
export function finaliseTotals(acc: SourceMapAccumulator): SourceMapTotals {
  const byPackage: BundlePackage[] = [...acc.pkgs.entries()]
    .map(([pkg, stat]) => ({
      pkg, category: stat.category, bytes: stat.bytes, files: stat.files
    }))
    .sort((a, b) => b.bytes - a.bytes);

  const categories = new Map<BundleCategory, BundleCategoryTotal>();

  for (const entry of byPackage) {
    const total = categories.get(entry.category) || {
      category: entry.category, bytes: 0, files: 0
    };

    total.bytes += entry.bytes;
    total.files += entry.files;
    categories.set(entry.category, total);
  }

  return {
    byCategory: [...categories.values()].sort((a, b) => b.bytes - a.bytes),
    byPackage,
    leaks:      {
      shellFiles:      acc.shellFiles,
      componentsFiles: acc.componentsFiles,
      hostPkgs:        [...acc.hostPkgs],
    },
  };
}
