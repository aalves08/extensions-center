import { ref, Ref } from 'vue';

import { GhRepo, PackageJson } from '../types/github';
import { RancherStore } from '../types/rancher';
import { OfficialRepo } from '../types/repos';
import { parseHelmIndexVersions } from '../utils/helmIndex';
import { dependencyVersion, latestStableVersion } from '../utils/version';
import { useGitHubApi, describeGitHubError } from './useGitHubApi';

/** Shape of rancher/ui-plugin-charts `manifest.json` */
interface Manifest {
  extensions: Record<string, { repo: string; branch: string; versions: string[] }>;
}

const MANIFEST_REPO = 'rancher/ui-plugin-charts';
const MANIFEST_PATH = 'manifest.json';

/** The Helm index Rancher actually serves, as opposed to the build input. */
const OFFICIAL_INDEX_PATH = 'index.yaml';

/** Where an extension team publishes, and where its own index lives. */
const DEFAULT_PUBLISH_BRANCH = 'gh-pages';

type ChartVersions = Record<string, string[]>;

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

  const enrich = async(
    name: string,
    entry: Manifest['extensions'][string],
    officialVersions: ChartVersions
  ): Promise<OfficialRepo> => {
    const base: OfficialRepo = {
      id:                    entry.repo,
      name,
      repoUrl:               `https://github.com/${ entry.repo }`,
      headBranch:            '',
      shellVersion:          null,
      componentsVersion:     null,
      publishedVersion:      null,
      latestOfficialVersion: latestStableVersion(officialVersions[name] || []),
      outOfSync:             false,
    };

    // The extension's own index is keyed by chart name, same as the manifest
    // key — and a repo can publish more than one chart, so taking the highest
    // version in the file rather than the one under `name` would be wrong.
    const published = await helmIndex(entry.repo, entry.branch || DEFAULT_PUBLISH_BRANCH);

    base.publishedVersion = latestStableVersion(
      published[name]?.length ? published[name] : (entry.versions || [])
    );

    base.outOfSync = !!base.publishedVersion &&
      !!base.latestOfficialVersion &&
      base.publishedVersion !== base.latestOfficialVersion;

    try {
      const repo = await api.get<GhRepo>(`/repos/${ entry.repo }`);

      base.headBranch = repo.default_branch;

      const pkg = await api.getJsonFile<PackageJson>(entry.repo, 'package.json', repo.default_branch);

      base.shellVersion = dependencyVersion(pkg, '@rancher/shell');
      base.componentsVersion = dependencyVersion(pkg, '@rancher/components');
    } catch (e) {
      // One unreachable repo (renamed, archived, private) should not blank the
      // whole table — the row renders with what we know and says why.
      base.error = describeGitHubError(e);
    }

    return base;
  };

  const refresh = async(): Promise<void> => {
    loading.value = true;
    error.value = null;

    try {
      const [manifest, officialVersions] = await Promise.all([
        api.getJsonFile<Manifest>(MANIFEST_REPO, MANIFEST_PATH),
        helmIndex(MANIFEST_REPO),
      ]);

      if (!manifest?.extensions) {
        throw new Error(`Could not read ${ MANIFEST_PATH } from ${ MANIFEST_REPO }.`);
      }

      const entries = Object.entries(manifest.extensions);
      const rows = await Promise.all(entries.map(([name, entry]) => enrich(name, entry, officialVersions)));

      data.value = rows.sort((a, b) => a.name.localeCompare(b.name));
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
