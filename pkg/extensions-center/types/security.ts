/**
 * Data models for the Security page.
 *
 * Deliberately close to what the upstream APIs return. The console this is
 * modelled on lost an afternoon to matchers that re-derived facts from
 * Dependabot PR *titles* — a "multi" PR names one version in its title while
 * bumping three major lines. Carry the fields; do not infer them.
 */

export const SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;

export type Severity = typeof SEVERITIES[number];

/** Where a repo's rows came from, which decides what the page can honestly claim. */
export type VulnSource = 'dependabot' | 'public';

export type AlertState = 'open' | 'fixed' | 'dismissed' | 'auto_dismissed';

/** Whether a dependency is needed to run or only to build. */
export type DependencyScope = 'runtime' | 'development';

/**
 * One advisory against one package.
 *
 * For a Dependabot repo this is one alert. For a public-data repo it is one
 * OSV record matched against one resolved package version — which is why half
 * the fields are nullable: an SBOM has no manifest path, no scope and no
 * lifecycle.
 */
export interface Advisory {
  /** Unique within a repo: the alert number for Dependabot, `ghsa@package` for OSV */
  id: string;
  /** The vulnerable package, which is what rows are grouped on */
  packageName: string;
  ecosystem: string;
  ghsa: string;
  cve: string | null;
  summary: string;
  severity: Severity;
  /** The lockfile this was raised against. Null from public data. */
  manifest: string | null;
  vulnerableRange: string | null;
  /** The version that closes it, or null when nothing is published yet */
  patchedVersion: string | null;
  scope: DependencyScope | null;
  relationship: 'direct' | 'transitive' | null;
  state: AlertState;
  createdAt: string | null;
  /** Whichever of fixed/dismissed/auto-dismissed closed it */
  closedAt: string | null;
  url: string;
}

/**
 * A vulnerable package and every open advisory against it.
 *
 * The row unit is the package rather than the alert because one bump clears
 * several alerts — `js-yaml` raising six advisories across three lockfiles is
 * one thing to fix, not six rows.
 */
export interface PackageGroup {
  /** `ecosystem/name` — the row key */
  id: string;
  name: string;
  ecosystem: string;
  worstSeverity: Severity;
  /** Open advisories only. Closed ones live on in the history, not the table. */
  advisories: Advisory[];
  counts: Record<Severity, number>;
  manifests: string[];
  /** The version that clears the most severe open advisory, null when none exists */
  patchedVersion: string | null;
  /** True when no open advisory has a patch — there is nothing to bump to */
  unpatched: boolean;
  /** `mixed` when the package arrives as both a runtime and a build dependency */
  scope: DependencyScope | 'mixed' | null;
  /** ISO date of the earliest open advisory */
  oldest: string | null;
}

/** Four severity series sharing one date axis. */
export interface SeveritySeries {
  /** Bucket start dates, `YYYY-MM-DD`, oldest first */
  dates: string[];
  critical: number[];
  high: number[];
  medium: number[];
  low: number[];
}

/** Everything the page knows about one repository. */
export interface RepoSecurity {
  /** URL-safe tab key. Not the repo, because two targets can share a repo. */
  id: string;
  /** `owner/name`, for display and for links back to GitHub */
  repo: string;
  /** Chart name for a manifest extension, otherwise the repo name */
  label: string;
  source: VulnSource;
  groups: PackageGroup[];
  counts: Record<Severity, number>;
  openTotal: number;
  /** Open advisories with no published fix */
  unpatchedCount: number;
  oldestOpen: string | null;
  /**
   * Open alerts over time.
   *
   * Null for a public-data repo: an SBOM is a snapshot of right now and
   * carries no lifecycle, so there is no series to reconstruct.
   */
  history: SeveritySeries | null;
  /**
   * SBOM entries left as a declared range (`^7.0.3`) that the dependency graph
   * never resolved. Counted and reported rather than guessed at.
   */
  unresolved: number;
  fetchedAt: string;
  /** l10n key for the caveat a narrowed target has to state. See `TargetScope`. */
  noteKey?: string;
  /** Set when the repo could not be read at all, so the tab can explain itself */
  error?: string;
}

/**
 * Which of a repo's alerts belong to this target.
 *
 * Needed only for the packages published out of `rancher/dashboard`. A monorepo
 * raises alerts for everything it contains, so a target that is one package
 * inside one has to narrow them; omit this and the target is the whole repo.
 *
 * Two rules, unioned, because Dependabot attributes in two different ways.
 */
export interface TargetScope {
  /**
   * Manifests belonging to this package alone. Every alert filed against one
   * of these is the target's, no further qualification needed.
   */
  ownManifests: string[];
  /**
   * Manifests this package shares with the rest of the monorepo, narrowed to
   * the packages `declaredBy` names.
   *
   * For a package with no lockfile of its own: its dependencies resolve
   * through the workspace root, so their alerts land in the root lockfile
   * together with everyone else's and only the dependency name tells them
   * apart. Catches direct dependencies; transitive ones are not attributable
   * this way, which is what `noteKey` has to say.
   */
  shared?: {
    manifests: string[];
    /** Repo-relative path to the `package.json` whose declarations are the filter */
    declaredBy: string;
  };
  /** l10n key for the caveat the narrowing above obliges the tab to state */
  noteKey?: string;
}

/** One entry in the tab strip, before its data has been fetched. */
export interface SecurityTarget {
  /** URL-safe and unique: the tab name, the URL hash, and the storage key */
  id: string;
  repo: string;
  label: string;
  /** True for the catalogue repos and the NPM packages, false for manifest extensions */
  fixed: boolean;
  scope?: TargetScope;
}

/** Estate totals for the All-repos tab, kept split because the sources do not add up. */
export interface SecurityRollup {
  byRepo: RepoSecurity[];
  /** Totals over Dependabot-sourced repos only */
  dependabot: { repos: number; counts: Record<Severity, number>; total: number };
  /** Totals over public-data repos only. Not comparable with the above. */
  publicData: { repos: number; counts: Record<Severity, number>; total: number };
  failed: string[];
}

export interface SecurityProgress {
  done: number;
  total: number;
  /** Repo currently being read */
  label?: string;
}
