import {
  ANTHROPIC_API_URL,
  ANTHROPIC_VERSION,
  BEDROCK_ANTHROPIC_VERSION,
  CLAUDE_AWS_API_URL,
  DEFAULT_AWS_REGION,
  DEFAULT_MODELS
} from '../config/constants';
import { ExtensionConfig } from '../types/common';
import { signRequest } from '../utils/awsSigV4';

/**
 * One Messages API call, against whichever provider is configured.
 *
 * The three providers speak the same Messages format but disagree on where the
 * model id and the version go and on how the call is authenticated, and that is
 * all this module exists to reconcile:
 *
 * | | model id goes in | version goes in | auth |
 * |-|-|-|-|
 * | Anthropic | body | `anthropic-version` header | `x-api-key` |
 * | Claude on AWS | body | `anthropic-version` header | `x-api-key` + workspace id |
 * | Bedrock | URL path | `anthropic_version` body field | SigV4 signature |
 *
 * Claude Platform on AWS is the first-party API with a different hostname in
 * front of it, which is why its branch is so much smaller than Bedrock's: no
 * signing, no token exchange, just a key and the workspace it belongs to.
 *
 * All three answer CORS preflights for a browser origin with
 * `access-control-allow-origin: *`, so each is called directly with no proxy in
 * between.
 */

export interface ClaudeRequest {
  system: string;
  userContent: string;
  maxTokens: number;
}

/** The part of a Messages API response we read. Identical across providers. */
interface MessagesResponse {
  content?: { type: string; text?: string }[];
}

interface PreparedRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

function modelFor(cfg: ExtensionConfig): string {
  return cfg.llmModel?.trim() || DEFAULT_MODELS[cfg.llmProvider];
}

/**
 * The shared body. `model` is only a body field on first-party Anthropic; the
 * cloud providers take it in the URL and want `anthropic_version` here instead.
 */
function baseBody({ system, userContent, maxTokens }: ClaudeRequest) {
  return {
    max_tokens: maxTokens,
    system,
    messages:   [{ role: 'user', content: userContent }],
  };
}

function prepareAnthropic(cfg: ExtensionConfig, req: ClaudeRequest): PreparedRequest {
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
    body: JSON.stringify({ model: modelFor(cfg), ...baseBody(req) }),
  };
}

async function prepareBedrock(cfg: ExtensionConfig, req: ClaudeRequest): Promise<PreparedRequest> {
  if (!cfg.awsAccessKeyId || !cfg.awsSecretAccessKey) {
    throw new Error('No AWS access key configured.');
  }

  const region = cfg.awsRegion?.trim() || DEFAULT_AWS_REGION;
  const model = modelFor(cfg);

  // Bedrock model ids contain a `:` (the version suffix). It has to stay
  // percent-encoded in the path, and identically so in the signature, which is
  // why the encoded URL is what gets signed.
  const url = `https://bedrock-runtime.${ region }.amazonaws.com/model/${ encodeURIComponent(model) }/invoke`;

  const body = JSON.stringify({ anthropic_version: BEDROCK_ANTHROPIC_VERSION, ...baseBody(req) });

  const headers = await signRequest(
    {
      accessKeyId:     cfg.awsAccessKeyId,
      secretAccessKey: cfg.awsSecretAccessKey,
      sessionToken:    cfg.awsSessionToken,
      region,
    },
    {
      url, service: 'bedrock', body
    },
  );

  return {
    url, headers, body
  };
}

/**
 * Claude Platform on AWS.
 *
 * Three things to know, each of which fails unhelpfully when it is wrong:
 *
 * - The region is in the hostname and nothing else. A region the account has no
 *   endpoint in still resolves in DNS, so the failure arrives as a connection or
 *   HTML error rather than an API one.
 * - The workspace id is required on every single call and cannot be worked out
 *   from the key, so it is checked here rather than left to a 400 upstream.
 * - The key must be one made in the AWS console under Claude Platform on AWS. A
 *   Bedrock API key is a different thing and is rejected.
 */
function prepareClaudeAws(cfg: ExtensionConfig, req: ClaudeRequest): PreparedRequest {
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
    body: JSON.stringify({ model: modelFor(cfg), ...baseBody(req) }),
  };
}

function prepare(cfg: ExtensionConfig, req: ClaudeRequest): Promise<PreparedRequest> {
  switch (cfg.llmProvider) {
  case 'bedrock':
    return prepareBedrock(cfg, req);
  case 'claudeAws':
    return Promise.resolve(prepareClaudeAws(cfg, req));
  default:
    return Promise.resolve(prepareAnthropic(cfg, req));
  }
}

/** Human-readable provider name for error messages. */
const PROVIDER_LABELS: Record<string, string> = {
  anthropic: 'Anthropic',
  claudeAws: 'Claude on AWS',
  bedrock:   'Bedrock',
};

/**
 * Send one message and return the concatenated text blocks of the reply.
 *
 * Errors carry the provider name and the upstream body, because the three fail
 * in quite different ways — an unenabled Bedrock model, a Bedrock key pasted
 * into the Claude on AWS fields, and an AWS account that has never had outbound
 * web identity federation switched on all surface here, and the raw message is
 * the only thing that tells them apart.
 */
export async function sendMessage(cfg: ExtensionConfig, req: ClaudeRequest): Promise<string> {
  const { url, headers, body } = await prepare(cfg, req);

  const res = await fetch(url, {
    method: 'POST', headers, body
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText);
    const label = PROVIDER_LABELS[cfg.llmProvider] || cfg.llmProvider;

    throw new Error(`${ label } API error (${ res.status }): ${ detail }`);
  }

  const parsed: MessagesResponse = await res.json();

  return (parsed?.content || [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text || '')
    .join('');
}
