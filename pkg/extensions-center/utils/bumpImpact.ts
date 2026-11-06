import { BundleAnalysisDoc, BundleCause, ExtensionBundle, ImportAnalysisDoc } from '../types/analysis';
import { InventoryDoc, InventoryExtension, InventoryRefSource } from '../types/inventory';
import { PrFix } from '../types/security';
import { HOST_PROVIDED } from './bundleCause';
import { compareSemver } from './version';

/**
 * Which official extensions a `rancher/dashboard` dependency bump can reach.
 *
 * The question a reviewer actually has in front of a Dependabot PR, and it is
 * narrower than "is this package in the estate" — which is what `PackageSearch`
 * answers and why this is not a second copy of it. An extension only feels a
 * bump in the host if it is running the host's copy of that package. Every
 * other appearance of the name is a copy the extension pinned itself, and the
 * host moving on does not touch it until the extension rebuilds.
 *
 * `HOST_PROVIDED` in `bundleCause.ts` is the list that decides which case a
 * package is in, and it is deliberately the same list the bundle analyser uses
 * to classify a cause — two lists would drift and this page would then
 * contradict the bundle page about the same package.
 *
 * Nothing here fetches. The inventory, the imports and the bundles are each
 * loaded by their own code, and this is the pure join over the three plus the
 * freshness check that says how much of it to believe.
 */

/**
 * How a bump gets to an extension.
 *
 * The distinction between the first two is the whole point. `runtime` reaches
 * versions that are already published and installed in clusters today;
 * `rebuild` reaches nothing until someone cuts a new extension release. They
 * call for completely different responses and collapsing them into "affected"
 * would make the common case look like an emergency.
 */
export type BumpReach = 'runtime' | 'rebuild' | 'none' | 'unknown';

/** How the versions an extension pinned compare with the one being moved to. */
export type VersionSkew = 'aligned' | 'behind-major' | 'behind-minor' | 'ahead' | 'mixed' | 'unknown';

/**
 * Why a row could not be answered, so the UI can say which and offer the fix.
 *
 * `stale` is the one that matters most and is the reason this type exists at
 * all: an extension analysed at a version it no longer publishes cannot
 * honestly be reported as unaffected, because the reading describes code
 * nobody is running.
 */
export type ImpactGap = 'stale' | 'not-analysed' | 'no-lockfile' | 'no-bundle-detail';

/** Current released version per extension name, as `resolveTargets` reports it. */
export type CurrentVersions = Record<string, string>;

/** Which version each document read this extension at. Null when it has no row. */
export interface AnalysedVersions {
  inventory: string | null;
  imports: string | null;
  bundles: string | null;
}

/** One extension's answer for one bumped package. */
export interface ExtensionImpact {
  /** Chart name — the key all three documents agree on */
  ext: string;
  /** `owner/name` */
  repo: string;
  reach: BumpReach;
  gaps: ImpactGap[];
  analysed: AnalysedVersions;
  /**
   * Latest released version, once a freshness check has run.
   *
   * Null before one has, which is not the same as "up to date" — the UI says
   * "not checked" rather than implying the readings are current.
   */
  current: string | null;
  /** Whether any document read a version this extension no longer publishes */
  stale: boolean;
  /** Where the inventory's ref came from, so a branch read can admit itself */
  source: InventoryRefSource | null;
  /** Every version this extension's lockfile resolved the package to */
  pinned: string[];
  skew: VersionSkew;
  /** True when the extension's own source imports the package by name */
  importsIt: boolean;
  /**
   * Cause the bundle analyser recorded, when the package is in the published
   * bundle. Null covers both "not in the bundle" and "the maps were not read";
   * the `no-bundle-detail` gap tells those apart.
   */
  bundledCause: BundleCause | null;
}

/** One bumped package and every extension's answer to it. */
export interface PackageImpact {
  bump: PrFix;
  /** True when the host supplies this package to every extension at runtime */
  hostProvided: boolean;
  rows: ExtensionImpact[];
  counts: Record<BumpReach, number>;
}

/** Worst reach first. `unknown` outranks `rebuild` deliberately — see below. */
const REACH_ORDER: Record<BumpReach, number> = {
  // An unanswered row is ranked above a confidently harmless one because it is
  // the row a reviewer has to go and check by hand. Sorting it down next to
  // "none" would hide exactly the work this page exists to surface.
  runtime: 0,
  unknown: 1,
  rebuild: 2,
  none:    3,
};

const MAJOR = /^v?(\d+)\.(\d+)\./;

function majorMinor(version: string): [number, number] | null {
  const parsed = MAJOR.exec(version || '');

  return parsed ? [Number(parsed[1]), Number(parsed[2])] : null;
}

/**
 * How one pinned version sits against the version being moved to.
 *
 * Only ever major/minor: Dependabot's trailers carry the target version and
 * nothing about what it came from, so a patch-level difference says nothing
 * useful about whether an API moved.
 */
