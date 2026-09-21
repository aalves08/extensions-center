import { GITHUB_API } from '../config/constants';
import { RancherStore, errorMessage, storeErrorStatus } from '../types/rancher';
import { useExtensionConfig } from './useExtensionConfig';

/** Thrown for any non-2xx GitHub response, carrying enough context to render a useful message. */
export class GitHubApiError extends Error {
  status: number;
  /** True when GitHub rejected us for rate limiting rather than for the request itself */
  rateLimited: boolean;
  /** Epoch seconds when the rate limit resets, when GitHub told us */
  resetAt: number | null;

  constructor(message: string, status: number, rateLimited = false, resetAt: number | null = null) {
    super(message);
    this.name = 'GitHubApiError';
    this.status = status;
    this.rateLimited = rateLimited;
    this.resetAt = resetAt;
  }
}

/**
 * Paths that cannot be called straight from the browser.
 *
 * GitHub's code search endpoint omits CORS headers on a *successful*
 * authenticated response: a 200 from `/search/code` carries only
 * `vary: accept-encoding`, while `/repos/…` and even `/search/repositories`
 * return `access-control-allow-origin: *`. The browser discards the body before
 * we ever see it — `net::ERR_FAILED 200 (OK)` in the console is exactly that, a
 * request that succeeded and a response that could not be read.
 *
 * Unauthenticated the same URL 401s *with* the header, which is why this only
 * appears once a token is configured and why it looks intermittent.
 *
 * Nothing about the request can fix a missing response header, so this one
 * endpoint goes through Rancher's `/meta/proxy` and is fetched server-side.
 * That endpoint belongs to the Rancher backend rather than to the dev server,
 * so it resolves the same way in a built extension as it does under `yarn dev`
 * — a custom devServer proxy would only have worked in dev.
 */
const PROXIED_PATHS = ['/search/code'];

/**
 * Build the `/meta/proxy` form of an upstream URL.
 *
 * This is the same transform the shell's own `ProxyApiImpl` performs, repeated
 * here rather than imported. `@shell/apis/shell/proxy` cannot currently be
 * imported by an extension: it pulls `ProxyApi`, `ProxyRequestOptions` and the
 * two auth types from `@shell/apis/intf/shell`, which re-exports the modal,
 * slide-in and system interfaces but not the proxy ones, so the module fails to
 * typecheck. Swap this back for `ProxyApiImpl` once that export is fixed.
 */
function proxyUrl(url: URL): string {
  return `/meta/proxy/${ url.toString().replace(/^https:\/\//, '').replace(/^http:\/\//, 'http:/') }`;
}

/**
 * Thin wrapper over the GitHub REST API.
 *
 * Every call is made from the browser with the token held in the extension's
 * Secret. Nothing is cached on disk and nothing is committed to the repo — each
 * page load fetches live data, which is why the token matters: unauthenticated
 * callers get 60 requests/hour and this dashboard burns through that instantly.
 */
