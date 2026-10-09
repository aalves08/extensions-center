import {
  Advisory, DependencyScope, PackageGroup, Severity, SEVERITIES
} from '../types/security';

/** Most severe first, which is the order everything on the page is ranked in. */
const RANK: Record<Severity, number> = {
  critical: 0, high: 1, medium: 2, low: 3,
};

export function severityRank(severity: Severity): number {
  return RANK[severity];
}

export function worseOf(a: Severity, b: Severity): Severity {
  return RANK[a] <= RANK[b] ? a : b;
}

/** An all-zero severity tally, for callers that accumulate into one. */
export function emptyCounts(): Record<Severity, number> {
  return {
    critical: 0, high: 0, medium: 0, low: 0,
  };
}

export function addCounts(into: Record<Severity, number>, from: Record<Severity, number>): void {
  for (const severity of SEVERITIES) {
    into[severity] += from[severity];
  }
}

/**
 * Normalise a severity from either source.
 *
 * Dependabot says `low|medium|high|critical`; OSV's `database_specific.severity`
 * says `LOW|MODERATE|HIGH|CRITICAL`. `moderate` is the only real difference and
 * means the same thing as `medium`.
 */
export function normaliseSeverity(raw: string | null | undefined): Severity {
  switch ((raw || '').toLowerCase()) {
  case 'critical':
    return 'critical';
  case 'high':
    return 'high';
  case 'moderate':
  case 'medium':
    return 'medium';
  default:
    // Anything unrecognised — including OSV records with no GitHub severity at
    // all — lands on `low` rather than being dropped. An advisory we cannot
    // grade is still an advisory, and silently discarding it would understate
    // the count.
    return 'low';
  }
}

/** The earlier of two ISO dates, ignoring nulls. */
function earlier(a: string | null, b: string | null): string | null {
  if (!a) {
    return b;
  }

  if (!b) {
    return a;
  }

  return a < b ? a : b;
}

/**
 * Collapse open advisories into one row per package.
 *
 * Only open advisories reach the table. Closed ones are kept by the caller for
 * the history series, where they are the entire point, but a row saying "fixed
 * eight months ago" is noise in a list of work to do.
 */
export function groupByPackage(advisories: Advisory[]): PackageGroup[] {
  const groups = new Map<string, PackageGroup>();

  for (const advisory of advisories) {
    if (advisory.state !== 'open') {
      continue;
    }

    const id = `${ advisory.ecosystem }/${ advisory.packageName }`;

    let group = groups.get(id);

    if (!group) {
      group = {
        id,
        name:           advisory.packageName,
        ecosystem:      advisory.ecosystem,
        worstSeverity:  advisory.severity,
        advisories:     [],
        counts:         emptyCounts(),
        manifests:      [],
        patchedVersion: null,
        unpatched:      true,
        scope:          null,
        oldest:         null,
      };
      groups.set(id, group);
    }

    group.advisories.push(advisory);
    group.counts[advisory.severity]++;
    group.worstSeverity = worseOf(group.worstSeverity, advisory.severity);
    group.oldest = earlier(group.oldest, advisory.createdAt);

    if (advisory.manifest && !group.manifests.includes(advisory.manifest)) {
      group.manifests.push(advisory.manifest);
    }

    if (advisory.scope) {
      group.scope = scopeWith(group.scope, advisory.scope);
    }
  }

  for (const group of groups.values()) {
    group.advisories.sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
    group.manifests.sort();

    // The fix shown on the row is the one that clears the *worst* open
    // advisory. Showing the highest patched version across all of them would
    // be wrong in the common case where a low-severity advisory needs a newer
    // release than the critical one does — the row would then understate how
    // urgent the bump is and overstate how far it has to go.
    const worst = group.advisories.find((a) => a.severity === group.worstSeverity);

    group.patchedVersion = worst?.patchedVersion || null;
    group.unpatched = group.advisories.every((a) => !a.patchedVersion);
  }

  return [...groups.values()].sort((a, b) => {
    return severityRank(a.worstSeverity) - severityRank(b.worstSeverity) ||
      b.advisories.length - a.advisories.length ||
      a.name.localeCompare(b.name);
  });
}

function scopeWith(current: PackageGroup['scope'], next: DependencyScope): PackageGroup['scope'] {
  if (current === null) {
    return next;
  }

  return current === next ? current : 'mixed';
}

/** Totals across every group, for the tiles above the table. */
export function countGroups(groups: PackageGroup[]): {
  counts: Record<Severity, number>;
  openTotal: number;
  unpatchedCount: number;
  oldestOpen: string | null;
} {
  const counts = emptyCounts();
  let openTotal = 0;
  let unpatchedCount = 0;
  let oldestOpen: string | null = null;

  for (const group of groups) {
    addCounts(counts, group.counts);
    openTotal += group.advisories.length;
    unpatchedCount += group.advisories.filter((a) => !a.patchedVersion).length;
    oldestOpen = earlier(oldestOpen, group.oldest);
  }

  return {
    counts, openTotal, unpatchedCount, oldestOpen
  };
}

/** How long ago, in whole days/months/years, for the "oldest open" tile. */
export function ageInDays(iso: string | null): number | null {
  if (!iso) {
    return null;
  }

  const then = new Date(iso).getTime();

  if (!Number.isFinite(then)) {
    return null;
  }

  return Math.max(0, Math.floor((Date.now() - then) / 86_400_000));
}
