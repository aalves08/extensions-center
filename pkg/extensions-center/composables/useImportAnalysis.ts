import { ref, Ref } from 'vue';

import {
  DASHBOARD_BRANCH,
  DASHBOARD_REPO,
  IMPORT_ANALYSIS_CACHE_VERSION,
  IMPORT_ANALYSIS_CONFIGMAP_NAME
} from '../config/constants';
import {
  AggregateImportPath,
  AnalysisProgress,
  AnalysisTarget,
  ExtensionImportDetail,
  ExtensionImportPath,
  ExtensionImportTotals,
  ImportAnalysisDoc
} from '../types/analysis';
import { GhTree } from '../types/github';
import { RancherStore, errorMessage } from '../types/rancher';
import { mapWithConcurrency } from '../utils/async';
import { componentsCandidates, resolveSize, shellCandidates } from '../utils/dashboardModules';
import { classifyImport, normaliseShellPath, packageName } from '../utils/importClassify';
import { parseImports } from '../utils/importParser';
import { useAnalysisCache, isAnalysisStale } from './useAnalysisCache';
import { resolveTargets } from './useAnalysisTargets';
import { useGitHubApi, describeGitHubError } from './useGitHubApi';

/**
 * What every official extension imports, read from its source at the latest
 * released tag.
 *
 * Same two entry points as the known-repos table and for the same reason:
 * `load()` is one ConfigMap read, `rebuild()` downloads roughly 1,150 files from
 * eleven repos. Only an explicit refresh triggers the second.
 */

/** File types worth parsing for imports. */
const SOURCE_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.vue', '.mjs'];

/**
 * Directories whose contents are not shipped code.
 *
 * Tests and Cypress specs import freely from the shell without that saying
 * anything about what the built extension pulls in, and `dist` would double-count
 * whatever a repo happened to commit.
 */
const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'build', '.nuxt', '.output', '__tests__', 'test', 'tests', 'cypress', 'e2e',
]);

/** Raw-CDN fetches in flight. Not rate limited, but a repo still deserves mercy. */
const FILE_CONCURRENCY = 8;

/** Extensions processed at once. Each one is itself fanning out to files. */
const EXT_CONCURRENCY = 2;

function isSourceFile(path: string): boolean {
  if (path.split('/').some((part) => SKIP_DIRS.has(part))) {
    return false;
  }

  return SOURCE_EXTS.some((ext) => path.toLowerCase().endsWith(ext));
}

/**
 * Where an extension's own code lives inside its repo.
 *
 * Extension repos are not laid out consistently — most use `pkg/<name>/`, some
 * underscore the name, a couple use `packages/` or a bare `src/`. Picking the
 * wrong root would either scan the repo's own test harness and tooling or find
 * nothing at all, so this infers it from paths already in the tree rather than
 * probing directories over the network.
 */
function findExtensionRoot(paths: string[], extName: string): string {
  const candidates = [
    `pkg/${ extName }/`,
    `pkg/${ extName.replace(/-/g, '_') }/`,
    `packages/${ extName }/`,
    'src/',
  ];

  for (const prefix of candidates) {
    if (paths.some((p) => p.startsWith(prefix))) {
      return prefix;
    }
  }

  return '';
}

/** Running counts for one extension while its files are being parsed. */
interface ExtAccumulator {
  shell: Map<string, ExtensionImportPath>;
  components: Map<string, ExtensionImportPath>;
  external: Map<string, ExtensionImportPath>;
  internalCount: number;
  fileCount: number;
}

function bump(map: Map<string, ExtensionImportPath>, path: string, specifiers: string[]): void {
  const entry = map.get(path) || {
    path, count: 0, specifiers: []
  };

  entry.count++;
  entry.specifiers = [...new Set([...(entry.specifiers || []), ...specifiers])];
  map.set(path, entry);
}

