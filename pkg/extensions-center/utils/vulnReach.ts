import { BundleAnalysisDoc, BundleCause, ExtensionBundle } from '../types/analysis';
import { Advisory, RepoSecurity, Severity } from '../types/security';
import { matchVersions, RangeVerdict } from './semverRange';
import { emptyCounts, severityRank, worseOf } from './severity';

/**
 * Joining what is vulnerable against what actually ships.
 *
 * The Security page can say "`lodash` has a critical advisory in
 * harvester-ui-extension". That is a fact about a lockfile, and a lockfile
 * contains a great deal that never reaches a browser — build tooling, test
 * harnesses, transitive dependencies of transitive dependencies that
 * tree-shaking removed. Bundle analysis knows which packages survived into the
 * published assets. Intersecting the two turns a backlog into a ranking: the
 * advisories on packages that are genuinely inside something a user downloads
 * are not the same set, and are usually a small fraction of it.
 *
 * Nothing here fetches. Both halves are already loaded by their own pages, and
 * this is the pure function over them — which also makes it the part worth
 * testing.
 */

/** Names the bundle analyser invents, which can never match an advisory. */
const SYNTHETIC = new Set(['webpack-runtime', 'externalized']);

/** One extension's bundle, as it relates to one vulnerable package. */
export interface ReachHit {
  /** Chart name */
  ext: string;
  repo: string;
  semver: string;
  /** Source bytes the package contributes. Not a download size; see `diskBytes`. */
  bytes: number;
  /** `bytes` scaled by the bundle's ratio, or null when the ratio is unknown */
  diskBytes: number | null;
  cause: BundleCause;
  /** Versions this extension's lockfile resolved the package to */
  versions: string[];
  /**
   * Whether those versions fall inside any advisory's vulnerable range.
   *
   * `unknown` is the common case and not a failure: it means the extension has
   * no readable lockfile, or the advisory's range is in a form
   * `satisfiesRange` does not parse. Shown as "version unconfirmed" rather than
   * being filtered out, because a package that ships and *might* be vulnerable
   * still outranks one that does not ship at all.
   */
  verdict: RangeVerdict;
}

/** One vulnerable package, across every repo that flags it and every bundle that carries it. */
export interface ReachRow {
  pkg: string;
  worstSeverity: Severity;
  counts: Record<Severity, number>;
  advisories: Advisory[];
  /** Repos whose advisories named this package */
  repos: { id: string; label: string }[];
  /** Published bundles the package was found inside, largest first */
  shipped: ReachHit[];
  /** The strongest verdict across `shipped`; `miss` when nothing ships it */
  verdict: RangeVerdict;
  /** Total disk-scaled bytes across `shipped`, null when no bundle had a ratio */
  shippedBytes: number | null;
}

export interface ReachSummary {
  rows: ReachRow[];
  /** Rows where a shipped version was confirmed inside a vulnerable range */
  confirmed: number;
  /** Rows that ship but whose version could not be confirmed either way */
  unconfirmed: number;
  /** Rows whose package is in no published bundle at all */
  notShipped: number;
  /** Extensions whose bundle analysis was available to join against */
  bundlesJoined: number;
}

/** Most-alarming first, so the worst verdict wins an aggregation. */
const VERDICT_RANK: Record<RangeVerdict, number> = {
  hit: 0, partial: 1, unknown: 2, miss: 3,
};

function worseVerdict(a: RangeVerdict, b: RangeVerdict): RangeVerdict {
  return VERDICT_RANK[a] <= VERDICT_RANK[b] ? a : b;
}

/** Packages in one bundle, keyed by name, synthetic and own-code entries dropped. */
function bundleIndex(bundle: ExtensionBundle) {
  const index = new Map<string, NonNullable<ExtensionBundle['byPackage']>[number]>();

  for (const entry of bundle.byPackage || []) {
    if (SYNTHETIC.has(entry.pkg) || entry.cause === 'extension-code') {
      continue;
    }

    index.set(entry.pkg, entry);
  }

  return index;
}

