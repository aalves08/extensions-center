import { Ref, ref } from 'vue';

import { MANIFEST_PR_CONCURRENCY, MANIFEST_PR_SCAN_LIMIT, OFFICIAL_MANIFEST_PATH, OFFICIAL_MANIFEST_REPO } from '../config/constants';
import { Manifest } from '../types/github';
import { ManifestChange, ManifestPr } from '../types/manifestPr';
import { RancherStore } from '../types/rancher';
import { mapWithConcurrency } from '../utils/async';
import { useGitHubApi } from './useGitHubApi';

/** The slice of a pull request this reads. */
interface GhPull {
  number: number;
  title: string;
  html_url: string;
  draft?: boolean;
  user?: { login?: string };
  base: { sha: string };
  head: { sha: string };
}

/** The slice of a compare response this reads. */
interface GhCompare {
  merge_base_commit: { sha: string };
  files?: { filename: string }[];
}

/**
 * Open pull requests that change the official extensions manifest.
 *
 * The manifest is the list of official extensions and the versions Rancher
 * ships of each, so a PR against it is the one kind of upstream change that
 * invalidates most of what the rest of this dashboard is showing. It is worth
 * knowing about before you read the tables, not after.
 *
 * Nothing is persisted and nothing is polled. This runs on page load and on
 * refresh, and the whole scan is one request plus one per open PR.
 */
export function useManifestPrs(store: RancherStore) {
  const api = useGitHubApi(store);

  const data: Ref<ManifestPr[]> = ref([]);
  const loading = ref(false);

  /**
   * Failures are held rather than surfaced.
   *
   * This is an advisory banner above the real content. A dashboard that
   * replaces its own tables with "could not list pull requests" because an
   * optional extra failed is worse than one that quietly shows nothing.
   */
  const error: Ref<string | null> = ref(null);

  const load = async(): Promise<void> => {
    loading.value = true;
    error.value = null;

    try {
      const pulls = await api.get<GhPull[]>(`/repos/${ OFFICIAL_MANIFEST_REPO }/pulls`, {
        state:     'open',
        sort:      'updated',
        direction: 'desc',
        per_page:  MANIFEST_PR_SCAN_LIMIT,
      });

      const found = await mapWithConcurrency(pulls, MANIFEST_PR_CONCURRENCY, (pull) => describe(pull));

      data.value = found.filter((pr): pr is ManifestPr => !!pr);
    } catch (e) {
      error.value = (e as Error).message;
      data.value = [];
    } finally {
      loading.value = false;
    }
  };

  /** One PR, or null when it does not touch the manifest or cannot be read. */
  const describe = async(pull: GhPull): Promise<ManifestPr | null> => {
    try {
      // Compare rather than `/pulls/{n}/files`, for the merge base it carries.
      // A PR branched a week ago sits behind main, and diffing against the tip
      // of main reports everything merged since as a *removal* — PR #297 read
      // as "removes observability 2.4.2" when all it did was add a kubewarden
      // version. The merge base is what GitHub itself diffs against.
      const compare = await api.get<GhCompare>(
        `/repos/${ OFFICIAL_MANIFEST_REPO }/compare/${ pull.base.sha }...${ pull.head.sha }`
      );

      if (!compare.files?.some((f) => f.filename === OFFICIAL_MANIFEST_PATH)) {
        return null;
      }

      const [before, after] = await Promise.all([
        manifestAt(compare.merge_base_commit.sha),
        // `refs/pull/{n}/head` rather than the fork and its head sha: every one
        // of these PRs comes from a fork, and this resolves through the base
        // repo whether or not that fork still exists.
        manifestAt(`refs/pull/${ pull.number }/head`),
      ]);

      return {
        number:  pull.number,
        title:   pull.title,
        url:     pull.html_url,
        author:  pull.user?.login || '',
        draft:   !!pull.draft,
        changes: diffManifests(before, after),
      };
    } catch {
      // One unreadable PR must not cost the banners for the others.
      return null;
    }
  };

  const manifestAt = async(ref: string): Promise<Manifest['extensions']> => {
    const manifest = await api.getJsonFile<Manifest>(OFFICIAL_MANIFEST_REPO, OFFICIAL_MANIFEST_PATH, ref);

    return manifest?.extensions || {};
  };

  return {
    data, loading, error, load
  };
}

/**
 * What a PR does to the manifest, as a list of additions and removals.
 *
 * Structural rather than a read of the patch. The diff of a JSON file is a run
 * of `+"1.2.3",` lines whose owning extension is only implied by surrounding
 * context, and guessing at that is how you end up attributing a version to the
 * wrong extension.
 */
export function diffManifests(before: Manifest['extensions'], after: Manifest['extensions']): ManifestChange[] {
  const names = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  const changes: ManifestChange[] = [];

  for (const extension of names) {
    const was = before[extension];
    const now = after[extension];

    if (!was && now) {
      changes.push({
        kind: 'added', extension, versions: now.versions || []
      });
      continue;
    }

    if (was && !now) {
      changes.push({
        kind: 'dropped', extension, versions: was.versions || []
      });
      continue;
    }

    const oldVersions = was?.versions || [];
    const newVersions = now?.versions || [];
    const added = newVersions.filter((v) => !oldVersions.includes(v));
    const removed = oldVersions.filter((v) => !newVersions.includes(v));

    if (added.length) {
      changes.push({
        kind: 'newVersion', extension, versions: added
      });
    }

    if (removed.length) {
      changes.push({
        kind: 'removedVersion', extension, versions: removed
      });
    }
  }

  return changes;
}