/** Sorted, size-annotated rows out of one of the accumulator's maps. */
function toRows(
  map: Map<string, ExtensionImportPath>,
  sizeFor: ((path: string) => number | null) | null
): ExtensionImportPath[] {
  return [...map.values()]
    .map((entry) => ({ ...entry, bytes: sizeFor ? sizeFor(entry.path) : undefined }))
    .sort((a, b) => (b.bytes || 0) - (a.bytes || 0) || b.count - a.count);
}

export function useImportAnalysis(store: RancherStore) {
  const api = useGitHubApi(store);
  const cache = useAnalysisCache<ImportAnalysisDoc>(store, {
    name:    IMPORT_ANALYSIS_CONFIGMAP_NAME,
    version: IMPORT_ANALYSIS_CACHE_VERSION,
  });

  const doc: Ref<ImportAnalysisDoc | null> = ref(null);
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

  /** Read one extension's sources and count what they import. */
  const scanExtension = async(target: AnalysisTarget): Promise<{
    totals: ExtensionImportTotals;
    detail: ExtensionImportDetail;
    acc: ExtAccumulator;
  }> => {
    const base: ExtensionImportTotals = {
      name:             target.name,
      repo:             target.repo,
      semver:           target.semver,
      fileCount:        0,
      shell:            0,
      components:       0,
      external:         0,
      internal:         0,
      uniqueShellPaths: 0,
      shellBytes:       0,
      componentsBytes:  0,
    };

    const acc: ExtAccumulator = {
      shell:         new Map(),
      components:    new Map(),
      external:      new Map(),
      internalCount: 0,
      fileCount:     0,
    };

    const empty = {
      totals: base,
      detail: {
        shell: [], components: [], external: []
      },
      acc,
    };

    let tree: GhTree;

    try {
      tree = await api.getTree(target.repo, target.ref);
    } catch (e) {
      return { ...empty, totals: { ...base, error: describeGitHubError(e) } };
    }

    const allPaths = tree.tree.filter((e) => e.type === 'blob').map((e) => e.path);
    const root = findExtensionRoot(allPaths, target.name);
    const files = allPaths.filter((p) => p.startsWith(root) && isSourceFile(p));

    if (!files.length) {
      return {
        ...empty,
        totals: {
          ...base,
          error: store.getters['i18n/t']('extensionsCenter.analysis.errors.noSources'),
        },
      };
    }

    await mapWithConcurrency(files, FILE_CONCURRENCY, async(path) => {
      const content = await api.getRawText(target.repo, target.ref, path).catch(() => null);

      if (!content) {
        return;
      }

      const imports = parseImports(path, content);

      if (!imports.length) {
        return;
      }

      acc.fileCount++;

      for (const imp of imports) {
        const kind = classifyImport(imp.source, target.name);

        if (kind === 'shell') {
          bump(acc.shell, normaliseShellPath(imp.source), imp.specifiers);
        } else if (kind === 'components') {
          bump(acc.components, imp.source, imp.specifiers);
        } else if (kind === 'external') {
          // Grouped by package: thirty `lodash/…` paths are one dependency.
          bump(acc.external, packageName(imp.source), []);
        } else {
          acc.internalCount++;
        }
      }
    });

    const count = (map: Map<string, ExtensionImportPath>) => [...map.values()].reduce((sum, e) => sum + e.count, 0);

    return {
      totals: {
        ...base,
        fileCount:        acc.fileCount,
        shell:            count(acc.shell),
        components:       count(acc.components),
        external:         count(acc.external),
        internal:         acc.internalCount,
        uniqueShellPaths: acc.shell.size,
      },
      detail: {
        shell: [], components: [], external: []
      },
      acc,
    };
  };

  /**
   * Rebuild from GitHub, then persist.
   *
   * Roughly 1,150 file downloads plus one tree call per repo. Never called
   * except from an explicit refresh.
   */
  const rebuild = async(): Promise<void> => {
    rebuilding.value = true;
    error.value = null;
    progress.value = {
      phase: 'targets', done: 0, total: 0
    };

    try {
      const targets = await resolveTargets(store);

      // Every shell and components file in one request, with sizes. Doing this
      // per import path would be a thousand round trips for the same answer.
      progress.value = {
        phase: 'modules', done: 0, total: 1
      };

      const dashboardTree = await api.getTree(DASHBOARD_REPO, DASHBOARD_BRANCH);

      if (dashboardTree.truncated) {
        throw new Error(store.getters['i18n/t']('extensionsCenter.analysis.errors.treeTruncated'));
      }

      const sizes = new Map<string, number>();

      dashboardTree.tree.forEach((entry) => {
        if (entry.type === 'blob' && entry.size !== undefined) {
          sizes.set(entry.path, entry.size);
        }
      });

      const shellSize = (path: string) => resolveSize(shellCandidates(path), sizes);
      const componentsSize = (path: string) => resolveSize(componentsCandidates(path), sizes);

      let done = 0;

      progress.value = {
        phase: 'sources', done: 0, total: targets.length
      };

      const scanned = await mapWithConcurrency(targets, EXT_CONCURRENCY, async(target) => {
        progress.value = {
          phase: 'sources', done, total: targets.length, label: target.name
        };

        const result = await scanExtension(target);

        done++;
        progress.value = {
          phase: 'sources', done, total: targets.length, label: target.name
        };

        return { target, result };
      });

      // Aggregate across extensions, and resolve sizes once per unique path
      // rather than once per extension that imports it.
      const shellAgg = new Map<string, AggregateImportPath>();
      const componentsAgg = new Map<string, AggregateImportPath>();
      const externalAgg = new Map<string, AggregateImportPath>();

      const aggregate = (
        into: Map<string, AggregateImportPath>,
        rows: Map<string, ExtensionImportPath>,
        extName: string,
        sizeFor: ((path: string) => number | null) | null
      ) => {
        rows.forEach((row, path) => {
          const entry = into.get(path) || {
            path, total: 0, exts: [], bytes: sizeFor ? sizeFor(path) : null
          };

          entry.total += row.count;
          entry.exts.push(extName);
          into.set(path, entry);
        });
      };

      const totals: ExtensionImportTotals[] = [];
      const detail: Record<string, ExtensionImportDetail> = {};

      for (const { target, result } of scanned) {
        const shellRows = toRows(result.acc.shell, shellSize);
        const componentsRows = toRows(result.acc.components, componentsSize);

        totals.push({
          ...result.totals,
          shellBytes:      shellRows.reduce((sum, r) => sum + (r.bytes || 0), 0),
          componentsBytes: componentsRows.reduce((sum, r) => sum + (r.bytes || 0), 0),
        });

        detail[target.name] = {
          shell:      shellRows,
          components: componentsRows,
          // External rows carry no specifiers: which named export an extension
          // takes out of `lodash` says nothing about the shell's API surface.
          external:   toRows(result.acc.external, null).map(({ specifiers, ...rest }) => rest),
        };

        aggregate(shellAgg, result.acc.shell, target.name, shellSize);
        aggregate(componentsAgg, result.acc.components, target.name, componentsSize);
        aggregate(externalAgg, result.acc.external, target.name, null);
      }

      const sorted = (map: Map<string, AggregateImportPath>) => [...map.values()].sort((a, b) => b.exts.length - a.exts.length || b.total - a.total);

      const built: ImportAnalysisDoc = {
        version:         IMPORT_ANALYSIS_CACHE_VERSION,
        fetchedAt:       new Date().toISOString(),
        dashboardRef:    `${ DASHBOARD_REPO }@${ DASHBOARD_BRANCH }`,
        totals:          totals.sort((a, b) => b.shellBytes - a.shellBytes),
        shellPaths:      sorted(shellAgg),
        componentsPaths: sorted(componentsAgg),
        externalPkgs:    sorted(externalAgg),
        detail,
      };

      doc.value = built;
      needsBuild.value = false;
      stale.value = false;

      progress.value = {
        phase: 'saving', done: 0, total: 1
      };

      // Awaited rather than fire-and-forget: this write is the only reason the
      // next visit is free, so a failure should surface now.
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
