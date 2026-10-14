import { OFFICIAL_MANIFEST_PATH, OFFICIAL_MANIFEST_REPO } from '../config/constants';
import { AnalysisTarget } from '../types/analysis';
import {
  GhBranch, GhRelease, GhRepo, GhTag, Manifest
} from '../types/github';
import { RancherStore } from '../types/rancher';
import { mapWithConcurrency } from '../utils/async';
import { semverFromTag, tagBelongsTo } from '../utils/extensionTags';
import { useGitHubApi } from './useGitHubApi';
import { RepoExtension, RepoLayout, repoLayout } from './useRepoExtensions';

/**
 * Deciding *which* version of each official extension both analyses look at.
 *
 * Shared because the two pages have to agree. If imports read kubewarden 4.2.1
 * and bundles read 4.1.0, every comparison between the source an extension asks
 * for and the bundle it ships would be comparing two different extensions.
 *
 * The unit here is the extension, not the repo. Those were the same thing until
 * `neuvector/security-ui-exts` arrived with four `pkg/` directories publishing
 * on one interleaved release stream — see `utils/extensionTags.ts` for what
 * that broke and `useRepoExtensions.ts` for how the repo is read.
 */

export { semverFromTag };

/** Repos read at once. Each costs a directory listing plus releases and tags. */
const REPO_CONCURRENCY = 3;

/** Enough releases and tags to find one belonging to each extension in a repo. */
const PER_PAGE = 50;

/** The repo's own `pkg/` dirs minus this one: what makes a bare tag ambiguous. */
function siblingCount(layout: RepoLayout): number {
  return Math.max(layout.extensions.length - 1, 0);
}

/**
 * Where this extension's shipped source lives.
 *
 * Shared roots are appended rather than attributed to the repo, because the
 * webpack alias that pulls `pkg/common` into a build copies it into each
 * sibling's bundle — so every sibling genuinely ships those files and inherits
 * the shell imports inside them.
 */
function sourceRoots(ext: RepoExtension, layout: RepoLayout): string[] {
  return [ext.root, ...layout.sharedRoots].filter((r) => !!r);
}

/** Latest version of every extension found in the official repos. */
export async function resolveTargets(store: RancherStore): Promise<AnalysisTarget[]> {
  const api = useGitHubApi(store);
  const manifest = await api.getJsonFile<Manifest>(OFFICIAL_MANIFEST_REPO, OFFICIAL_MANIFEST_PATH);

  if (!manifest?.extensions) {
    throw new Error(`Could not read ${ OFFICIAL_MANIFEST_PATH } from ${ OFFICIAL_MANIFEST_REPO }.`);
  }

  // Grouped by repo before anything is fetched: releases and tags are one list
  // per repo however many extensions come out of it, so asking per extension
  // would issue the same two calls twice and still have to tell the results
  // apart afterwards.
  const byRepo = new Map<string, string[]>();

  for (const [name, entry] of Object.entries(manifest.extensions)) {
    if (!entry?.repo) {
      continue;
    }

    const names = byRepo.get(entry.repo) || [];

    names.push(name);
    byRepo.set(entry.repo, names);
  }

  const perRepo = await mapWithConcurrency([...byRepo.entries()], REPO_CONCURRENCY, async([repo, manifestNames]) => {
    const [layout, releases, tags] = await Promise.all([
      repoLayout(store, repo, manifestNames),
      // Releases are the only source that distinguishes a finished release from
      // a prerelease, which matters because several of these repos tag release
      // candidates continuously. Deliberately not caught: a failure here is a
      // rate limit or a bad token, and reporting that is worth more than a
      // table quietly built from branch heads.
      api.get<GhRelease[]>(`/repos/${ repo }/releases`, { per_page: PER_PAGE }),
      api.get<GhTag[]>(`/repos/${ repo }/tags`, { per_page: PER_PAGE }),
    ]);

    const siblings = siblingCount(layout);
    const stable = releases.filter((r) => !r.draft && !r.prerelease);

    /**
     * The default branch's head, read at most once per repo and only if
     * something needs it.
     *
     * Deliberately not the manifest's `branch`: that names where the team
     * *publishes* (`gh-pages` for all twelve), and reading built output as if
     * it were source would produce a target with no `pkg/` in it at all.
     */
    let head: Promise<GhBranch | null> | null = null;
    const branchHead = () => {
      head = head || api.get<GhRepo>(`/repos/${ repo }`)
        .then((r) => api.get<GhBranch>(`/repos/${ repo }/branches/${ r.default_branch }`))
        .catch(() => null);

      return head;
    };

    return Promise.all(layout.extensions.map(async(ext): Promise<AnalysisTarget | null> => {
      const mine = (tag: string) => tagBelongsTo(ext.name, tag, siblings);

      const common = {
        name:        ext.name,
        repo,
        inManifest:  ext.inManifest,
        sourceRoots: sourceRoots(ext, layout),
      };

      // A release naming this extension, then — only where no sibling could
      // have produced it — the newest release in the repo. That second step is
      // what every single-extension row has always used, kept so a repo with
      // an unusual tag scheme does not regress into reading its branch head.
      const release = stable.find((r) => mine(r.tag_name)) ||
        (siblings === 0 ? stable[0] : undefined);

      if (release) {
        return {
          ...common,
          tag:    release.tag_name,
          semver: semverFromTag(ext.name, release.tag_name),
          ref:    release.tag_name,
          source: 'release',
        };
      }

      // Some repos tag without ever cutting a GitHub release.
      const tag = tags.find((t) => mine(t.name)) || (siblings === 0 ? tags[0] : undefined);

      if (tag) {
        return {
          ...common,
          tag:    tag.name,
          semver: semverFromTag(ext.name, tag.name),
          ref:    tag.commit.sha,
          source: 'tag',
        };
      }

      // Nothing tagged this extension at all — read the branch head and let the
      // UI say so.
      const branch = await branchHead();

      if (!branch) {
        // An extension we cannot resolve a ref for is dropped rather than
        // carried as a row that can never have numbers in it.
        return null;
      }

      return {
        ...common,
        tag:    branch.name,
        semver: branch.name,
        ref:    branch.commit.sha,
        source: 'branch',
      };
    }));
  });

  return perRepo
    .flat()
    .filter((t): t is AnalysisTarget => t !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}
