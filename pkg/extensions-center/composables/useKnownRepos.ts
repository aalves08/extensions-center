import { ref, computed, Ref } from 'vue';

import { GhCodeSearchResponse, GhRelease, GhRepo } from '../types/github';
import { RancherStore, errorMessage } from '../types/rancher';
import { CategorySummary, KnownRepo, RepoOrigin } from '../types/repos';
import { mapWithConcurrency } from '../utils/async';
import { fallbackName } from '../utils/names';
import { fetchOfficialRepoIds } from './useOfficialRepos';
import { useGitHubApi, describeGitHubError } from './useGitHubApi';
import { useKnownReposCache, isStale } from './useKnownReposCache';

/**
 * The search that finds extension repos: anything referencing the shared
 * build-extension-charts workflow from rancher/dashboard. This is the same
 * query the manual `gh api` script used, plus a path filter applied client-side.
 */
const SEARCH_QUERY = [
  'rancher/dashboard/.github/workflows/build-extension-charts.yml',
  'NOT path:docusaurus',
  'NOT path:shell/creators',
  'NOT filename:check-creators-workflows-code.sh',
  '-repo:rancher/dashboard',
].join(' ');

/** GitHub caps code search at 1000 results (10 pages of 100). */
const MAX_SEARCH_PAGES = 10;
const SEARCH_PAGE_SIZE = 100;

/** How many GitHub calls we keep in flight while enriching repos. */
const CONCURRENCY = 6;

/** Orgs whose repos count as first-party rather than external. */
const SUSE_ORGS = new Set([
  'rancher', 'suse', 'suse-edge', 'harvester', 'neuvector', 'longhorn', 'rancher-sandbox', 'rancher-ecp-ui',
]);

/**
 * Repos that match the search but are not shippable extensions: scaffolding
 * output, teaching material, and forks of rancher/dashboard itself.
 */
const NOISE_PATTERN = /(^|[-_/])(example|examples|hello[-_]?world|demo|sample|samples|template|boilerplate|scaffold|playground|poc|sandbox|tutorial|workshop|test|tests|testing)([-_]|$)/i;

function isNoise(id: string): boolean {
  const repoName = id.split('/')[1] || '';

  return NOISE_PATTERN.test(repoName);
}

function isExternalOwner(id: string): boolean {
  return !SUSE_ORGS.has((id.split('/')[0] || '').toLowerCase());
}

/**
 * Ranking signal for the "top 10".
 *
 * Stars are the popularity proxy, release count stands in for how actively the
 * extension is shipped, and a recency term stops long-dead repos from squatting
 * the top of the table on historical stars alone.
 */
function scoreRepo(stars: number, releaseCount: number, lastPushedAt: string | null): number {
  const pushed = lastPushedAt ? new Date(lastPushedAt).getTime() : 0;
  const monthsSincePush = pushed ? (Date.now() - pushed) / (30 * 24 * 60 * 60 * 1000) : 999;
  const recency = Math.max(0, 24 - monthsSincePush);

  return (stars * 3) + (releaseCount * 2) + recency;
}

/**
 * The known-extensions table.
 *
 * Two entry points, and the difference between them is the whole point of this
 * module:
 *
 * - `load()` reads the finished table out of a ConfigMap. One Kubernetes call,
 *   no GitHub traffic. This is what a page visit does.
 * - `rebuild()` assembles the table from scratch — a paginated code search plus
 *   two GitHub calls per repo found. Hundreds of requests. This only ever runs
 *   because someone pressed refresh.
 *
 * Previously there was only the second one and every visit paid for it, which
 * is what made entering the dashboard fire hundreds of requests.
 */
