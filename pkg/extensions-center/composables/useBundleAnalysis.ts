import { ref, Ref } from 'vue';

import {
  BUNDLE_ANALYSIS_CACHE_VERSION,
  BUNDLE_ANALYSIS_CONFIGMAP_NAME,
  DASHBOARD_BRANCH,
  DASHBOARD_REPO,
  PUBLISH_BRANCH
} from '../config/constants';
import { AnalysisProgress, AnalysisTarget, BundleAnalysisDoc, ExtensionBundle } from '../types/analysis';
import { GhContentEntry } from '../types/github';
import { RancherStore, errorMessage } from '../types/rancher';
import { mapWithConcurrency } from '../utils/async';
import { addSourceMap, createAccumulator, finaliseTotals } from '../utils/sourceMapStats';
import { parseYarnLock } from '../utils/yarnLock';
import { useAnalysisCache, isAnalysisStale } from './useAnalysisCache';
import { resolveTargets } from './useAnalysisTargets';
import { useGitHubApi, describeGitHubError } from './useGitHubApi';
import { clearRepoLayoutCache } from './useRepoExtensions';

/**
 * What each official extension actually ships, read from its built assets on
 * `gh-pages`.
 *
 * This is the expensive one. Chunk sizes come free with the directory listing,
 * but the per-package breakdown needs the source maps, and those come to around
 * 98MB across the eleven extensions — harvester alone has an 11.6MB chunk map.
 * They are fetched two extensions at a time and each map is folded into a
 * running total and dropped immediately, so peak memory stays at roughly one
 * map rather than all of them.
 */

/** Extensions analysed at once. Deliberately low: each is tens of megabytes. */
const EXT_CONCURRENCY = 2;

/** Source maps in flight within one extension. */
const MAP_CONCURRENCY = 2;

