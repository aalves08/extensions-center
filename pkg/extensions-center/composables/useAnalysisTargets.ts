import { OFFICIAL_MANIFEST_PATH, OFFICIAL_MANIFEST_REPO } from '../config/constants';
import { AnalysisTarget } from '../types/analysis';
import { GhBranch, GhRelease, GhTag, Manifest } from '../types/github';
import { RancherStore } from '../types/rancher';
import { mapWithConcurrency } from '../utils/async';
import { useGitHubApi } from './useGitHubApi';

/**
 * Deciding *which* version of each official extension both analyses look at.
 *
 * Shared because the two pages have to agree. If imports read kubewarden 4.2.1
 * and bundles read 4.1.0, every comparison between the source an extension asks
 * for and the bundle it ships would be comparing two different extensions.
 */

/**
 * Bare semver out of a release tag.
 *
 * Extension repos tag three different ways: `v1.9.0`, `kubewarden-4.2.1` and
 * `observability@2.4.0`. The name prefix has to go before the `v` does, and the
 * `v` is only stripped when a digit follows it — the Node script this is ported
 * from used a plain `/^v/`, which is why its published report contains
 * `irtual-clusters-1.2.0` and `ulnerability-scanner-0.9.0`.
 */
export function semverFromTag(extName: string, tag: string): string {
  const escaped = extName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  return tag
    .replace(new RegExp(`^${ escaped }[-@]`, 'i'), '')
    .replace(/^v(?=\d)/, '');
}

/** Latest version of every extension in the official manifest. */
export async function resolveTargets(store: RancherStore): Promise<AnalysisTarget[]> {
  const api = useGitHubApi(store);
  const manifest = await api.getJsonFile<Manifest>(OFFICIAL_MANIFEST_REPO, OFFICIAL_MANIFEST_PATH);

  if (!manifest?.extensions) {
    throw new Error(`Could not read ${ OFFICIAL_MANIFEST_PATH } from ${ OFFICIAL_MANIFEST_REPO }.`);
  }

  const entries = Object.entries(manifest.extensions);

  const resolved = await mapWithConcurrency(entries, 3, async([name, entry]): Promise<AnalysisTarget | null> => {
    const repo = entry.repo;

    // Releases first: they are the only source that distinguishes a finished
    // release from a prerelease, which matters because several of these repos
    // tag release candidates continuously.
    const releases = await api.get<GhRelease[]>(`/repos/${ repo }/releases`, { per_page: 50 });
    const stable = releases.find((r) => !r.draft && !r.prerelease);

    if (stable) {
      return {
        name,
        repo,
        tag:    stable.tag_name,
        semver: semverFromTag(name, stable.tag_name),
        ref:    stable.tag_name,
        source: 'release',
      };
    }

    // Some repos tag without ever cutting a GitHub release.
    const tags = await api.get<GhTag[]>(`/repos/${ repo }/tags`, { per_page: 50 });

    if (tags.length) {
      return {
        name,
        repo,
        tag:    tags[0].name,
        semver: semverFromTag(name, tags[0].name),
        ref:    tags[0].commit.sha,
        source: 'tag',
      };
    }

    // Nothing tagged at all — read the branch head and let the UI say so.
    const branch = entry.branch || 'main';

    try {
      const head = await api.get<GhBranch>(`/repos/${ repo }/branches/${ branch }`);

      return {
        name,
        repo,
        tag:    head.name,
        semver: head.name,
        ref:    head.commit.sha,
        source: 'branch',
      };
    } catch {
      // An extension we cannot resolve a ref for is dropped rather than carried
      // as a row that can never have numbers in it.
      return null;
    }
  });

  return resolved
    .filter((t): t is AnalysisTarget => t !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}