export function useKnownRepos(store: RancherStore) {
  const api = useGitHubApi(store);
  const cache = useKnownReposCache(store);

  const data: Ref<KnownRepo[]> = ref([]);
  const loading = ref(false);
  const error: Ref<string | null> = ref(null);
  const lastRefreshed: Ref<Date | null> = ref(null);
  /** True when `data` came from the ConfigMap rather than a rebuild */
  const fromCache = ref(false);
  /** True when there is no cached table yet, so the table is empty until asked */
  const needsBuild = ref(false);
  /** True when the cached table is older than the TTL */
  const stale = ref(false);

  /** Page through code search and keep only hits inside `.github/workflows/`. */
  const discover = async(): Promise<string[]> => {
    const ids = new Set<string>();

    for (let page = 1; page <= MAX_SEARCH_PAGES; page++) {
      const res = await api.get<GhCodeSearchResponse>('/search/code', {
        q: SEARCH_QUERY, per_page: SEARCH_PAGE_SIZE, page
      });

      const items = res.items || [];

      items.forEach((item) => {
        // The query matches file *content*, so it also hits docs and security
        // rulesets that merely quote the workflow path. A real consumer wires
        // it up from its own workflows directory.
        if (item.path?.startsWith('.github/workflows/')) {
          ids.add(item.repository.full_name);
        }
      });

      if (items.length < SEARCH_PAGE_SIZE) {
        break;
      }
    }

    return [...ids];
  };

  /**
   * Populate from the ConfigMap. Costs one Kubernetes read and nothing else.
   *
   * A missing cache is not an error: it means nobody has built the table yet,
   * and `needsBuild` lets the page say so rather than showing an empty table
   * that looks broken. It deliberately does *not* rebuild on its own — that
   * would reintroduce the surprise cost this whole design exists to remove.
   */
  const load = async(): Promise<void> => {
    loading.value = true;
    error.value = null;

    try {
      const doc = await cache.read();

      if (!doc) {
        data.value = [];
        needsBuild.value = true;
        fromCache.value = false;
        lastRefreshed.value = null;

        return;
      }

      data.value = doc.repos;
      needsBuild.value = false;
      fromCache.value = true;
      stale.value = isStale(doc);
      lastRefreshed.value = new Date(doc.fetchedAt);
    } catch (e) {
      error.value = errorMessage(e);
      data.value = [];
      needsBuild.value = true;
    } finally {
      loading.value = false;
    }
  };

  /**
   * Rebuild the table from GitHub, then persist it.
   *
   * Expensive by nature — see the module comment — so nothing calls this except
   * an explicit user action.
   */
  const rebuild = async(): Promise<void> => {
    loading.value = true;
    error.value = null;

    try {
      const [discovered, officialIds] = await Promise.all([
        discover(),
        fetchOfficialRepoIds(store).catch(() => new Set<string>()),
      ]);

      // Official repos are always in the full list even if code search misses
      // them, and the noise filter never applies to them.
      const candidates = [...new Set([...discovered, ...officialIds])]
        .filter((id) => officialIds.has(id.toLowerCase()) || !isNoise(id));

      const enriched = await mapWithConcurrency(candidates, CONCURRENCY, async(id): Promise<KnownRepo | null> => {
        try {
          const repo = await api.get<GhRepo>(`/repos/${ id }`);

          // Forks of rancher/dashboard (and of other extensions) match the
          // search but are not extensions in their own right.
          if (repo.fork) {
            return null;
          }

          const releases = await api
            .get<GhRelease[]>(`/repos/${ id }/releases`, { per_page: 100 })
            .catch(() => [] as GhRelease[]);

          const stars = repo.stargazers_count || 0;
          const lastPushedAt = repo.pushed_at || null;

          return {
            id:           repo.full_name,
            name:         fallbackName(repo.full_name),
            repoUrl:      repo.html_url,
            description:  repo.description || '',
            isExternal:   isExternalOwner(repo.full_name),
            stars,
            releaseCount: releases.length,
            lastPushedAt,
            score:        scoreRepo(stars, releases.length, lastPushedAt),
          };
        } catch {
          // Renamed, deleted or private since the search index was built.
          return null;
        }
      });

      const rows = enriched.filter((r): r is KnownRepo => r !== null);

      data.value = rows.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
      lastRefreshed.value = new Date();
      fromCache.value = false;
      needsBuild.value = false;
      stale.value = false;

      // Awaited rather than fire-and-forget: this write is the entire reason
      // the next visit is free, so if it fails the user should find out now
      // instead of silently paying for another rebuild later.
      if (rows.length && cache.canWrite()) {
        try {
          await cache.write(data.value);
        } catch (e) {
          console.warn('extensions-center: could not persist known repos cache', e); // eslint-disable-line no-console
          error.value = errorMessage(e);
        }
      }
    } catch (e) {
      error.value = describeGitHubError(e);
      data.value = [];
    } finally {
      loading.value = false;
    }
  };

  /** Community repos only — the dashboard table shows the top slice of these. */
  const community = computed(() => data.value.filter((r) => r.isExternal));

  /**
   * Total plus the SUSE/external split across the full list.
   *
   * Both buckets are always emitted, zero included: "no community extensions
   * found" is a result, and a row that silently vanishes reads as a bug.
   */
  const summary = computed((): CategorySummary => {
    const external = data.value.filter((r) => r.isExternal).length;

    const byOrigin: { origin: RepoOrigin; count: number }[] = [
      { origin: 'suse', count: data.value.length - external },
      { origin: 'external', count: external },
    ];

    return { total: data.value.length, byOrigin };
  });

  return {
    data,
    community,
    summary,
    loading,
    error,
    lastRefreshed,
    fromCache,
    needsBuild,
    stale,
    load,
    rebuild,
  };
}
