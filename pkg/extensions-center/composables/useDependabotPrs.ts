import { DEPENDABOT_PR_CONCURRENCY, DEPENDABOT_PR_SCAN_LIMIT } from '../config/constants';
import { RancherStore } from '../types/rancher';
import { PrFix } from '../types/security';
import { mapWithConcurrency } from '../utils/async';
import { parseUpdatedDependencies } from '../utils/dependabotPr';
import { useGitHubApi } from './useGitHubApi';

/** The slice of a pull request this reads. */
interface GhPull {
  number: number;
  title: string;
  html_url: string;
  draft?: boolean;
  user?: { login?: string };
}

/** The slice of a commit this reads. */
interface GhCommit {
  commit?: { message?: string };
}

/** The account every one of these PRs is opened by. */
const DEPENDABOT = 'dependabot[bot]';

/**
 * Per-repo results, held for as long as the page is open.
 *
 * Module-level for the same reason `useSecurityAlerts` caches its raw alerts:
 * two of the Security page's targets are slices of `rancher/dashboard`, and
 * they would otherwise each pay for the same PR scan.
 */
const cache = new Map<string, PrFix[]>();

/** In-flight scans, so those two targets issue one set of requests, not two. */
const inFlight = new Map<string, Promise<PrFix[]>>();

/**
 * The open Dependabot PRs for a repo, as package/version pairs.
 *
 * This is what turns "18 findings" into "five of them are already written and
 * waiting for a reviewer" — the single largest difference between what the
 * Security page used to say about `rancher/dashboard` and what is actually
 * true of it.
 *
 * Read from commit trailers rather than from anything on the PR itself; the
 * header of `utils/dependabotPr.ts` has the three alternatives that were tried
 * and why each is unusable.
 */
export function useDependabotPrs(store: RancherStore) {
  const api = useGitHubApi(store);

  const describe = async(repo: string, pull: GhPull): Promise<PrFix[]> => {
    // One commit per package, so a multi-package PR has to be read commit by
    // commit: #18965 carries three, and its title names none of them.
    const commits = await api.get<GhCommit[]>(`/repos/${ repo }/pulls/${ pull.number }/commits`, { per_page: 100 });

    return commits
      .flatMap((commit) => parseUpdatedDependencies(commit.commit?.message || ''))
      .map((dependency) => ({
        ...dependency,
        number: pull.number,
        title:  pull.title,
        url:    pull.html_url,
        draft:  !!pull.draft,
      }));
  };

  const scan = async(repo: string): Promise<PrFix[]> => {
    const pulls = await api.get<GhPull[]>(`/repos/${ repo }/pulls`, {
      state:     'open',
      sort:      'updated',
      direction: 'desc',
      per_page:  DEPENDABOT_PR_SCAN_LIMIT,
    });

    const mine = pulls.filter((pull) => pull.user?.login === DEPENDABOT);
    const found = await mapWithConcurrency(mine, DEPENDABOT_PR_CONCURRENCY, async(pull) => {
      try {
        return await describe(repo, pull);
      } catch {
        // One unreadable PR costs its own rows, not the whole scan.
        return [];
      }
    });

    return found.flat();
  };

  /**
   * Every version bump currently open against a repo.
   *
   * Throws when the PR list itself cannot be read — a repo with PRs disabled,
   * or a token without the scope. The caller decides what to do about that;
   * `useRepoSecurity` records it as `prError` and lets the findings stand,
   * which overstates the remaining work rather than hiding any of it.
   */
  const load = async(repo: string): Promise<PrFix[]> => {
    const hit = cache.get(repo);

    if (hit) {
      return hit;
    }

    const pending = inFlight.get(repo);

    if (pending) {
      return pending;
    }

    const promise = scan(repo)
      .then((fixes) => {
        cache.set(repo, fixes);

        return fixes;
      })
      .finally(() => inFlight.delete(repo));

    inFlight.set(repo, promise);

    return promise;
  };

  /** Drops the held results, so an explicit refresh re-reads the PRs. */
  const invalidate = (): void => {
    cache.clear();
  };

  return { load, invalidate };
}
