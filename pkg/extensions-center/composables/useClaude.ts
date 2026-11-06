import {
  ANTHROPIC_API_URL,
  ANTHROPIC_VERSION,
  CLAUDE_AWS_API_URL,
  DEFAULT_MODELS,
  DEFAULT_VERTEX_REGION,
  VERTEX_ANTHROPIC_VERSION,
  vertexApiUrl,
  vertexHost,
  vertexModelId
} from '../config/constants';
import { ExtensionConfig, LlmProvider } from '../types/common';
import { RancherStore, errorMessage, storeErrorStatus } from '../types/rancher';
import { ensureProxyTargets, vertexProxyTarget } from './useLlmProxy';
import { vertexAccessToken } from './useVertexAuth';

/**
 * One Messages API call, against whichever provider is configured.
 *
 * The three speak the same Messages format but disagree on where the model id
 * and the version go, on how the call is authenticated, and on whether a
 * browser may make it at all:
 *
 * | | model id | version | auth | callable from the page? |
 * |-|-|-|-|-|
 * | Anthropic     | body | `anthropic-version` header | `x-api-key` | yes |
 * | Claude on AWS | body | `anthropic-version` header | `x-api-key` + workspace id | yes |
 * | Vertex        | URL  | `anthropic_version` body field | OAuth2 bearer | **no** |
 *
 * The last column is the awkward one. Anthropic and Claude on AWS both answer
 * a preflight for a browser origin and are fetched directly. Vertex does not:
 * `rawPredict` requires `Authorization` and `application/json`, which makes
 * the request non-simple, and the preflight comes back 403 with no CORS
 * headers on the regional and global hosts alike. So that one call is issued
 * by Rancher instead, through the same `/meta/proxy` the GitHub code search
 * already uses. Minting the token is unaffected and still happens in the page
 * — see `useVertexAuth`.
 */

export interface ClaudeRequest {
  system: string;
  userContent: string;
  maxTokens: number;
  /** Overrides the configured model for this one call. Used by Test connection. */
  model?: string;
  /**
   * Turn extended thinking off for this call.
   *
   * Current models think adaptively unless told not to, and the thinking
   * counts against `max_tokens` — a small budget gets spent entirely on it and
   * the reply comes back `stop_reason: max_tokens` with an empty thinking
   * block and no text at all. Worth setting whenever the budget is tight and
   * the answer is one word.
   */
  disableThinking?: boolean;
}

/** The part of a Messages API response we read. Identical across providers. */
interface MessagesResponse {
  content?: { type: string; text?: string }[];
}

export interface PreparedRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
  /**
   * Whether this has to be issued by Rancher rather than by the page.
   *
   * Only Vertex sets it, and only because of the CORS refusal above — not
   * because the credential needs hiding.
   */
  viaProxy: boolean;
}

/** Human-readable provider name for error messages. */
export const PROVIDER_LABELS: Record<LlmProvider, string> = {
  anthropic: 'Anthropic',
  vertex:    'Claude on Vertex AI',
  claudeAws: 'Claude on AWS',
};

export function modelFor(cfg: ExtensionConfig): string {
  return cfg.llmModel?.trim() || DEFAULT_MODELS[cfg.llmProvider] || DEFAULT_MODELS.anthropic;
}

/** The model this call should use: the per-request override, else the config. */
function requestModel(cfg: ExtensionConfig, req: ClaudeRequest): string {
  return req.model?.trim() || modelFor(cfg);
}

/**
 * The shared body. `model` is a body field on Anthropic and Claude on AWS;
 * Vertex takes it in the URL and wants `anthropic_version` here instead.
 */
function baseBody({
  system, userContent, maxTokens, disableThinking
}: ClaudeRequest) {
  return {
    max_tokens: maxTokens,
    system,
    messages:   [{ role: 'user', content: userContent }],
    // Only sent when asked for, so every existing caller keeps the body it had.
    ...(disableThinking ? { thinking: { type: 'disabled' } } : {}),
  };
}

