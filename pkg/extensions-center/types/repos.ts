/**
 * Data models for the two repo tables: the official upstream extension repos
 * and the wider set of known (mostly community) extension repos.
 */

/**
 * One official extension.
 *
 * A row is an extension rather than a repo. Those were the same thing until
 * `neuvector/security-ui-exts` arrived publishing four `pkg/` directories out
 * of one repo, so `id` carries both halves and several rows can share `repo`.
 */
export interface OfficialRepo {
  /** `owner/name/chart` — unique per extension, not per repo */
  id: string;
  /** Chart name: the `pkg/` directory, and the manifest key when it has one */
  name: string;
  /** `owner/name` */
  repo: string;
  repoUrl: string;
  /** Branch the manifest points at, usually `main` */
  headBranch: string;
  /** `@rancher/shell` version pinned on the head branch, null if not resolvable */
  shellVersion: string | null;
  /** Latest non-prerelease version on the extension's own `gh-pages` branch */
  publishedVersion: string | null;
  /** `@rancher/components` version pinned on the head branch, null if not resolvable */
  componentsVersion: string | null;
  /** Latest non-prerelease version in the rancher/ui-plugin-charts `index.yaml` */
  latestOfficialVersion: string | null;
  /**
   * True when the team has published something the official catalogue does not
   * carry yet. Both versions have to be known for this to mean anything, so a
   * repo whose `gh-pages` could not be read is never flagged.
   */
  outOfSync: boolean;
  /**
   * False for an extension found in a repo's `pkg/` but absent from
   * `manifest.json` — built and published like its siblings, just not in the
   * official catalogue yet. Shown and marked rather than hidden.
   */
  inManifest: boolean;
  /** Set when one of the version lookups failed, so the row can explain itself */
  error?: string;
}

/**
 * Where an extension comes from.
 *
 * This used to be a set of functional categories produced by a model. That
 * layer is coming back later; until it does, the only categorisation worth
 * showing is the one already present in the data, which is who owns the repo.
 */
export type RepoOrigin = 'suse' | 'external';

/** A known extension repo, official or community */
export interface KnownRepo {
  /** `owner/name` — used as the row id and as the cache key */
  id: string;
  /** Human-friendly extension name, derived from the repo name */
  name: string;
  repoUrl: string;
  /** GitHub's own repo description, often empty */
  description: string;
  /** True when the repo is not owned by a SUSE/Rancher org */
  isExternal: boolean;
  /** Signals feeding the "top 10" ranking */
  stars: number;
  releaseCount: number;
  lastPushedAt: string | null;
  /** Computed popularity score used to sort the table */
  score: number;
}

/** Total plus a SUSE/external split, rendered next to the known repos table */
export interface CategorySummary {
  total: number;
  byOrigin: { origin: RepoOrigin; count: number }[];
}

/**
 * The document persisted in the known-repos ConfigMap.
 *
 * This holds the *whole* table, not just part of it. Building it costs a
 * paginated code search plus two GitHub calls for every repo found, so the
 * result is stored complete and replayed on every subsequent visit. Only an
 * explicit refresh rebuilds it.
 */
export interface KnownReposDoc {
  /** Matches `KNOWN_REPOS_CACHE_VERSION`; anything else is discarded */
  version: number;
  /** ISO timestamp of the rebuild that produced `repos` */
  fetchedAt: string;
  repos: KnownRepo[];
}
