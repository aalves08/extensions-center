import { Ref, ref } from 'vue';

import {
  OFFICIAL_MANIFEST_PATH, OFFICIAL_MANIFEST_REPO, SECURITY_CACHE_VERSION,
  SECURITY_CONFIGMAP_NAME, SECURITY_FIXED_REPOS, SECURITY_NPM_TARGETS
} from '../config/constants';
import { Manifest } from '../types/github';
import { errorMessage, RancherStore } from '../types/rancher';
import {
  PrFix, RepoSecurity, SecurityDoc, SecurityProgress, SecurityRollup, SecurityTarget, Severity
} from '../types/security';
import { addCounts, emptyCounts } from '../utils/severity';
import { applyPrs, emptyTriageCounts } from '../utils/triage';
import { useAnalysisCache } from './useAnalysisCache';
import { useDependabotPrs } from './useDependabotPrs';
import { describeGitHubError, useGitHubApi } from './useGitHubApi';
import { usePublicVulns } from './usePublicVulns';
import { clearRepoLayoutCache, repoLayout } from './useRepoExtensions';
import { AlertsUnavailableError, useSecurityAlerts } from './useSecurityAlerts';

/**
 * The Security page's data layer.
 *
 * Per-repo loads are lazy — you pay for the tab you click. The estate rollup
 * is the one view that cannot be lazy, since it needs all of them, so the page
 * puts it behind a button rather than firing ~800 requests on page open.
 */

/**
 * Page state, module-level so it outlives the page being unmounted, and
 * written through to a ConfigMap so it outlives the tab.
 *
 * The Security page is one route among nine and a full pull is minutes of
 * work, so charging someone for it again — because they clicked Settings and
 * came back, because they reloaded, or because they are the second person on
 * the team to open it today — is not a defensible trade.
 *
 * Persisting it means accepting that what is on screen may be old, so nothing
 * here pretends otherwise. Data is re-read only when someone asks, never on a
 * timer, and the page states the age of what it is showing and escalates that
 * statement past `SECURITY_OVERDUE_DAYS`. Loud and old beats silent and
 * old; what the previous design avoided was the silence, not the age.
 */
const targets: Ref<SecurityTarget[]> = ref([]);
const loaded: Ref<Record<string, RepoSecurity>> = ref({});
const loading: Ref<Record<string, boolean>> = ref({});
const targetsError: Ref<string | null> = ref(null);
const rollupProgress: Ref<SecurityProgress | null> = ref(null);

/** Whether the stored document has been read this tab. One read, not one per visit. */
const restored = ref(false);

/**
 * Set when the document could not be saved.
 *
 * Surfaced rather than thrown: a failed write costs the *next* visit its head
 * start and nothing else, so it must not take down a page whose data is
 * already loaded and correct.
 */
const cacheError: Ref<string | null> = ref(null);

/**
 * Whether the estate view has been filled at least once.
 *
 * Lives here rather than in the page for the same reason as everything above:
 * it is what tells a returning visitor they are looking at a loaded table
 * instead of the "this costs a minute" prompt.
 */
const rollupLoaded = ref(false);

/**
 * Package names a `package.json` declares, cached per file.
 *
 * `dependencies` and `peerDependencies` only — see `SECURITY_NPM_TARGETS`
 * for why `devDependencies` are deliberately left out.
 */
const declaredCache = new Map<string, Set<string>>();