/**
 * Cross every vulnerable package against every published bundle.
 *
 * Deliberately not restricted to the repo that raised the advisory. A critical
 * advisory on `lodash` filed against one extension is evidence about `lodash`,
 * and the other nine extensions that ship the same vulnerable version are
 * exposed whether or not their own Dependabot has got round to saying so —
 * several of them cannot run Dependabot for us at all, which is exactly the
 * blind spot this is for.
 */
export function buildReach(
  repos: RepoSecurity[],
  bundles: BundleAnalysisDoc | null,
): ReachSummary {
  const rows = new Map<string, ReachRow>();

  for (const repo of repos) {
    if (repo.error) {
      continue;
    }

    for (const group of repo.groups) {
      // npm only. A Go or Python advisory on a repo that also builds a UI is
      // real, but it has no bearing on what the browser bundle contains, and
      // listing it here would claim a reach analysis that was never done.
      if (group.ecosystem.toLowerCase() !== 'npm') {
        continue;
      }

      let row = rows.get(group.name);

      if (!row) {
        row = {
          pkg:           group.name,
          worstSeverity: group.worstSeverity,
          counts:        emptyCounts(),
          advisories:    [],
          repos:         [],
          shipped:       [],
          verdict:       'miss',
          shippedBytes:  null,
        };
        rows.set(group.name, row);
      }

      row.worstSeverity = worseOf(row.worstSeverity, group.worstSeverity);
      row.repos.push({ id: repo.id, label: repo.label });

      for (const advisory of group.advisories) {
        // Two targets can be slices of one monorepo and public-data repos
        // dedupe nothing, so the same GHSA against the same package can arrive
        // more than once. Counting it twice would inflate the only number on
        // this page people will quote.
        if (row.advisories.some((a) => a.ghsa === advisory.ghsa)) {
          continue;
        }

        row.advisories.push(advisory);
        row.counts[advisory.severity]++;
      }
    }
  }

  const analysed = (bundles?.extensions || []).filter((b) => b.byPackage?.length);

  for (const bundle of analysed) {
    const index = bundleIndex(bundle);

    for (const row of rows.values()) {
      const entry = index.get(row.pkg);

      if (!entry) {
        continue;
      }

      // Every advisory on the package, not just the one from this extension's
      // own repo — see the note on cross-repo matching above.
      const verdict = row.advisories
        .map((a) => matchVersions(entry.versions, a.vulnerableRange))
        .reduce(worseVerdict, 'miss' as RangeVerdict);

      row.shipped.push({
        ext:       bundle.name,
        repo:      bundle.repo,
        semver:    bundle.semver,
        bytes:     entry.bytes,
        diskBytes: bundle.ratio === null ? null : Math.round(entry.bytes * bundle.ratio),
        cause:     entry.cause,
        versions:  entry.versions,
        verdict,
      });
    }
  }

  const list = [...rows.values()];

  for (const row of list) {
    row.shipped.sort((a, b) => (b.diskBytes ?? b.bytes) - (a.diskBytes ?? a.bytes));
    row.verdict = row.shipped.map((h) => h.verdict).reduce(worseVerdict, 'miss' as RangeVerdict);

    const measured = row.shipped.filter((h) => h.diskBytes !== null);

    row.shippedBytes = measured.length ? measured.reduce((sum, h) => sum + (h.diskBytes || 0), 0) : null;
  }

  // Shipping beats severity. A critical advisory on something no user ever
  // downloads is a lockfile hygiene task; a high one on code inside every
  // extension is an incident, and sorting by severity alone buries the second
  // under a page of the first.
  list.sort((a, b) => {
    return VERDICT_RANK[a.verdict] - VERDICT_RANK[b.verdict] ||
      severityRank(a.worstSeverity) - severityRank(b.worstSeverity) ||
      b.shipped.length - a.shipped.length ||
      a.pkg.localeCompare(b.pkg);
  });

  return {
    rows:          list,
    confirmed:     list.filter((r) => r.verdict === 'hit' || r.verdict === 'partial').length,
    unconfirmed:   list.filter((r) => r.verdict === 'unknown').length,
    notShipped:    list.filter((r) => !r.shipped.length).length,
    bundlesJoined: analysed.length,
  };
}