function skewOne(pinned: string, target: string): VersionSkew {
  const a = majorMinor(pinned);
  const b = majorMinor(target);

  if (!a || !b) {
    return 'unknown';
  }

  if (a[0] !== b[0]) {
    return a[0] < b[0] ? 'behind-major' : 'ahead';
  }

  if (a[1] !== b[1]) {
    return a[1] < b[1] ? 'behind-minor' : 'ahead';
  }

  return 'aligned';
}

/**
 * The skew across every version a lockfile resolved the package to.
 *
 * A lockfile resolving one package twice is normal rather than an error — that
 * is what nested `node_modules` are — and `mixed` names the case rather than
 * picking whichever copy happened to sort first.
 */
export function skewOf(pinned: string[], target: string): VersionSkew {
  if (!pinned.length) {
    return 'unknown';
  }

  const seen = new Set(pinned.map((v) => skewOne(v, target)));

  if (seen.size === 1) {
    return [...seen][0];
  }

  // Undetermined anywhere poisons the whole answer rather than being dropped,
  // for the same reason `matchVersions` does it: ignoring a copy we could not
  // rank can only ever turn a real skew into a clean bill of health.
  return seen.has('unknown') ? 'unknown' : 'mixed';
}

/**
 * Collapse a PR's trailers to one entry per package.
 *
 * Dependabot writes one commit per package, but a PR that rolls a package and
 * its types together — or that was rebased — can name the same package twice.
 * The highest version wins, because that is the one the branch ends on.
 */