export function useRepoSecurity(store: RancherStore) {
  const api = useGitHubApi(store);
  const alerts = useSecurityAlerts(store);
  const publicVulns = usePublicVulns();
  const prs = useDependabotPrs(store);

  const cache = useAnalysisCache<SecurityDoc>(store, {
    name:     SECURITY_CONFIGMAP_NAME,
    version:  SECURITY_CACHE_VERSION,
    // ~870KB of JSON across the estate, ~40KB gzipped. See the constant.
    compress: true,
  });

  const declaredPackages = async(repo: string, path: string): Promise<Set<string>> => {
    const key = `${ repo }:${ path }`;
    const hit = declaredCache.get(key);

    if (hit) {
      return hit;
    }

    const pkg = await api.getJsonFile<{
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    }>(repo, path);

    if (!pkg) {
      throw new Error(`${ path } could not be read from ${ repo }`);
    }

    const names = new Set([
      ...Object.keys(pkg.dependencies || {}),
      ...Object.keys(pkg.peerDependencies || {}),
    ]);

    declaredCache.set(key, names);

    return names;
  };

  /**
   * The tab strip: the catalogue repos, the two NPM packages, then one tab per
   * official extension repo.
   *
   * The extensions are read live from `manifest.json` rather than hardcoded,
   * so refreshing the official extensions list adds a tab for any new
   * extension with no code change — which is the whole reason this is not a
   * constant.
   */
  const loadTargets = async(force = false): Promise<void> => {
    // The tab strip only changes when an extension is added to the manifest,
    // so re-reading it on every visit buys nothing. A previous *failure* is
    // not a result worth keeping, though — that would leave the strip
    // permanently short of every manifest extension until a browser refresh.
    if (targets.value.length && !targetsError.value && !force) {
      return;
    }

    if (force) {
      // Re-read each repo's `pkg/` too, so a sibling added upstream shows up
      // in the tab's name.
      clearRepoLayoutCache();
    }

    targetsError.value = null;

    // The two published packages lead, ahead of the catalogue repos: they are
    // what every extension author actually depends on, so a vulnerability in
    // one of them is the thing this page most needs to put in front of you.
    const taken = new Set<string>();
    const fixed: SecurityTarget[] = [
      ...SECURITY_NPM_TARGETS.map((t) => ({ ...t, id: uniqueId(t.id, taken) })),
      ...SECURITY_FIXED_REPOS.map((repo) => ({
        id:    uniqueId(repo.split('/')[1], taken),
        repo,
        label: repo.split('/')[1],
        fixed: true,
      })),
    ];

    try {
      const manifest = await api.getJsonFile<Manifest>(OFFICIAL_MANIFEST_REPO, OFFICIAL_MANIFEST_PATH);

      // One tab per *repo*, not per extension. Vulnerabilities are raised
      // against a repo's lockfile, so two extensions out of one repo would
      // have produced two tabs showing byte-identical rows — and doubled the
      // cost of the estate rollup to do it. The tab names every extension it
      // covers so the duplicate is visibly gone rather than silently dropped.
      const byRepo = new Map<string, string[]>();

      for (const [name, entry] of Object.entries(manifest?.extensions || {})) {
        if (!entry?.repo || SECURITY_FIXED_REPOS.includes(entry.repo as typeof SECURITY_FIXED_REPOS[number])) {
          continue;
        }

        byRepo.set(entry.repo, [...(byRepo.get(entry.repo) || []), name]);
      }

      // `repoLayout` adds the siblings the manifest never named, and falls back
      // to the manifest names on its own if the `pkg/` read fails — so a
      // discovery problem costs the tab a name, not the tab.
      const labelled = await Promise.all([...byRepo.entries()].map(async([repo, names]) => {
        const layout = await repoLayout(store, repo, names);

        return { repo, label: layout.extensions.map((e) => e.name).join(' + ') || names.join(' + ') };
      }));

      // Keyed on the repo rather than the label, same as the fixed targets
      // above: the label now grows a name every time a team adds a `pkg/` dir,
      // and this id is the URL hash.
      const extensions: SecurityTarget[] = labelled
        .sort((a, b) => a.label.localeCompare(b.label))
        .map((t) => ({
          ...t, fixed: false, id: uniqueId(t.repo.split('/')[1], taken)
        }));

      targets.value = [...fixed, ...extensions];
    } catch (e) {
      // The fixed targets still work without the manifest, so the page
      // degrades to those rather than showing nothing at all.
      targets.value = fixed;
      targetsError.value = describeGitHubError(e);
    }
  };

  /**
   * Replay the stored document into page state.
   *
   * Call after `loadTargets`, never before: results are matched against the
   * current tab strip, so an extension dropped from the manifest since the
   * document was written is discarded rather than given a tab back.
   *
   * Failing is not an error anyone needs to see. The worst case is the page
   * behaving exactly as it did before it had a cache.
   */
  const restore = async(): Promise<void> => {
    if (restored.value) {
      return;
    }

    restored.value = true;

    try {
      const doc = await cache.read();

      if (!doc) {
        return;
      }

      const ids = targets.value.map((t) => t.id);
      const kept: Record<string, RepoSecurity> = {};

      for (const id of ids) {
        const stored = doc.repos[id];

        // Anything already loaded this session is newer by definition.
        if (stored && !loaded.value[id]) {
          kept[id] = stored;
        }
      }

      loaded.value = { ...kept, ...loaded.value };

      // Only when the document covers *every* target. `rollup()` renders
      // whatever happens to be loaded, so flipping this on a partial restore
      // would present a subset of the estate as the whole of it and understate
      // every total — the one failure this page cannot afford.
      rollupLoaded.value = ids.length > 0 && ids.every((id) => !!loaded.value[id]);
    } catch {
      // Unreadable or corrupt: the page loads from scratch, which is the
      // behaviour it had before this existed.
    }
  };

  /**
   * Write the loaded results back.
   *
   * The whole document each time, including on a single tab's refresh. One
   * ConfigMap write of ~55KB is not worth splitting into eighteen objects to
   * avoid, and a single object keeps the restore to one read.
   *
   * Failed repos are dropped rather than stored. A cached failure is never
   * honoured anywhere else in this file, so persisting one would only make the
   * document bigger and the next visit's restore wronger.
   */
  const persist = async(): Promise<void> => {
    if (!cache.canWrite()) {
      return;
    }

    const repos: Record<string, RepoSecurity> = {};

    for (const [id, result] of Object.entries(loaded.value)) {
      if (!result.error) {
        repos[id] = result;
      }
    }

    if (!Object.keys(repos).length) {
      return;
    }

    try {
      await cache.write({
        version:   SECURITY_CACHE_VERSION,
        fetchedAt: new Date().toISOString(),
        repos,
      });

      cacheError.value = null;
    } catch (e) {
      cacheError.value = errorMessage(e);
    }
  };

  /**
   * A repo's open Dependabot PRs, with a failure reported rather than raised.
   *
   * Listing pull requests is the one part of a repo's fetch that is allowed to
   * fail without failing the fetch. Without it every fixable finding reads
   * `fix-ready`, which overstates the work left — the safe direction — whereas
   * throwing would cost the tab its findings over an annotation.
   */
  const prFixes = async(repo: string): Promise<{ fixes: PrFix[]; error?: string }> => {
    try {
      return { fixes: await prs.load(repo) };
    } catch (e) {
      return { fixes: [], error: describeGitHubError(e) };
    }
  };

  /**
   * One repo, Dependabot first and public data second.
   *
   * The fallback is not a fault path. Our token has no standing on
   * `neuvector/*`, `harvester/*` or `StackVista/*`, and those are official
   * extensions people ship — so "we cannot see it" is not an acceptable
   * answer for them. What matters is that the row says where it came from.
   */
  const fetchTarget = async(target: SecurityTarget, force = false): Promise<RepoSecurity> => {
    const existing = loaded.value[target.id];

    // Served however old it is, unless someone asked for a re-read. Age is
    // reported on screen and escalated past `SECURITY_OVERDUE_DAYS` rather
    // than acted on here: re-reading costs a paginated alert pull or an SBOM
    // plus dozens of OSV calls, and spending that on a timer, silently, is
    // what a persisted cache exists to avoid.
    //
    // A cached *failure* is the exception. The usual cause is a transient rate
    // limit, and a tab that stays broken until a browser refresh is a worse
    // outcome than one extra request.
    if (existing && !force && !existing.error) {
      return existing;
    }

    loading.value = { ...loading.value, [target.id]: true };

    try {
      let result: RepoSecurity;

      // Started before the alerts rather than after them: it is one list call
      // plus one per Dependabot PR, and there is no reason for the reader to
      // wait for it in series behind a paginated alert pull.
      //
      // Run for public-data repos too. Their *alerts* are private to the owner,
      // but their pull requests are not — so a repo this page can only read
      // through an SBOM can still show that a fix is already open.
      const openPrs = prFixes(target.repo);

      try {
        const shared = target.scope?.shared;
        const declared = shared ? await declaredPackages(target.repo, shared.declaredBy) : undefined;

        result = await alerts.load(target, declared);
      } catch (e) {
        // A narrowed target cannot fall back. Public data is whole-repo, so
        // serving it here would label the entire dashboard monorepo as one
        // package's vulnerabilities — an error is the honest answer.
        if (!(e instanceof AlertsUnavailableError) || target.scope) {
          throw e;
        }

        result = await publicVulns.load(target.id, target.repo, target.label);
      }

      const { fixes, error: prError } = await openPrs;

      result = {
        ...applyPrs(result, fixes), noteKey: target.scope?.noteKey, prError
      };
      loaded.value = { ...loaded.value, [target.id]: result };

      return result;
    } catch (e) {
      const failed: RepoSecurity = {
        id:           target.id,
        repo:         target.repo,
        label:        target.label,
        source:       'public',
        groups:       [],
        counts:       emptyCounts(),
        openTotal:    0,
        triageCounts: emptyTriageCounts(),
        oldestOpen:   null,
        history:      null,
        unresolved:   0,
        fetchedAt:    new Date().toISOString(),
        error:        describeGitHubError(e),
      };

      loaded.value = { ...loaded.value, [target.id]: failed };

      return failed;
    } finally {
      loading.value = { ...loading.value, [target.id]: false };
    }
  };

  const loadRepo = async(target: SecurityTarget, force = false): Promise<RepoSecurity> => {
    if (force) {
      alerts.invalidate(target.repo);
      // Not per repo: `useDependabotPrs` holds one entry per repo and a
      // refresh of one tab is a cheap excuse to re-read all of them.
      prs.invalidate();
    }

    const before = loaded.value[target.id];
    const result = await fetchTarget(target, force);

    // Only when something actually changed. Opening an already-loaded tab is
    // the common case and must not cost a write.
    if (result !== before && !result.error) {
      await persist();
    }

    return result;
  };

  /**
   * Every repo, for the estate view.
   *
   * Sequential rather than parallel across repos: each repo is already
   * running eight requests at a time internally, and sixteen of those at once
   * is how you get rate-limited by OSV. Anything already loaded is reused, so
   * this gets cheaper the more tabs have been visited.
   */
  const loadAll = async(force = false): Promise<void> => {
    const list = targets.value;

    // Cleared once here rather than per target, because two targets are slices
    // of `rancher/dashboard` and forcing each in turn would pull that one
    // alert list twice in a single pass.
    if (force) {
      alerts.invalidate();
      prs.invalidate();
    }

    rollupProgress.value = { done: 0, total: list.length };

    for (let i = 0; i < list.length; i++) {
      rollupProgress.value = {
        done: i, total: list.length, label: list[i].label
      };
      await fetchTarget(list[i], force);
    }

    rollupProgress.value = null;

    // Once, at the end, rather than per repo: eighteen writes of a document
    // that grows with each one is eighteen times the cost for the same result.
    await persist();
  };

  /**
   * How current the loaded data is, as the oldest fetch among the repos shown.
   *
   * The oldest rather than the newest: a rollup is only as fresh as its
   * staleest repo, and reporting the most recent fetch would claim the whole
   * estate was read a second ago when most of it came out of the session cache.
   */
  const lastRefreshed = (ids?: string[]): Date | null => {
    const keys = ids || Object.keys(loaded.value);
    const times = keys
      .map((id) => loaded.value[id]?.fetchedAt)
      .filter((t): t is string => !!t)
      .map((t) => new Date(t).getTime());

    return times.length ? new Date(Math.min(...times)) : null;
  };

  /**
   * Estate totals, kept split by source.
   *
   * Never one number. Public-data counts run higher than Dependabot ones —
   * nothing is dismissed and nothing is deduplicated — so adding them would
   * produce a headline figure that means nothing and quietly overstates the
   * repos we can see least well.
   */
  const rollup = (): SecurityRollup => {
    const byRepo = targets.value
      .map((t) => loaded.value[t.id])
      .filter((r): r is RepoSecurity => !!r);

    const make = (source: RepoSecurity['source']) => {
      const repos = byRepo.filter((r) => r.source === source && !r.error);
      const counts: Record<Severity, number> = emptyCounts();

      repos.forEach((r) => addCounts(counts, r.counts));

      return {
        repos: repos.length,
        counts,
        total: repos.reduce((sum, r) => sum + r.openTotal, 0),
      };
    };

    return {
      byRepo: [...byRepo].sort((a, b) => {
        return b.counts.critical - a.counts.critical ||
          b.counts.high - a.counts.high ||
          b.openTotal - a.openTotal;
      }),
      dependabot: make('dependabot'),
      publicData: make('public'),
      // Labelled rather than named by repo: two targets share
      // `rancher/dashboard`, and "Could not read: rancher/dashboard,
      // rancher/dashboard" tells nobody which one.
      failed:     byRepo.filter((r) => r.error).map((r) => r.label),
    };
  };

  return {
    targets,
    targetsError,
    cacheError,
    loaded,
    loading,
    rollupProgress,
    rollupLoaded,
    loadTargets,
    restore,
    loadRepo,
    loadAll,
    lastRefreshed,
    rollup,
  };
}

/**
 * A URL-safe tab id, unique within the strip.
 *
 * It ends up in the page URL as a hash, so it cannot be the repo slug — a
 * slash there survives as `%2F` and no longer matches the tab name the shell
 * compares it against. The suffix is for the case nobody expects: a manifest
 * extension whose chart name slugifies onto one already taken.
 */
function uniqueId(from: string, taken: Set<string>): string {
  const base = from.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'repo';
  let id = base;

  for (let n = 2; taken.has(id); n++) {
    id = `${ base }-${ n }`;
  }

  taken.add(id);

  return id;
}
