/**
 * What moving an extension to a newer `@rancher/shell` would actually clear.
 *
 * Extensions do not load shell from Rancher at runtime — it is compiled into
 * each published bundle, which is what `shell-code` and `shell-dep` measure in
 * `bundleCause.ts`. So every release freezes a copy of shell *and* of shell's
 * dependency versions, and an extension cut a year ago is still serving last
 * year's `axios` no matter what its repo declares today.
 *
 * That makes "upgrade shell" a remediation with a price, and this puts a number
 * on it. Between 3.0.11 and 3.0.13 shell drops 25 dependencies outright, `ip`,
 * `cookie` and `url-parse` among them.
 *
 * Two limits, both stated in the UI rather than buried here:
 *
 * - **The count is a floor.** Shell's `dependencies` are its *direct* ones, so
 *   anything a bump clears deeper in the tree is invisible. The same
 *   substitution, for the same reason, as `bundleCause.ts:17-22`.
 * - **`unknown` is a result.** When the shipped version cannot be read the row
 *   says so and names why, because the whole row is advice about upgrading and
 *   a guessed version would be worse than a blank one.
 */

import { AnalysisTarget } from '../types/analysis';
import { Advisory, ShellUnknownReason, ShellUpgradeFix, ShellUpgradeRow } from '../types/security';
import { satisfiesRange } from './semverRange';
import { severityRank } from './severity';
import { compareSemver } from './version';

/** The slice of an npm packument this reads. */
export interface Packument {
  'dist-tags': Record<string, string>;
  versions: Record<string, { dependencies?: Record<string, string> }>;
}

/** What one extension release pins shell at, or why that could not be read. */
export interface Shipped {
  version?: string;
  lockfile?: string;
  reason?: ShellUnknownReason;
}

/** A bare `1.2.3` or `1.2.3-rc.4`, as opposed to `^1.2.3` or `>=1.2.3 <2`. */
const EXACT = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z-.]+)?$/;

/** One extension's row: what it ships, and what the target would buy it. */
export function buildRow(
  extension: AnalysisTarget,
  shipped: Shipped,
  meta: Packument,
  target: string,
  open: Advisory[]
): ShellUpgradeRow {
  const row: ShellUpgradeRow = {
    name:          extension.name,
    repo:          extension.repo,
    tag:           extension.tag,
    shippedShell:  shipped.version || null,
    unknownReason: shipped.reason,
    lockfile:      shipped.lockfile,
    current:       !!shipped.version && shipped.version === target,
    cleared:       [],
    removed:       [],
  };

  const from = shipped.version ? meta.versions[shipped.version]?.dependencies : undefined;
  const to = meta.versions[target]?.dependencies;

  // Nothing to diff: the shipped version is unknown, it is a release npm no
  // longer lists, or there is no gap to close. The row still reports what it
  // does know rather than being dropped.
  if (!from || !to || row.current) {
    return row;
  }

  row.removed = Object.keys(from).filter((name) => !(name in to)).sort();

  const removed = new Set(row.removed);
  const seen = new Set<string>();

  for (const advisory of open) {
    const name = advisory.packageName;
    const key = `${ advisory.ghsa }@${ name }`;

    // Only packages shell itself pins. Anything else in the extension's tree is
    // the extension's own, and a shell bump does not move it.
    //
    // One advisory can arrive several times over — once per lockfile it was
    // raised against — and counting it twice would inflate the one number this
    // whole tab exists to report.
    if (!(name in from) || seen.has(key)) {
      continue;
    }

    const fix = clears(advisory, removed, to[name]);

    if (fix) {
      seen.add(key);
      row.cleared.push(fix);
    }
  }

  row.cleared.sort((a, b) => {
    return severityRank(a.severity) - severityRank(b.severity) || a.packageName.localeCompare(b.packageName);
  });

  return row;
}

/**
 * Whether the target shell closes one advisory, and on what evidence.
 *
 * Removal is unconditional — a dependency shell no longer declares cannot be
 * vulnerable at any version. A repin has to be argued, and only from an exact
 * pin: shell pins 106 of its 113 dependencies exactly, and for the handful
 * written as a range there is no single version to test, so those go uncounted
 * rather than assumed cleared. Undercounting is the safe direction for a number
 * someone uses to decide whether to upgrade.
 */
export function clears(advisory: Advisory, removed: ReadonlySet<string>, pinned: string | undefined): ShellUpgradeFix | null {
  const facts = {
    packageName: advisory.packageName,
    ghsa:        advisory.ghsa,
    cve:         advisory.cve,
    severity:    advisory.severity,
  };

  if (removed.has(advisory.packageName)) {
    return {
      ...facts, how: 'removed', targetVersion: null
    };
  }

  if (!pinned || !EXACT.test(pinned)) {
    return null;
  }

  const inRange = satisfiesRange(pinned, advisory.vulnerableRange);

  // Definitively still inside the vulnerable range: the bump does not help.
  if (inRange === true) {
    return null;
  }

  // Either the range puts the pin outside it, or there was no usable range —
  // the normal case for a public-data row, since OSV reports a fixed version
  // rather than a vulnerable range. Falling back to the published fix keeps
  // those countable instead of scoring every OSV finding as zero.
  const cleared = inRange === false ||
    (!!advisory.patchedVersion && compareSemver(pinned, advisory.patchedVersion) >= 0);

  return cleared ? {
    ...facts, how: 'repinned', targetVersion: pinned
  } : null;
}

/** Most to gain first. Rows with nothing to say sink; unknowns sink furthest. */
export function byPayoff(a: ShellUpgradeRow, b: ShellUpgradeRow): number {
  const rank = (row: ShellUpgradeRow) => (row.shippedShell ? 0 : 1);

  return rank(a) - rank(b) ||
    b.cleared.length - a.cleared.length ||
    b.removed.length - a.removed.length ||
    a.name.localeCompare(b.name);
}
