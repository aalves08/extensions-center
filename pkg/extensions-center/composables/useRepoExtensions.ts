import { ExtensionPackageJson, GhContentEntry } from '../types/github';
import { RancherStore } from '../types/rancher';
import { mapWithConcurrency } from '../utils/async';
import { useGitHubApi } from './useGitHubApi';

/**
 * What a repo actually contains, as opposed to what the manifest says about it.
 *
 * `manifest.json` is a catalogue of *published charts*, so it carries one entry
 * per shipped extension and nothing about the repo those entries come out of.
 * That was indistinguishable from "one repo, one extension" until
 * `neuvector/security-ui-exts` turned up with four `pkg/` directories, two of
 * them installable extensions, one of them in the catalogue and one not.
 *
 * Every official repo keeps its extensions in `pkg/<name>/`, so reading that
 * directory is enough to tell the difference. Each unknown directory's
 * `package.json` then says what it is:
 *
 *   - `rancher` annotations and not private  → an installable extension
 *   - `"private": true`                      → shared code the siblings bundle
 *   - neither                                → not our business
 *
 * `pkg/common` in that repo is explicit about it: *"Shared components/types
 * used across security-ui-exts extensions. Not an installable extension
 * itself."* Its files still end up inside both built bundles, via a `@common`
 * webpack alias, which is why `sharedRoots` exists rather than being dropped.
 */

/** Conventional home of an extension's source inside its repo. */
const PKG_ROOT = 'pkg';

/** Unknown `pkg/` directories probed at once. There are never many. */
const PROBE_CONCURRENCY = 4;

export interface RepoExtension {
  /** Chart name: the `pkg/` directory, which is also the gh-pages directory */
  name: string;
  /** `owner/name` */
  repo: string;
  /** Repo-relative source root with a trailing slash, `''` when not found */
  root: string;
  /** True when rancher/ui-plugin-charts `manifest.json` carries this extension */
  inManifest: boolean;
}

export interface RepoLayout {
  repo: string;
  /** Every installable extension in the repo, manifest or not, by name */
  extensions: RepoExtension[];
  /**
   * Private `pkg/` directories every extension in the repo bundles.
   *
   * Counted into each sibling's source rather than attributed once: the
   * webpack alias copies them into every bundle, so each extension really does
   * ship its own copy and really does inherit its shell imports.
   */
  sharedRoots: string[];
}

/**
 * One layout per repo per page session.
 *
 * Both analyses and the Security page's tab strip want the same answer, and the
 * promise is cached rather than the value so three concurrent callers issue one
 * set of requests between them.
 */
const cache = new Map<string, Promise<RepoLayout>>();

/** Dropped at the start of a rebuild, so an explicit refresh re-reads the repo. */
export function clearRepoLayoutCache(): void {
  cache.clear();
}

function byName(a: RepoExtension, b: RepoExtension): number {
  return a.name.localeCompare(b.name);
}

/** What the manifest alone can tell us, used whenever the repo cannot be read. */
function fromManifestOnly(repo: string, manifestNames: string[]): RepoLayout {
  return {
    repo,
    extensions: manifestNames.map((name) => ({
      name, repo, root: `${ PKG_ROOT }/${ name }/`, inManifest: true
    })).sort(byName),
    sharedRoots: [],
  };
}

async function discover(
  api: ReturnType<typeof useGitHubApi>,
  repo: string,
  manifestNames: string[]
): Promise<RepoLayout> {
  const fallback = fromManifestOnly(repo, manifestNames);
  let listing: GhContentEntry[];

  try {
    listing = await api.get<GhContentEntry[]>(`/repos/${ repo }/contents/${ PKG_ROOT }`);
  } catch {
    // No `pkg/` directory, or a repo we cannot read. Either way the manifest
    // entry is still a real extension, and the import scan falls back to
    // inferring a root from the file tree it is about to download anyway.
    return fallback;
  }

  if (!Array.isArray(listing)) {
    return fallback;
  }

  const dirs = listing.filter((e) => e.type === 'dir').map((e) => e.name);

  if (!dirs.length) {
    return fallback;
  }

  const known = new Set(manifestNames);
  const extensions: RepoExtension[] = [];
  const sharedRoots: string[] = [];

  await mapWithConcurrency(dirs, PROBE_CONCURRENCY, async(dir) => {
    const root = `${ PKG_ROOT }/${ dir }/`;

    // A manifest key needs no interrogation: the catalogue already ships it.
    if (known.has(dir)) {
      extensions.push({
        name: dir, repo, root, inManifest: true
      });

      return;
    }

    let pkg: ExtensionPackageJson | null = null;

    try {
      pkg = await api.getJsonFile<ExtensionPackageJson>(repo, `${ root }package.json`);
    } catch {
      // A directory with no readable `package.json` is not something we can
      // classify, and guessing from the name is how `common` would have ended
      // up on the page as an extension.
      return;
    }

    if (!pkg) {
      return;
    }

    if (pkg.private === true) {
      sharedRoots.push(root);

      return;
    }

    if (pkg.rancher) {
      // The directory name, not `pkg.name`. They agree today, but it is the
      // directory that `build-pkg` turns into the chart and therefore into the
      // gh-pages path every other lookup here is built from.
      extensions.push({
        name: dir, repo, root, inManifest: false
      });
    }
  });

  // A manifest entry whose directory is named something else — or missing —
  // still has to produce a row. Losing it here would quietly shrink the
  // catalogue every page this feeds.
  for (const name of manifestNames) {
    if (!extensions.some((e) => e.name === name)) {
      extensions.push({
        name, repo, root: '', inManifest: true
      });
    }
  }

  return {
    repo, extensions: extensions.sort(byName), sharedRoots: sharedRoots.sort()
  };
}

/** The layout of one repo, read once and shared. */
export function repoLayout(store: RancherStore, repo: string, manifestNames: string[]): Promise<RepoLayout> {
  const hit = cache.get(repo);

  if (hit) {
    return hit;
  }

  const pending = discover(useGitHubApi(store), repo, manifestNames)
    .catch(() => fromManifestOnly(repo, manifestNames));

  cache.set(repo, pending);

  return pending;
}