export function useBundleAnalysis(store: RancherStore) {
  const api = useGitHubApi(store);

  /**
   * What shell itself declares as a dependency.
   *
   * Stands in for shell's import graph when deciding whether a package in a
   * bundle got there because shell wanted it. Building the real graph would
   * need every shell source file; this is one request, and in the only
   * direction that matters it gives the same answer — see `bundleCause.ts`.
   */
  const fetchShellDeps = async(): Promise<Set<string>> => {
    try {
      const text = await api.getRawText(DASHBOARD_REPO, DASHBOARD_BRANCH, 'shell/package.json');
      const pkg = JSON.parse(text || '{}') as { dependencies?: Record<string, string> };

      return new Set(Object.keys(pkg.dependencies || {}));
    } catch {
      // Costs the cause column its precision — everything third-party falls
      // back to `extension-dep` — and nothing else. Not worth failing a
      // five-minute rebuild over.
      return new Set();
    }
  };

  /** Resolved versions for one extension, from the lockfile at its tag. */
  const fetchLockVersions = async(target: AnalysisTarget): Promise<Map<string, string[]>> => {
    try {
      // Null is a 404: the repo has no lockfile at that tag, which is a real
      // and acceptable state. Every version column for it simply stays empty.
      return parseYarnLock(await api.getRawText(target.repo, target.ref, 'yarn.lock') || '');
    } catch {
      return new Map();
    }
  };
  const cache = useAnalysisCache<BundleAnalysisDoc>(store, {
    name:    BUNDLE_ANALYSIS_CONFIGMAP_NAME,
    version: BUNDLE_ANALYSIS_CACHE_VERSION,
  });

  const doc: Ref<BundleAnalysisDoc | null> = ref(null);
  const loading = ref(false);
  const rebuilding = ref(false);
  const error: Ref<string | null> = ref(null);
  const progress: Ref<AnalysisProgress | null> = ref(null);
  const needsBuild = ref(false);
  const stale = ref(false);

  /** Populate from the ConfigMap. One Kubernetes read, no GitHub traffic. */
  const load = async(): Promise<void> => {
    loading.value = true;
    error.value = null;

    try {
      const stored = await cache.read();

      doc.value = stored;
      needsBuild.value = !stored;
      stale.value = stored ? isAnalysisStale(stored) : false;
    } catch (e) {
      error.value = errorMessage(e);
      doc.value = null;
      needsBuild.value = true;
    } finally {
      loading.value = false;
    }
  };

  const analyseExtension = async(target: AnalysisTarget, shellDeps: ReadonlySet<string>): Promise<ExtensionBundle> => {
    const base: ExtensionBundle = {
      name:             target.name,
      repo:             target.repo,
      semver:           target.semver,
      inManifest:       target.inManifest,
      pluginDir:        null,
      chunkCount:       0,
      totalBundleBytes: 0,
      chunks:           [],
      hasSourceMaps:    false,
      byCategory:       null,
      byCause:          null,
      byPackage:        null,
      leaks:            null,
      totalSourceBytes: 0,
      ratio:            null,
      shellCausedBytes: 0,
    };

    const dir = `extensions/${ target.name }/${ target.semver }/plugin`;
    let listing: GhContentEntry[];

    try {
      listing = await api.get<GhContentEntry[]>(
        `/repos/${ target.repo }/contents/${ dir }`,
        { ref: PUBLISH_BRANCH }
      );
    } catch (e) {
      // Not every extension publishes its built plugin to gh-pages, and a
      // missing directory is a finding rather than a failure — the row says so
      // instead of disappearing from the table.
      return { ...base, error: describeGitHubError(e) };
    }

    if (!Array.isArray(listing) || !listing.length) {
      return {
        ...base,
        error: store.getters['i18n/t']('extensionsCenter.analysis.errors.noPluginDir'),
      };
    }

    const jsFiles = listing.filter((f) => f.name.endsWith('.js'));
    const mapFiles = listing.filter((f) => f.name.endsWith('.js.map'));

    const chunks = jsFiles.map((f) => ({ name: f.name, bytes: f.size || 0 }))
      .sort((a, b) => b.bytes - a.bytes);

    const withChunks: ExtensionBundle = {
      ...base,
      pluginDir:        dir,
      chunkCount:       chunks.length,
      totalBundleBytes: chunks.reduce((sum, c) => sum + c.bytes, 0),
      chunks,
      hasSourceMaps:    mapFiles.length > 0,
    };

    if (!mapFiles.length) {
      return withChunks;
    }

    const acc = createAccumulator(target.name);
    // Started here rather than awaited, so the lockfile comes down alongside
    // the first source map instead of delaying it. It is a few hundred KB
    // against tens of megabytes of maps.
    const versions = fetchLockVersions(target);

    await mapWithConcurrency(mapFiles, MAP_CONCURRENCY, async(file) => {
      const text = await api.getRawText(target.repo, PUBLISH_BRANCH, `${ dir }/${ file.name }`)
        .catch(() => null);

      if (text) {
        addSourceMap(acc, text);
      }
      // `text` goes out of scope here, which is the point: the next map is not
      // fetched until this one has been folded in and released.
    });

    if (!acc.mapsRead) {
      return withChunks;
    }

    const totals = finaliseTotals(acc, { shellDeps, versions: await versions });

    return {
      ...withChunks,
      byCategory:       totals.byCategory,
      byCause:          totals.byCause,
      byPackage:        totals.byPackage,
      leaks:            totals.leaks,
      totalSourceBytes: totals.totalSourceBytes,
      // Guarded against zero rather than assumed safe: a bundle whose maps all
      // came without `sourcesContent` reads every file as 0 bytes, and the
      // division would hand every table on the page an Infinity.
      ratio:            totals.totalSourceBytes > 0 ? withChunks.totalBundleBytes / totals.totalSourceBytes : null,
      shellCausedBytes: totals.shellCausedBytes,
    };
  };

  /**
   * Rebuild from the published assets, then persist.
   *
   * Tens of megabytes of downloads and several minutes of wall time. Never
   * called except from an explicit refresh.
   */
  const rebuild = async(): Promise<void> => {
    rebuilding.value = true;
    error.value = null;
    progress.value = {
      phase: 'targets', done: 0, total: 0
    };

    try {
      // An explicit refresh re-reads each repo's `pkg/` layout too. A sibling
      // extension added since the last rebuild should appear without needing a
      // browser reload.
      clearRepoLayoutCache();

      const targets = await resolveTargets(store);
      const shellDeps = await fetchShellDeps();

      let done = 0;

      progress.value = {
        phase: 'maps', done: 0, total: targets.length
      };

      const extensions = await mapWithConcurrency(targets, EXT_CONCURRENCY, async(target) => {
        progress.value = {
          phase: 'maps', done, total: targets.length, label: target.name
        };

        const result = await analyseExtension(target, shellDeps);

        done++;
        progress.value = {
          phase: 'maps', done, total: targets.length, label: target.name
        };

        return result;
      });

      const built: BundleAnalysisDoc = {
        version:    BUNDLE_ANALYSIS_CACHE_VERSION,
        fetchedAt:  new Date().toISOString(),
        extensions: extensions.sort((a, b) => b.totalBundleBytes - a.totalBundleBytes),
      };

      doc.value = built;
      needsBuild.value = false;
      stale.value = false;

      progress.value = {
        phase: 'saving', done: 0, total: 1
      };

      if (cache.canWrite()) {
        try {
          await cache.write(built);
        } catch (e) {
          error.value = errorMessage(e);
        }
      }
    } catch (e) {
      error.value = describeGitHubError(e);
    } finally {
      rebuilding.value = false;
      progress.value = null;
    }
  };

  return {
    doc, loading, rebuilding, error, progress, needsBuild, stale, load, rebuild
  };
}