export function prepareAnthropic(cfg: ExtensionConfig, req: ClaudeRequest): PreparedRequest {
  if (!cfg.anthropicApiKey) {
    throw new Error('No Anthropic API key configured.');
  }

  return {
    url:     ANTHROPIC_API_URL,
    headers: {
      'content-type':                              'application/json',
      'x-api-key':                                 cfg.anthropicApiKey,
      'anthropic-version':                         ANTHROPIC_VERSION,
      // Required for the API to serve CORS requests made straight from a browser.
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body:     JSON.stringify({ model: requestModel(cfg, req), ...baseBody(req) }),
    viaProxy: false,
  };
}

/**
 * Claude Platform on AWS.
 *
 * Three things to know, each of which fails unhelpfully when it is wrong:
 *
 * - The region is in the hostname and nothing else. A region the account has
 *   no endpoint in still resolves in DNS, so the failure arrives as a
 *   connection or HTML error rather than an API one.
 * - The workspace id is required on every single call and cannot be worked out
 *   from the key, so it is checked here rather than left to a 400 upstream.
 * - The key must be one made in the AWS console under Claude Platform on AWS.
 *   A Bedrock API key is a different thing and is rejected.
 */
export function prepareClaudeAws(cfg: ExtensionConfig, req: ClaudeRequest): PreparedRequest {
  if (!cfg.claudeAwsApiKey) {
    throw new Error('No Claude on AWS API key configured.');
  }

  const workspaceId = cfg.claudeAwsWorkspaceId?.trim();

  if (!workspaceId) {
    throw new Error('No Claude on AWS workspace id configured.');
  }

  const region = cfg.claudeAwsRegion?.trim();

  if (!region) {
    throw new Error('No Claude on AWS region configured.');
  }

  return {
    url:     CLAUDE_AWS_API_URL(region),
    headers: {
      'content-type':           'application/json',
      'x-api-key':              cfg.claudeAwsApiKey,
      'anthropic-version':      ANTHROPIC_VERSION,
      'anthropic-workspace-id': workspaceId,
    },
    body:     JSON.stringify({ model: requestModel(cfg, req), ...baseBody(req) }),
    viaProxy: false,
  };
}

/**
 * Claude on Vertex AI.
 *
 * Differs from the other two in every mechanical detail, and each one is a
 * silent 404 or 401 when it is wrong:
 *
 * - The model goes in the URL path, and a dated snapshot spells its date with
 *   `@` rather than `-` (`claude-haiku-4-5@20251001`).
 * - `anthropic_version` is a *body* field here, with a Vertex-specific value,
 *   and `model` must not appear in the body at all.
 * - Auth is an OAuth2 bearer. There is no API key form; Vertex Express Mode
 *   keys are `publishers/google` only and 404 against the Anthropic publisher.
 * - The model has to be enabled for the project in Model Garden first.
 */
export async function prepareVertex(cfg: ExtensionConfig, req: ClaudeRequest): Promise<PreparedRequest> {
  const project = cfg.vertexProjectId?.trim();

  if (!project) {
    throw new Error('No Vertex project id configured.');
  }

  const region = cfg.vertexRegion?.trim() || DEFAULT_VERTEX_REGION;
  const token = await vertexAccessToken(cfg);

  return {
    url:     vertexApiUrl(project, region, vertexModelId(requestModel(cfg, req))),
    headers: {
      'content-type': 'application/json',
      Authorization:  `Bearer ${ token }`,
    },
    body: JSON.stringify({
      anthropic_version: VERTEX_ANTHROPIC_VERSION,
      ...baseBody(req),
    }),
    viaProxy: true,
  };
}

/** Build the request for whichever provider is selected. */
export function prepare(cfg: ExtensionConfig, req: ClaudeRequest): Promise<PreparedRequest> {
  switch (cfg.llmProvider) {
  case 'vertex':
    return prepareVertex(cfg, req);
  case 'claudeAws':
    return Promise.resolve(prepareClaudeAws(cfg, req));
  default:
    return Promise.resolve(prepareAnthropic(cfg, req));
  }
}

/** Concatenated text blocks of a Messages reply. */
export function textOf(parsed: MessagesResponse | null | undefined): string {
  return (parsed?.content || [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text || '')
    .join('');
}

/**
 * Build the `/meta/proxy` form of an upstream URL.
 *
 * Same transform `useGitHubApi` performs; see the note there about why
 * `@shell/apis/shell/proxy` cannot be imported yet.
 */
export function proxyUrl(url: string): string {
  return `/meta/proxy/${ url.replace(/^https:\/\//, '').replace(/^http:\/\//, 'http:/') }`;
}

export function useClaude(store: RancherStore) {
  /**
   * Allow-list the Vertex host on Rancher's proxy before the first call to it.
   *
   * The dashboard does this on mount for all three providers, so in the normal
   * flow this is a cache hit and costs nothing. It stays as a safety net for
   * the routes into a classification run that never touch the dashboard — a
   * deep link, or a reload on the known-extensions page. Without it the hop
   * fails with a Rancher-level error that never mentions Vertex, which reads
   * like a broken credential.
   */
  const ensureVertexProxy = async(cfg: ExtensionConfig): Promise<void> => {
    await ensureProxyTargets(store, [vertexProxyTarget(cfg)]);
  };

  /**
   * Issue the call through Rancher.
   *
   * The bearer travels in `x-api-auth-header`, which Rancher strips and
   * replays upstream as `Authorization` — the same mechanism the GitHub token
   * uses. The response comes back from same-origin `/meta/proxy`, so the
   * preflight Google refuses never happens.
   */
  const sendViaProxy = async(prepared: PreparedRequest): Promise<MessagesResponse> => {
    return await store.dispatch('management/request', {
      url:     proxyUrl(prepared.url),
      method:  'POST',
      headers: {
        'content-type':      'application/json',
        'x-api-auth-header': prepared.headers.Authorization,
      },
      data:                 JSON.parse(prepared.body),
      redirectUnauthorized: false,
    }, { root: true }) as MessagesResponse;
  };

  const sendDirect = async(prepared: PreparedRequest, label: string): Promise<MessagesResponse> => {
    const res = await fetch(prepared.url, {
      method: 'POST', headers: prepared.headers, body: prepared.body
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => res.statusText);

      throw new Error(`${ label } API error (${ res.status }): ${ detail }`);
    }

    return await res.json();
  };

  /**
   * Send one message and return the concatenated text of the reply.
   *
   * Errors carry the provider name and the upstream body, because the three
   * fail in quite different ways — a Vertex model not enabled in Model Garden,
   * a Bedrock key pasted into the Claude on AWS fields, a service account
   * without the Vertex AI User role — and the raw message is usually the only
   * thing that tells them apart.
   */
  const sendMessage = async(cfg: ExtensionConfig, req: ClaudeRequest): Promise<string> => {
    const prepared = await prepare(cfg, req);
    const label = PROVIDER_LABELS[cfg.llmProvider] || cfg.llmProvider;

    if (!prepared.viaProxy) {
      return textOf(await sendDirect(prepared, label));
    }

    await ensureVertexProxy(cfg);

    try {
      return textOf(await sendViaProxy(prepared));
    } catch (e: unknown) {
      // Until the Vertex host is allow-listed Rancher refuses the hop itself,
      // and says nothing about Vertex in the process.
      const status = storeErrorStatus(e) ?? 0;
      const host = vertexHost(cfg.vertexRegion?.trim() || DEFAULT_VERTEX_REGION);
      const hint = store.getters['i18n/t']('extensionsCenter.errors.vertexProxyFailed', { host });

      throw new Error(`${ label } API error (${ status }): ${ errorMessage(e) } ${ hint }`);
    }
  };

  return { sendMessage };
}
