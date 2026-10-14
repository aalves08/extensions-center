import { ref, Ref } from 'vue';

import {
  OFFICIAL_MANIFEST_PATH as MANIFEST_PATH,
  OFFICIAL_MANIFEST_REPO as MANIFEST_REPO
} from '../config/constants';
import { GhRepo, Manifest, PackageJson } from '../types/github';
import { RancherStore } from '../types/rancher';
import { OfficialRepo } from '../types/repos';
import { parseHelmIndexVersions } from '../utils/helmIndex';
import { dependencyVersion, latestStableVersion } from '../utils/version';
import { useGitHubApi, describeGitHubError } from './useGitHubApi';
import { clearRepoLayoutCache, repoLayout } from './useRepoExtensions';

/** The Helm index Rancher actually serves, as opposed to the build input. */
const OFFICIAL_INDEX_PATH = 'index.yaml';

/** Where an extension team publishes, and where its own index lives. */
const DEFAULT_PUBLISH_BRANCH = 'gh-pages';

type ChartVersions = Record<string, string[]>;

/** The manifest entries belonging to one repo, keyed by chart name. */
type ManifestEntries = Map<string, Manifest['extensions'][string]>;

/**
 * The official extension repos, taken live from the ui-plugin-charts manifest.
 *
 * Four sources feed one row, because no single one of them has the lot:
 *
 * - `manifest.json` gives the repo and the branch it publishes from.
 * - the repo's default branch and root `package.json` give the `@rancher/*`
 *   versions it builds against — two calls per repo.
 * - the repo's own `gh-pages` index gives what that team has actually shipped.
 * - ui-plugin-charts' `index.yaml` gives what the official catalogue carries.
 *
 * The last two are the interesting pair. `manifest.json` also lists versions,
 * but it is the build input rather than a reading of upstream, so it agrees
 * with `index.yaml` by construction and can never show a release sitting
 * unpackaged. Reading each team's `gh-pages` costs one extra call per repo and
 * is the only way that gap becomes visible.
 *
 * A fifth source, the repo's `pkg/` listing, decides how many rows come out of
 * it: `neuvector/security-ui-exts` holds four extensions, and the manifest
 * names one of them.
 */
export function useOfficialRepos(store: RancherStore) {
  const api = useGitHubApi(store);

  const data: Ref<OfficialRepo[]> = ref([]);
  const loading = ref(false);
  const error: Ref<string | null> = ref(null);
  const lastRefreshed: Ref<Date | null> = ref(null);

  /** Chart name to published versions, from any repo's Helm index. */
  const helmIndex = async(repo: string, ref?: string): Promise<ChartVersions> => {
    try {
      const raw = await api.getFile(repo, OFFICIAL_INDEX_PATH, ref);

      return raw ? parseHelmIndexVersions(raw) : {};
    } catch {
      // A repo with no published index is not an error worth a banner — the
      // row falls back to the manifest's version list below.
      return {};
    }
  };

  /**
   * Every extension in one repo, as rows.
   *
   * Grouped rather than done per manifest entry because the three repo-level
   * lookups — the Helm index, the repo itself, its root `package.json` — give
   * the same answer for every extension inside it. Only the version columns
   * differ, and those are keyed by chart name.
   */
  const enrichRepo = async(
    repo: string,
    entries: ManifestEntries,
    officialVersions: ChartVersions
  ): Promise<OfficialRepo[]> => {
    const manifestNames = [...entries.keys()];
    const publishBranch = entries.values().next().value?.branch || DEFAULT_PUBLISH_BRANCH;

    const [layout, published] = await Promise.all([
      repoLayout(store, repo, manifestNames),
      // The extension's own index is keyed by chart name, same as the manifest
      // key — and a repo can publish more than one chart, so taking the highest
      // version in the file rather than the one under `name` would be wrong.
      helmIndex(repo, publishBranch),
    ]);

    let headBranch = '';
    let shellVersion: string | null = null;
    let componentsVersion: string | null = null;
    let repoError: string | undefined;

    try {
      const meta = await api.get<GhRepo>(`/repos/${ repo }`);

      headBranch = meta.default_branch;

      const pkg = await api.getJsonFile<PackageJson>(repo, 'package.json', meta.default_branch);

      shellVersion = dependencyVersion(pkg, '@rancher/shell');
      componentsVersion = dependencyVersion(pkg, '@rancher/components');
    } catch (e) {
      // One unreachable repo (renamed, archived, private) should not blank the
      // whole table — its rows render with what we know and say why.
      repoError = describeGitHubError(e);
    }

    return layout.extensions.map((ext) => {
      const entry = entries.get(ext.name);

      const row: OfficialRepo = {
        id:               `${ repo }/${ ext.name }`,
        name:             ext.name,
        repo,
        repoUrl:          `https://github.com/${ repo }`,
        headBranch,
        shellVersion,
        componentsVersion,
        publishedVersion: latestStableVersion(
          published[ext.name]?.length ? published[ext.name] : (entry?.versions || [])
        ),
        latestOfficialVersion: latestStableVersion(officialVersions[ext.name] || []),
        outOfSync:             false,
        inManifest:            ext.inManifest,
        error:                 repoError,
      };

      // Both versions have to be known, which is also what keeps a discovered
      // sibling from being flagged: the catalogue has never heard of it, so
      // there is nothing for its published version to be out of step with.
      row.outOfSync = !!row.publishedVersion &&
        !!row.latestOfficialVersion &&
        row.publishedVersion !== row.latestOfficialVersion;

      return row;
    });
  };

  const refresh = async(): Promise<void> => {
    loading.value = true;
    error.value = null;

    try {
      // Re-read each repo's `pkg/` layout: a refresh should pick up a sibling
      // added since the page was opened.
      clearRepoLayoutCache();

      const [manifest, officialVersions] = await Promise.all([
        api.getJsonFile<Manifest>(MANIFEST_REPO, MANIFEST_PATH),
        helmIndex(MANIFEST_REPO),
      ]);

      if (!manifest?.extensions) {
        throw new Error(`Could not read ${ MANIFEST_PATH } from ${ MANIFEST_REPO }.`);
      }

      const byRepo = new Map<string, ManifestEntries>();

      for (const [name, entry] of Object.entries(manifest.extensions)) {
        if (!entry?.repo) {
          continue;
        }

        const group = byRepo.get(entry.repo) || new Map();

        group.set(name, entry);
        byRepo.set(entry.repo, group);
      }

      const perRepo = await Promise.all(
        [...byRepo.entries()].map(([repo, entries]) => enrichRepo(repo, entries, officialVersions))
      );

      data.value = perRepo.flat().sort((a, b) => a.name.localeCompare(b.name));
      lastRefreshed.value = new Date();
    } catch (e) {
      error.value = describeGitHubError(e);
      data.value = [];
    } finally {
      loading.value = false;
    }
  };

  return {
    data, loading, error, lastRefreshed, refresh
  };
}

/** Repo ids (`owner/name`) of every official extension, used to flag known repos. */
export async function fetchOfficialRepoIds(store: RancherStore): Promise<Set<string>> {
  const api = useGitHubApi(store);
  const manifest = await api.getJsonFile<Manifest>(MANIFEST_REPO, MANIFEST_PATH);

  return new Set(Object.values(manifest?.extensions || {}).map((e) => e.repo.toLowerCase()));
}
