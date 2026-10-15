/**
 * Data models for the Security page.
 *
 * Deliberately close to what the upstream APIs return. The console this is
 * modelled on lost an afternoon to matchers that re-derived facts from
 * Dependabot PR *titles* — a "multi" PR names one version in its title while
 * bumping three major lines. Carry the fields; do not infer them.
 */

/**
 * Most severe first. `unknown` is a real level rather than a fallback bucket:
 * OSV records routinely carry no GitHub severity at all, and grading those as
 * `low` both understates them and inflates the one level a reader is most
 * likely to dismiss without looking.
 */
export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'unknown'] as const;

export type Severity = typeof SEVERITIES[number];

/** Where a repo's rows came from, which decides what the page can honestly claim. */
export type VulnSource = 'dependabot' | 'public';

export type AlertState = 'open' | 'fixed' | 'dismissed' | 'auto_dismissed';

/** Whether a dependency is needed to run or only to build. */
export type DependencyScope = 'runtime' | 'development';

/**
 * What has to happen next for a finding. See `utils/triage.ts`.
 *
 * Severity says how bad a thing is; this says who has to move. They are not
 * correlated — two of `rancher/dashboard`'s criticals are sitting in an open
 * PR waiting for a reviewer, and most of its highs cannot be fixed at all.
 */
export type TriageStatus = 'in-review' | 'fix-ready' | 'no-fix';

/**
 * Whether a finding reaches a browser or stops at the build.
 *
 * Kept apart from `TriageStatus` because it is a heuristic over manifest paths
 * and scope, and a wrong answer understates real risk. Nothing is allowed to
 * hide a row on the strength of it.
 */
export type Exposure = 'shipped' | 'tooling' | 'unknown';

/**
 * An open Dependabot PR that would move one package to one version.
 *
 * Built from the `updated-dependencies:` commit trailer, which is the only
 * field on a PR that reliably says what it bumps — see `utils/dependabotPr.ts`.
 */
export interface PrFix {
  name: string;
  version: string;
  number: number;
  title: string;
  url: string;
  draft: boolean;
}

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
  /** What to do next about it; derived, not fetched */
  triage: TriageStatus;
  /** Whether it reaches a browser. Derived, and a heuristic — see `Exposure`. */
  exposure: Exposure;
  /** The open PR that would close it, when `triage` is `in-review` */
  prFix: PrFix | null;
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
  /** `mixed` when the package arrives as both a runtime and a build dependency */
  scope: DependencyScope | 'mixed' | null;
  /** ISO date of the earliest open advisory */
  oldest: string | null;
  /** Whichever of its advisories leaves the most to do; see `worstTriage` */
  triage: TriageStatus;
}

/** One series per severity, sharing one date axis. */
export interface SeveritySeries {
  /** Bucket start dates, `YYYY-MM-DD`, oldest first */
  dates: string[];
  critical: number[];
  high: number[];
  medium: number[];
  low: number[];
  unknown: number[];
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
  /**
   * Open advisories by what has to happen next, which is what the summary
   * leads on. This replaced a plain "no published fix" count: `no-fix` is
   * that number exactly, and the other two say who has to move.
   */
  triageCounts: Record<TriageStatus, number>;
  /**
   * Set when the repo's pull requests could not be listed.
   *
   * Separate from `error`, which means the repo could not be read at all. The
   * findings are still correct without this; they just all read `fix-ready`,
   * which overstates the work rather than hiding any of it.
   */
  prError?: string;
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

/**
 * The Security page's results, as persisted.
 *
 * Keyed by target id rather than by repo, because two targets are slices of
 * `rancher/dashboard` and would otherwise overwrite each other.
 *
 * Only the derived results are stored, never the inputs they came from. A
 * repo's thousand-odd Dependabot alerts collapse into its handful of open
 * groups plus a weekly history series, which is why the whole estate fits in
 * one ConfigMap at all.
 */
export interface SecurityDoc {
  version: number;
  /** When the document was last written, as opposed to when each repo was read */
  fetchedAt: string;
  repos: Record<string, RepoSecurity>;
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

// ─── Shell upgrade ───────────────────────────────────────────────────────────

/**
 * Which `@rancher/shell` release the estate is measured against.
 *
 * The npm dist-tag names, used verbatim so the UI can say where the number came
 * from. `pre-release` is a real target rather than a preview: between 3.0.13 and
 * 3.0.14-rc.4 shell moves a further 26 dependencies, so an extension can have a
 * finding that only the rc clears.
 */
export type ShellChannel = 'latest' | 'pre-release';

/** Why an extension's shipped shell version could not be established. */
export type ShellUnknownReason = 'no-lockfile' | 'not-in-lockfile' | 'unreadable';

/**
 * One advisory a shell bump would close, and the evidence for saying so.
 *
 * `removed` is the strongest case and is kept distinct from `repinned`: a
 * dependency shell no longer declares at all cannot be vulnerable at any
 * version, whereas a repin is only as good as the range comparison behind it.
 */
export interface ShellUpgradeFix {
  packageName: string;
  ghsa: string;
  cve: string | null;
  severity: Severity;
  /** How the target shell clears it */
  how: 'removed' | 'repinned';
  /** What shell pins at the target. Null when `how` is `removed`. */
  targetVersion: string | null;
}

/** One extension's distance from the target shell, and what closing it buys. */
export interface ShellUpgradeRow {
  /** Chart name, matching `AnalysisTarget.name` */
  name: string;
  repo: string;
  /** The extension release the shipped version was read out of */
  tag: string;
  /**
   * The exact `@rancher/shell` resolved in that release's lockfile.
   *
   * Null is a result, not a gap — see `unknownReason`. `harvester-ui-extension`
   * names its GitHub release `harvester-1.9.0` while the git tag is `v1.9.0`,
   * and no lockfile resolves at that ref. A guessed version here would be worse
   * than an empty cell, because the whole row is advice about upgrading.
   */
  shippedShell: string | null;
  unknownReason?: ShellUnknownReason;
  /** Repo-relative lockfile the version came from, for a reader to check */
  lockfile?: string;
  /** True when `shippedShell` already equals the target */
  current: boolean;
  /**
   * Advisories against this extension that the bump would clear.
   *
   * A floor rather than a total: shell pins its *direct* dependencies, so
   * anything cleared further down the tree is invisible here. The UI says "at
   * least N" for the same reason `bundleCause.ts` substitutes shell's declared
   * dependencies for its import graph.
   */
  cleared: ShellUpgradeFix[];
  /** Dependencies the target shell drops entirely, vulnerable or not */
  removed: string[];
}

/** The shell-upgrade tab's whole result, including what it was measured against. */
export interface ShellUpgrade {
  channel: ShellChannel;
  /** The `@rancher/shell` version every row is compared with */
  target: string;
  rows: ShellUpgradeRow[];
  fetchedAt: string;
  /** Set when the registry or the releases could not be read at all */
  error?: string;
}
