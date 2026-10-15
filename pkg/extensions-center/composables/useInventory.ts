import { ref, Ref } from 'vue';

import {
  INVENTORY_CACHE_VERSION,
  INVENTORY_CONCURRENCY,
  INVENTORY_CONFIGMAP_NAME,
  SHELL_LOCKFILE,
  SHELL_PACKAGE
} from '../config/constants';
import { AnalysisProgress, AnalysisTarget } from '../types/analysis';
import { GhRepo } from '../types/github';
import { InventoryDoc, InventoryExtension } from '../types/inventory';
import { RancherStore, errorMessage } from '../types/rancher';
import { mapWithConcurrency } from '../utils/async';
import { parseYarnLock } from '../utils/yarnLock';
import { useAnalysisCache, isAnalysisStale } from './useAnalysisCache';
import { resolveTargets } from './useAnalysisTargets';
import { useGitHubApi, describeGitHubError } from './useGitHubApi';

/**
 * Building and holding the package inventory. See `types/inventory.ts` for why
 * it exists separately from everything else on the Security page.
 *
 * Cost of a rebuild is one tree listing plus one file per extension. The files
 * are large — the lockfiles measured ran 594KB to 730KB — but they come from
 * the raw host rather than the API, so none of it is charged against the rate
 * limit. Stored compressed: the five real lockfiles measured came to 235KB of
 * JSON as a name-to-versions map and 62KB gzipped, which extrapolates to
 * roughly 230KB base64 across the estate, comfortably inside the ceiling in
 * `useAnalysisCache`.
 */
export function useInventory(store: RancherStore) {
  const api = useGitHubApi(store);
  const cache = useAnalysisCache<InventoryDoc>(store, {
    name:     INVENTORY_CONFIGMAP_NAME,
    version:  INVENTORY_CACHE_VERSION,
    compress: true,
  });

  const doc: Ref<InventoryDoc | null> = ref(null);
  const loading = ref(false);
  const rebuilding = ref(false);
  const error: Ref<string | null> = ref(null);
  const progress: Ref<AnalysisProgress | null> = ref(null);
  /** True when nothing has been stored yet, so the page can explain the emptiness */
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

  /** Default branch of a repo, for the fallback when a tag is not a real ref. */
  const defaultBranch = async(repo: string): Promise<string | null> => {
    return api.get<GhRepo>(`/repos/${ repo }`).then((r) => r.default_branch).catch(() => null);
  };

  /**
   * Every lockfile in a tree, shallowest first.
   *
   * Shallowest because the root is the extension's own tree in every repo
   * checked, while the deeper ones belong to test harnesses and mock servers.
   */
  const lockfilePaths = async(repo: string, ref: string): Promise<string[]> => {
    const tree = await api.getTree(repo, ref);

    return tree.tree
      .filter((entry) => entry.type === 'blob' && (entry.path === SHELL_LOCKFILE || entry.path.endsWith(`/${ SHELL_LOCKFILE }`)))
      .map((entry) => entry.path)
      .sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
  };

  /**
   * One extension's resolved tree.
   *
   * Two things are deliberate here. The ref falls back to the default branch
   * when the tagged one cannot be read, because a release name is not always a
   * git ref — `harvester-ui-extension` publishes releases called
   * `harvester-1.9.0` against tags called `v1.9.0` — and HEAD with a label
   * saying so beats an empty row. And the lockfile is chosen by which one
   * actually resolves `@rancher/shell` rather than by assuming the root, which
   * is the same self-validating rule the shell-upgrade tab uses: a repo's
   * `tests/` or `mock-agent/` lockfile is a real lockfile and the wrong one.
   */
  const readExtension = async(target: AnalysisTarget): Promise<InventoryExtension> => {
    const base = {
      name:   target.name,
      repo:   target.repo,
      tag:    target.tag,
      semver: target.semver,
    };

    let ref = target.ref;
    let source = target.source;
    let paths: string[] = [];

    try {
      paths = await lockfilePaths(target.repo, ref);
    } catch {
      const branch = await defaultBranch(target.repo);

      if (branch) {
        ref = branch;
        source = 'branch';
        paths = await lockfilePaths(target.repo, ref).catch(() => []);
      }
    }

    if (!paths.length) {
      return {
        ...base, source, lockfile: null, packages: {}, error: 'no-lockfile',
      };
    }

    let fallback: InventoryExtension | null = null;

    for (const path of paths) {
      const text = await api.getRawText(target.repo, ref, path).catch(() => null);

      if (!text) {
        continue;
      }

      const parsed = parseYarnLock(text);

      if (!parsed.size) {
        continue;
      }

      const entry: InventoryExtension = {
        ...base, source, lockfile: path, packages: Object.fromEntries(parsed),
      };

      if (parsed.has(SHELL_PACKAGE)) {
        return entry;
      }

      // Readable but not the extension's own tree. Kept in case nothing
      // better turns up, since a partial inventory still beats none — the row
      // names the file it came from either way.
      fallback = fallback || entry;
    }

    return fallback || {
      ...base, source, lockfile: null, packages: {}, error: 'unreadable',
    };
  };

  /** Rebuild from GitHub, then persist. Never called except from a refresh. */
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
        phase: 'lockfiles', done: 0, total: targets.length
      };

      const extensions = await mapWithConcurrency(targets, INVENTORY_CONCURRENCY, async(target) => {
        const entry = await readExtension(target);

        done++;
        progress.value = {
          phase: 'lockfiles', done, total: targets.length, label: target.name
        };

        return entry;
      });

      const built: InventoryDoc = {
        version:    INVENTORY_CACHE_VERSION,
        fetchedAt:  new Date().toISOString(),
        extensions: extensions.sort((a, b) => a.name.localeCompare(b.name)),
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
