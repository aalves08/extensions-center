import { BundleAnalysisDoc, BundleCategory, ExtensionBundle } from '../types/analysis';
import { BundleCause, HOST_PROVIDED, SHELL_CAUSED } from './bundleCause';

/**
 * The same package, shipped by several extensions at once.
 *
 * Every published extension bundles its own copy of whatever it was not told
 * to externalize, so a dependency used by eight extensions is downloaded eight
 * times by anyone who installs all eight. The per-extension pages each show a
 * number too small to argue with. This is the estate view, and it is the
 * evidence behind "shell should externalize X".
 *
 * Pure over the saved bundle document. No fetch, no rebuild.
 *
 * Three measurement rules, all of which change the answer:
 *
 *  - **Source bytes are not shipped bytes.** `BundlePackage.bytes` comes from
 *    source maps and is pre-minification. Each extension's figure is scaled by
 *    that bundle's own `ratio` before anything is summed — the measured spread
 *    is 0.2971 to 0.6619, a 2.2x range, so a shared constant would reorder the
 *    table as well as inflate it.
 *  - **A bundle with no source maps is unmeasured, not empty.** `byPackage` is
 *    null for those, and they are reported by name in `unmeasured` so every
 *    total on the page can be read as the floor it is.
 *  - **Two different savings.** Externalizing something the host already loads
 *    removes every copy. Externalizing a library the host does *not* have
 *    means shell starts shipping one, so the saving is every copy but the
 *    largest. Mixing the two produces a headline number that is wrong for half
 *    its rows, so `saving` is computed per row and `savingKind` says which
 *    arithmetic was used.
 */

/** Synthetic package names that are bookkeeping, not dependencies. */
const SYNTHETIC: ReadonlySet<BundleCategory> = new Set<BundleCategory>(['externalized', 'webpack-runtime']);

/** Which arithmetic produced a row's `saving`. */
export type SavingKind = 'all-copies' | 'all-but-one';

/** One extension's copy of a duplicated package. */
export interface DuplicateCarrier {
  ext: string;
  /** Pre-minification bytes, as the source map recorded them */
  sourceBytes: number;
  /** `sourceBytes` scaled by this bundle's own source-to-disk ratio */
  shippedBytes: number;
  files: number;
  cause: BundleCause;
  /** Resolved versions from this extension's lockfile; empty if unreadable */
  versions: string[];
}

export interface DuplicatePackage {
  pkg: string;
  category: BundleCategory;
  carriers: DuplicateCarrier[];
  extCount: number;
  /** Every copy, disk-scaled and summed */
  shippedBytes: number;
  /** The biggest single copy — what survives if shell ships one for everyone */
  largestCopy: number;
  saving: number;
  savingKind: SavingKind;
  /** True when the host already provides it, so every copy is removable */
  hostProvided: boolean;
  /** Distinct resolved versions across every carrier */
  versions: string[];
  /**
   * Carriers resolved this to more than one version.
   *
   * The argument against externalizing as much as for it: one shared copy has
   * to be one version, and this says who would have to move.
   */
  versionSplit: boolean;
  /** True only when every carrier's cause is shell's to fix */
  shellCaused: boolean;
  causes: BundleCause[];
}

export interface DuplicationReport {
  packages: DuplicatePackage[];
  /** Analysed extensions whose source maps were not read; floor, not zero */
  unmeasured: string[];
  /** Read, but with no usable ratio, so their bytes could not be disk-scaled */
  unscaled: string[];
  /** Extensions that contributed to the numbers */
  measured: number;
  totals: {
    packages: number;
    shippedBytes: number;
    saving: number;
    /** Of `saving`, the part attributable to causes shell owns */
    shellCausedSaving: number;
    versionSplits: number;
  };
}

export function emptyDuplicationReport(): DuplicationReport {
  return {
    packages:   [],
    unmeasured: [],
    unscaled:   [],
    measured:   0,
    totals:     {
      packages: 0, shippedBytes: 0, saving: 0, shellCausedSaving: 0, versionSplits: 0
    },
  };
}

/** Accumulator; carriers are sorted and summed once the pass is done. */
interface PkgAcc {
  pkg: string;
  category: BundleCategory;
  carriers: DuplicateCarrier[];
}

