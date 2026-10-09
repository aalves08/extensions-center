import { SECURITY_BUCKET_DAYS } from '../config/constants';
import { Advisory, RepoSecurity, SecurityTarget, TargetScope } from '../types/security';
import { RancherStore } from '../types/rancher';
import { countGroups, groupByPackage, normaliseSeverity } from '../utils/severity';
import { buildHistory } from '../utils/securityHistory';
import { useGitHubApi } from './useGitHubApi';

/** The slice of a Dependabot alert this page reads. */
interface DependabotAlert {
  number: number;
  state: string;
  html_url: string;
  created_at: string;
  fixed_at: string | null;
  dismissed_at: string | null;
  auto_dismissed_at: string | null;
  dependency?: {
    package?: { ecosystem?: string; name?: string };
    manifest_path?: string;
    scope?: string | null;
    relationship?: string | null;
  };
  security_advisory?: {
    ghsa_id?: string;
    cve_id?: string | null;
    summary?: string;
    severity?: string;
  };
  security_vulnerability?: {
    vulnerable_version_range?: string;
    first_patched_version?: { identifier?: string } | null;
  };
}

/** Thrown when the token cannot see this repo's alerts, so the caller can fall back. */
export class AlertsUnavailableError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'AlertsUnavailableError';
    this.status = status;
  }
}

/**
 * One repo's Dependabot alerts, as rows and as a history.
 *
 * Pulled in **every** state, not just `open`. Each closed alert carries
 * `created_at` and a close date, so an alert was open on date D if it was
 * created on or before D and not yet closed — which reconstructs the repo's
 * entire history from a single pull. The table and the chart come out of the
 * same fetch, with no cron job and no stored snapshots.
 */
export function useSecurityAlerts(store: RancherStore) {
  const api = useGitHubApi(store);

  /**
   * One in-flight or settled pull per repo, for the lifetime of the page.
   *
   * Two targets — `@rancher/shell` and `@rancher/components` — are slices of
   * the same `rancher/dashboard` alert list, and the slicing is local. Without
   * this, opening both tabs pulls the identical paginated list twice, and the
   * estate view pulls it twice again.
   */
  const rawByRepo = new Map<string, Promise<DependabotAlert[]>>();

  const fetchRaw = (repo: string): Promise<DependabotAlert[]> => {
    const hit = rawByRepo.get(repo);

    if (hit) {
      return hit;
    }

    const pending = api.getPaged<DependabotAlert>(`/repos/${ repo }/dependabot/alerts`, { per_page: 100 })
      .catch((e: unknown) => {
        // A failure must not be remembered as a result, or the public fallback
        // becomes permanent for the rest of the session.
        rawByRepo.delete(repo);

        const status = (e as { status?: number })?.status ?? 0;

        // 403 is "your token cannot see security alerts here" or "Dependabot is
        // switched off for this repo"; 404 is the same thing worn as a disguise,
        // because GitHub hides the endpoint rather than admitting it exists.
        // Either way the answer is the public fallback, not an error.
        if (status === 403 || status === 404) {
          throw new AlertsUnavailableError((e as Error).message, status);
        }

        throw e;
      });

    rawByRepo.set(repo, pending);

    return pending;
  };

  /** Drop one repo's cached pull, or all of them, so the next read re-fetches. */
  const invalidate = (repo?: string) => {
    if (repo) {
      rawByRepo.delete(repo);
    } else {
      rawByRepo.clear();
    }
  };

  /**
   * @param target  the tab being filled
   * @param declared when `target.scope.shared` is set, the package names its
   *                 `declaredBy` file declares. Resolved by the caller, which
   *                 owns the GitHub reads, and non-optional in that case:
   *                 narrowing by a set we failed to fetch would silently
   *                 report the entire monorepo as this package's problem.
   */
  const load = async(target: SecurityTarget, declared?: Set<string>): Promise<RepoSecurity> => {
    const raw = await fetchRaw(target.repo);
    const scoped = raw.filter((alert) => inScope(alert, target.scope, declared));

    const advisories = scoped.map(toAdvisory(target.repo));
    const groups = groupByPackage(advisories);
    const totals = countGroups(groups);

    return {
      id:         target.id,
      repo:       target.repo,
      label:      target.label,
      source:     'dependabot',
      groups,
      ...totals,
      history:    buildHistory(advisories, SECURITY_BUCKET_DAYS),
      unresolved: 0,
      fetchedAt:  new Date().toISOString(),
    };
  };

  return { load, invalidate };
}

/** Whether one alert belongs to a narrowed target. See `TargetScope`. */
function inScope(alert: DependabotAlert, scope?: TargetScope, declared?: Set<string>): boolean {
  if (!scope) {
    return true;
  }

  const manifest = alert.dependency?.manifest_path || '';

  if (scope.ownManifests.includes(manifest)) {
    return true;
  }

  // The two manifest lists are disjoint, so an alert reaching here was not
  // already counted above and cannot be double-counted now.
  return !!scope.shared &&
    scope.shared.manifests.includes(manifest) &&
    !!declared?.has(alert.dependency?.package?.name || '');
}

function toAdvisory(repo: string) {
  return (alert: DependabotAlert): Advisory => {
    const state = alert.state as Advisory['state'];

    return {
      id:              String(alert.number),
      packageName:     alert.dependency?.package?.name || 'unknown',
      ecosystem:       alert.dependency?.package?.ecosystem || 'unknown',
      ghsa:            alert.security_advisory?.ghsa_id || '',
      cve:             alert.security_advisory?.cve_id || null,
      summary:         alert.security_advisory?.summary || '',
      severity:        normaliseSeverity(alert.security_advisory?.severity),
      manifest:        alert.dependency?.manifest_path || null,
      vulnerableRange: alert.security_vulnerability?.vulnerable_version_range || null,
      patchedVersion:  alert.security_vulnerability?.first_patched_version?.identifier || null,
      scope:           alert.dependency?.scope === 'development' || alert.dependency?.scope === 'runtime' ? alert.dependency.scope : null,
      relationship:    alert.dependency?.relationship === 'direct' || alert.dependency?.relationship === 'transitive' ? alert.dependency.relationship : null,
      state,
      createdAt:       alert.created_at || null,
      // Whichever of the three closed it. A dismissed alert is closed for the
      // history's purposes even though nothing was fixed: it stopped being
      // work, and the chart measures outstanding work.
      closedAt:        alert.fixed_at || alert.dismissed_at || alert.auto_dismissed_at || null,
      url:             alert.html_url || `https://github.com/${ repo }/security/dependabot/${ alert.number }`,
    };
  };
}
