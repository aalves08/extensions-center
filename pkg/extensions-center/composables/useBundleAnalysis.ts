import { ref, Ref } from 'vue';

import {
  BUNDLE_ANALYSIS_CACHE_VERSION,
  BUNDLE_ANALYSIS_CONFIGMAP_NAME,
  PUBLISH_BRANCH
} from '../config/constants';
import { AnalysisProgress, AnalysisTarget, BundleAnalysisDoc, ExtensionBundle } from '../types/analysis';
import { GhContentEntry } from '../types/github';
import { RancherStore, errorMessage } from '../types/rancher';
import { mapWithConcurrency } from '../utils/async';
import { addSourceMap, createAccumulator, finaliseTotals } from '../utils/sourceMapStats';
import { useAnalysisCache, isAnalysisStale } from './useAnalysisCache';
import { resolveTargets } from './useAnalysisTargets';
import { useGitHubApi, describeGitHubError } from './useGitHubApi';

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

  const analyseExtension = async(target: AnalysisTarget): Promise<ExtensionBundle> => {
    const base: ExtensionBundle = {
      name:             target.name,
      repo:             target.repo,
      semver:           target.semver,
      pluginDir:        null,
      chunkCount:       0,
      totalBundleBytes: 0,
      chunks:           [],
      hasSourceMaps:    false,
      byCategory:       null,
      byPackage:        null,
      leaks:            null,
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

    const totals = finaliseTotals(acc);

    return {
      ...withChunks,
      byCategory: totals.byCategory,
      byPackage:  totals.byPackage,
      leaks:      totals.leaks,
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
      const targets = await resolveTargets(store);

      let done = 0;

      progress.value = {
        phase: 'maps', done: 0, total: targets.length
      };

      const extensions = await mapWithConcurrency(targets, EXT_CONCURRENCY, async(target) => {
        progress.value = {
          phase: 'maps', done, total: targets.length, label: target.name
        };

        const result = await analyseExtension(target);

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