/**
 * Whether the host already loads this package at runtime.
 *
 * Both tests, because they catch different things: the category is what the
 * source-map classifier decided from the file path, and `HOST_PROVIDED` is the
 * curated list of names shell supplies. A package can be caught by one and not
 * the other, and either is enough for every copy to be removable.
 */
function isHostProvided(pkg: string, category: BundleCategory): boolean {
  return category === 'shell' || category === 'components' || category === 'host-provided' || HOST_PROVIDED.has(pkg);
}

/**
 * @param minCarriers Rows with fewer carriers than this are dropped. Two is
 * the honest default — that is already a second copy — and the page offers a
 * higher bar as a filter rather than baking one in.
 */
export function buildDuplicationReport(doc: BundleAnalysisDoc | null, minCarriers = 2): DuplicationReport {
  if (!doc) {
    return emptyDuplicationReport();
  }

  const extensions: ExtensionBundle[] = doc.extensions || [];
  const acc = new Map<string, PkgAcc>();
  const unmeasured: string[] = [];
  const unscaled: string[] = [];
  let measured = 0;

  for (const ext of extensions) {
    if (!ext.byPackage) {
      // Includes extensions that publish nothing at all. Both are "we do not
      // know", and the page says so rather than counting them as a clean zero.
      unmeasured.push(ext.name);
      continue;
    }

    if (ext.ratio === null) {
      // Read, but the maps carried no content to measure against. Its packages
      // would have to be summed unscaled, which is exactly the mistake the
      // ratio exists to prevent, so it is excluded and named.
      unscaled.push(ext.name);
      continue;
    }

    measured++;

    for (const entry of ext.byPackage) {
      if (SYNTHETIC.has(entry.category)) {
        continue;
      }

      const row = acc.get(entry.pkg) || {
        pkg: entry.pkg, category: entry.category, carriers: []
      };

      row.carriers.push({
        ext:          ext.name,
        sourceBytes:  entry.bytes,
        shippedBytes: entry.bytes * ext.ratio,
        files:        entry.files,
        cause:        entry.cause,
        versions:     entry.versions || [],
      });
      acc.set(entry.pkg, row);
    }
  }

  const packages: DuplicatePackage[] = [...acc.values()]
    .filter((row) => row.carriers.length >= minCarriers)
    .map((row) => {
      const carriers = [...row.carriers].sort((a, b) => b.shippedBytes - a.shippedBytes);
      const shippedBytes = carriers.reduce((sum, c) => sum + c.shippedBytes, 0);
      const largestCopy = carriers[0]?.shippedBytes || 0;
      const hostProvided = isHostProvided(row.pkg, row.category);
      const versions = [...new Set(carriers.flatMap((c) => c.versions))].sort();
      const causes = [...new Set(carriers.map((c) => c.cause))];

      return {
        pkg:          row.pkg,
        category:     row.category,
        carriers:     carriers.map((c) => ({ ...c, shippedBytes: Math.round(c.shippedBytes) })),
        extCount:     carriers.length,
        shippedBytes: Math.round(shippedBytes),
        largestCopy:  Math.round(largestCopy),
        saving:       Math.round(hostProvided ? shippedBytes : shippedBytes - largestCopy),
        savingKind:   (hostProvided ? 'all-copies' : 'all-but-one') as SavingKind,
        hostProvided,
        versions,
        versionSplit: versions.length > 1,
        shellCaused:  causes.every((c) => SHELL_CAUSED.has(c)),
        causes,
      };
    })
    .sort((a, b) => b.saving - a.saving || b.extCount - a.extCount || a.pkg.localeCompare(b.pkg));

  return {
    packages,
    unmeasured,
    unscaled,
    measured,
    totals: {
      packages:          packages.length,
      shippedBytes:      packages.reduce((sum, p) => sum + p.shippedBytes, 0),
      saving:            packages.reduce((sum, p) => sum + p.saving, 0),
      shellCausedSaving: packages.filter((p) => p.shellCaused).reduce((sum, p) => sum + p.saving, 0),
      versionSplits:     packages.filter((p) => p.versionSplit).length,
    },
  };
}