export function useGitHubApi(store: RancherStore) {
  const { load: loadConfig } = useExtensionConfig(store);

  const headers = async(): Promise<Record<string, string>> => {
    const cfg = await loadConfig();

    const base: Record<string, string> = {
      Accept:                 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };

    if (cfg.githubToken) {
      base.Authorization = `Bearer ${ cfg.githubToken }`;
    }

    return base;
  };

  /**
   * The same GET, issued by Rancher instead of by the page.
   *
   * The token travels to Rancher in `x-api-auth-header` and Rancher replays it
   * upstream as `Authorization`, so it still never reaches GitHub from the
   * browser. The response comes back from same-origin `/meta/proxy`, so there
   * is no preflight and no allow-origin requirement.
   */
  const getViaProxy = async<T>(url: URL): Promise<T> => {
    const cfg = await loadConfig();

    const proxyHeaders: Record<string, string> = {
      Accept:                 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };

    if (cfg.githubToken) {
      // Rancher strips this and replays it upstream as `Authorization`.
      proxyHeaders['x-api-auth-header'] = `Bearer ${ cfg.githubToken }`;
    }

    try {
      // `management/request` returns the parsed body, not a Response, so there
      // is no `res.ok` to branch on — a non-2xx arrives here as a rejection.
      return await store.dispatch('management/request', {
        url:                  proxyUrl(url),
        method:               'GET',
        headers:              proxyHeaders,
        redirectUnauthorized: false,
      }, { root: true }) as T;
    } catch (e: unknown) {
      // Until api.github.com is allow-listed Rancher refuses the hop itself,
      // and the error it returns mentions nothing about GitHub at all.
      const status = storeErrorStatus(e) ?? 0;
      const detail = errorMessage(e);
      const hint = store.getters['i18n/t']('extensionsCenter.errors.proxyFailed');

      throw new GitHubApiError(`${ detail } ${ hint }`, status);
    }
  };

  /**
   * GET a GitHub REST path (or absolute URL) and parse the JSON body.
   */
  const get = async<T>(pathOrUrl: string, params?: Record<string, string | number>): Promise<T> => {
    const url = new URL(pathOrUrl.startsWith('http') ? pathOrUrl : `${ GITHUB_API }${ pathOrUrl }`);

    Object.entries(params || {}).forEach(([k, v]) => url.searchParams.set(k, String(v)));

    if (PROXIED_PATHS.some((p) => url.pathname.startsWith(p))) {
      return getViaProxy<T>(url);
    }

    const res = await fetch(url.toString(), { headers: await headers() });

    if (!res.ok) {
      const remaining = res.headers.get('x-ratelimit-remaining');
      const reset = res.headers.get('x-ratelimit-reset');
      const rateLimited = (res.status === 403 || res.status === 429) && remaining === '0';

      let detail = res.statusText;

      try {
        const body = await res.json();

        detail = body?.message || detail;
      } catch {
        // Body was not JSON — the status text is the best we have.
      }

      throw new GitHubApiError(detail, res.status, rateLimited, reset ? Number(reset) : null);
    }

    return res.json() as Promise<T>;
  };

  /**
   * GET a raw file from a repo at a given ref, returning null when it is absent.
   *
   * Uses the contents API rather than raw.githubusercontent.com so the request
   * is authenticated and counted against our (much larger) token budget.
   */
  const getFile = async(repo: string, path: string, ref?: string): Promise<string | null> => {
    try {
      const params: Record<string, string> = {};

      if (ref) {
        params.ref = ref;
      }

      const url = new URL(`${ GITHUB_API }/repos/${ repo }/contents/${ path }`);

      Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

      const res = await fetch(url.toString(), {
        headers: {
          ...(await headers()),
          Accept: 'application/vnd.github.raw+json',
        },
      });

      if (res.status === 404) {
        return null;
      }

      if (!res.ok) {
        throw new GitHubApiError(res.statusText, res.status);
      }

      return res.text();
    } catch (e) {
      if (e instanceof GitHubApiError && e.status === 404) {
        return null;
      }

      throw e;
    }
  };

  /** Same as `getFile` but parses JSON, returning null if missing or unparseable. */
  const getJsonFile = async<T>(repo: string, path: string, ref?: string): Promise<T | null> => {
    const raw = await getFile(repo, path, ref);

    if (raw === null) {
      return null;
    }

    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  };

  return {
    get, getFile, getJsonFile
  };
}

/** Turn any thrown error into a message we can put in a Banner. */
export function describeGitHubError(e: unknown): string {
  if (e instanceof GitHubApiError) {
    if (e.rateLimited) {
      const when = e.resetAt ? new Date(e.resetAt * 1000).toLocaleTimeString() : null;

      return when ? `GitHub API rate limit exceeded. Resets at ${ when }. Add a GitHub token on the Settings page.` : 'GitHub API rate limit exceeded. Add a GitHub token on the Settings page.';
    }

    if (e.status === 401) {
      return 'GitHub rejected the configured token. Check it on the Settings page.';
    }

    return `GitHub API error (${ e.status }): ${ e.message }`;
  }

  return e instanceof Error ? e.message : String(e);
}