export function dedupeBumps(bumps: PrFix[]): PrFix[] {
  const byName = new Map<string, PrFix>();

  for (const bump of bumps) {
    const seen = byName.get(bump.name);

    if (!seen || compareSemver(bump.version, seen.version) > 0) {
      byName.set(bump.name, bump);
    }
  }

  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Parse a hand-typed `name@version`.
 *
 * Split on the *last* `@`, because a scoped name opens with one — the same
 * rule as `parseQuery`, so anything that works in the package search works
 * here. Null when no version was given: a bump with no target version cannot
 * be compared against anything, and guessing "latest" would silently answer a
 * different question from the one typed.
 */
export function parseBump(raw: string): PrFix | null {
  const cleaned = (raw || '').trim().replace(/^"|"$/g, '');
  const at = cleaned.lastIndexOf('@');

  if (at <= 0) {
    return null;
  }

  const name = cleaned.slice(0, at).trim();
  const version = cleaned.slice(at + 1).trim();

  if (!name || !version) {
    return null;
  }

  return {
    name, version, number: 0, title: '', url: '', draft: false
  };
}

/** A pull request to read bumps out of. */
export interface PrRef {
  /** `owner/name` */
  repo: string;
  number: number;
}

const PR_URL = /github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/;

/**
 * Parse whatever someone has in their clipboard into a pull request.
 *
 * Three forms, because all three are what a reviewer actually has to hand: a
 * full PR URL, a `#18965` reference copied out of a comment, or a bare number
 * typed from memory. The last two carry no repository, so they fall back to
 * the one the page is about.
 */
export function parsePrRef(raw: string, defaultRepo: string): PrRef | null {
  const cleaned = (raw || '').trim();
  const url = PR_URL.exec(cleaned);

  if (url) {
    return { repo: url[1], number: Number(url[2]) };
  }

  const bare = /^#?(\d+)$/.exec(cleaned);

  return bare ? { repo: defaultRepo, number: Number(bare[1]) } : null;
}

/** Packages in one bundle, keyed by name. Synthetic entries are not real packages. */
function bundleIndex(bundle: ExtensionBundle): Map<string, BundleCause> {
  const index = new Map<string, BundleCause>();

  for (const entry of bundle.byPackage || []) {
    index.set(entry.pkg, entry.cause);
  }

  return index;
}

/** Everything the three documents hold about one extension. */
interface ExtensionSources {
  repo: string;
  inventory: InventoryExtension | null;
  bundle: ExtensionBundle | null;
  bundlePkgs: Map<string, BundleCause> | null;
  /** Package names this extension's source imports directly */
  imported: Set<string> | null;
  analysed: AnalysedVersions;
}

/**
 * Index the three documents by extension name.
 *
 * The union rather than the intersection: an extension present in two
 * documents and missing from the third is a real and informative state, and
 * dropping it would quietly shorten the list of things a reviewer has to
 * think about.
 */
function indexSources(
  inventory: InventoryDoc | null,
  imports: ImportAnalysisDoc | null,
  bundles: BundleAnalysisDoc | null,
): Map<string, ExtensionSources> {
  const out = new Map<string, ExtensionSources>();

  const slot = (name: string, repo: string): ExtensionSources => {
    const existing = out.get(name);

    if (existing) {
      return existing;
    }

    const created: ExtensionSources = {
      repo,
      inventory:  null,
      bundle:     null,
      bundlePkgs: null,
      imported:   null,
      analysed:   {
        inventory: null, imports: null, bundles: null
      },
    };

    out.set(name, created);

    return created;
  };

  for (const ext of inventory?.extensions || []) {
    const entry = slot(ext.name, ext.repo);

    entry.inventory = ext;
    entry.analysed.inventory = ext.semver;
  }

  for (const totals of imports?.totals || []) {
    const entry = slot(totals.name, totals.repo);

    entry.analysed.imports = totals.semver;
    // External imports are recorded by package name; the path *is* the name.
    entry.imported = new Set((imports?.detail?.[totals.name]?.external || []).map((row) => row.path));
  }

  for (const bundle of bundles?.extensions || []) {
    const entry = slot(bundle.name, bundle.repo);

    entry.bundle = bundle;
    entry.analysed.bundles = bundle.semver;
    entry.bundlePkgs = bundle.byPackage ? bundleIndex(bundle) : null;
  }

  return out;
}

/**
 * Whether any document read this extension at a version it no longer ships.
 *
 * Only answerable once a freshness check has run. Before that every row is
 * reported as unchecked rather than as current — an unverified reading and a
 * verified-current one are not the same claim, and only one of them is safe
 * to act on.
 */
function isStale(analysed: AnalysedVersions, current: string | null): boolean {
  if (!current) {
    return false;
  }

  return [analysed.inventory, analysed.imports, analysed.bundles]
    .filter((v): v is string => !!v)
    .some((v) => v !== current);
}

/** One extension's answer for one package, and why. */
function assessOne(
  ext: string,
  sources: ExtensionSources,
  bump: PrFix,
  hostProvided: boolean,
  current: string | null,
): ExtensionImpact {
  const gaps: ImpactGap[] = [];
  const stale = isStale(sources.analysed, current);

  if (stale) {
    gaps.push('stale');
  }

  if (!sources.inventory) {
    gaps.push('not-analysed');
  } else if (sources.inventory.error) {
    gaps.push('no-lockfile');
  }

  if (sources.bundle && !sources.bundlePkgs) {
    gaps.push('no-bundle-detail');
  }

  const pinned = sources.inventory?.packages?.[bump.name] || [];
  const importsIt = sources.imported?.has(bump.name) ?? false;
  const bundledCause = sources.bundlePkgs?.get(bump.name) ?? null;
  const uses = importsIt || !!pinned.length || !!bundledCause;

  const row: ExtensionImpact = {
    ext,
    repo:     sources.repo,
    reach:    'none',
    gaps,
    analysed: sources.analysed,
    current,
    stale,
    source:   sources.inventory?.source ?? null,
    pinned,
    skew:     skewOf(pinned, bump.version),
    importsIt,
    bundledCause,
  };

  // A reading of a version the extension no longer publishes describes code
  // nobody is running, so it cannot support either answer — including the
  // reassuring one. This is the rule the whole page is built around.
  if (stale) {
    return { ...row, reach: 'unknown' };
  }

  // The lockfile is the evidence that decides `rebuild` from `none`, so
  // without it there is no answer to give. `no-bundle-detail` is not in here:
  // it costs the `bundledCause` column its content and nothing else.
  if (gaps.includes('not-analysed') || gaps.includes('no-lockfile')) {
    return { ...row, reach: 'unknown' };
  }

  if (uses) {
    // Host-provided means the extension executes the host's copy whatever its
    // own lockfile says, so the bump lands on versions already installed in
    // clusters. Otherwise the extension carries its own copy and only picks
    // the new one up when it next builds against the new shell.
    return { ...row, reach: hostProvided ? 'runtime' : 'rebuild' };
  }

  return row;
}

/**
 * Assess every bump against every extension.
 *
 * `current` is the output of a freshness check, keyed by extension name, and
 * null when none has run.
 */
export function assessBumps(
  bumps: PrFix[],
  docs: {
    inventory: InventoryDoc | null;
    imports: ImportAnalysisDoc | null;
    bundles: BundleAnalysisDoc | null;
  },
  current: CurrentVersions | null,
): PackageImpact[] {
  const sources = indexSources(docs.inventory, docs.imports, docs.bundles);

  return dedupeBumps(bumps).map((bump) => {
    const hostProvided = HOST_PROVIDED.has(bump.name);

    const rows = [...sources.entries()]
      .map(([ext, entry]) => assessOne(ext, entry, bump, hostProvided, current?.[ext] ?? null))
      .sort((a, b) => REACH_ORDER[a.reach] - REACH_ORDER[b.reach] || a.ext.localeCompare(b.ext));

    const counts: Record<BumpReach, number> = {
      runtime: 0, rebuild: 0, none: 0, unknown: 0
    };

    rows.forEach((row) => {
      counts[row.reach]++;
    });

    return {
      bump, hostProvided, rows, counts
    };
  });
}

/**
 * Extensions worth re-analysing, across every package in the assessment.
 *
 * Deduplicated by name: one extension can be stale against all twelve packages
 * in a PR and still only needs re-reading once.
 */
export function staleExtensions(impacts: PackageImpact[]): string[] {
  const names = new Set<string>();

  impacts.forEach((impact) => impact.rows.forEach((row) => {
    if (row.stale) {
      names.add(row.ext);
    }
  }));

  return [...names].sort();
}
