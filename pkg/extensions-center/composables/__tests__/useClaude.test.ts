import { ANTHROPIC_VERSION, DEFAULT_MODELS, VERTEX_ANTHROPIC_VERSION, vertexProxyEndpointName } from '../../config/constants';
import { ExtensionConfig, LlmProvider } from '../../types/common';
import { RancherStore } from '../../types/rancher';
import {
  modelFor,
  prepare,
  prepareAnthropic,
  prepareClaudeAws,
  prepareVertex,
  proxyUrl,
  textOf,
  useClaude,
  PROVIDER_LABELS
} from '../useClaude';
import { resetProxyTargetCache } from '../useLlmProxy';
import { useProxyEndpoint } from '../useProxyEndpoint';
import { vertexAccessToken } from '../useVertexAuth';

jest.mock('../useVertexAuth', () => ({ vertexAccessToken: jest.fn(async() => 'ya29.token') }));
jest.mock('../useProxyEndpoint', () => ({ useProxyEndpoint: jest.fn() }));

const ensure = jest.fn(async() => 'ready');

/**
 * Config with every provider's credentials filled in.
 *
 * All of them at once on purpose: the config object really does carry all
 * three, so a prepare function reading the wrong field would otherwise show up
 * as a missing-credential error rather than as the wrong request.
 */
function makeConfig(over: Partial<ExtensionConfig> = {}): ExtensionConfig {
  return {
    githubToken:          'ghp_x',
    llmProvider:          'anthropic',
    llmModel:             null,
    anthropicApiKey:      'sk-ant-key',
    vertexServiceAccount: '{"type":"service_account"}',
    vertexProjectId:      'my-project',
    vertexRegion:         null,
    claudeAwsApiKey:      'aws-key',
    claudeAwsWorkspaceId: 'wrkspc_123',
    claudeAwsRegion:      'us-east-1',
    ...over,
  };
}

const REQUEST = {
  system: 'You are terse.', userContent: 'ping', maxTokens: 16
};

/** Minimal Vuex stand-in: the two entry points `useClaude` actually touches. */
function makeStore(dispatch: jest.Mock = jest.fn()): { store: RancherStore; dispatch: jest.Mock } {
  const store = {
    dispatch,
    getters: { 'i18n/t': (key: string, args?: Record<string, unknown>) => `${ key }(${ JSON.stringify(args) })` },
  } as unknown as RancherStore;

  return { store, dispatch };
}

const fetchMock = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  // The allow-list cache is module-level and shared with the dashboard, so it
  // outlives a test unless it is cleared here.
  resetProxyTargetCache();
  (useProxyEndpoint as jest.Mock).mockReturnValue({ ensure });
  (vertexAccessToken as jest.Mock).mockResolvedValue('ya29.token');
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe('modelFor', () => {
  it('falls back to the provider default', () => {
    (['anthropic', 'vertex', 'claudeAws'] as LlmProvider[]).forEach((llmProvider) => {
      expect(modelFor(makeConfig({ llmProvider }))).toBe(DEFAULT_MODELS[llmProvider]);
    });
  });

  it('prefers a configured model, trimmed', () => {
    expect(modelFor(makeConfig({ llmModel: '  claude-haiku-4-5  ' }))).toBe('claude-haiku-4-5');
  });

  it('treats a blank override as unset rather than as an empty model id', () => {
    expect(modelFor(makeConfig({ llmModel: '   ' }))).toBe(DEFAULT_MODELS.anthropic);
  });
});

describe('prepareAnthropic', () => {
  it('builds a direct, browser-allowed Messages call', () => {
    const prepared = prepareAnthropic(makeConfig({ llmModel: 'claude-opus-5' }), REQUEST);

    expect(prepared.url).toBe('https://api.anthropic.com/v1/messages');
    expect(prepared.viaProxy).toBe(false);
    expect(prepared.headers).toEqual({
      'content-type':                              'application/json',
      'x-api-key':                                 'sk-ant-key',
      'anthropic-version':                         ANTHROPIC_VERSION,
      'anthropic-dangerous-direct-browser-access': 'true',
    });
    expect(JSON.parse(prepared.body)).toEqual({
      model:      'claude-opus-5',
      max_tokens: 16,
      system:     'You are terse.',
      messages:   [{ role: 'user', content: 'ping' }],
    });
  });

  it('sets the header that makes the API answer a browser at all', () => {
    // Without it the call is refused regardless of whether the key is good.
    expect(prepareAnthropic(makeConfig(), REQUEST).headers['anthropic-dangerous-direct-browser-access']).toBe('true');
  });

  it('refuses without a key', () => {
    expect(() => prepareAnthropic(makeConfig({ anthropicApiKey: null }), REQUEST))
      .toThrow('No Anthropic API key configured.');
  });
});

describe('prepareClaudeAws', () => {
  it('builds a direct call to the regional Claude-on-AWS host', () => {
    const prepared = prepareClaudeAws(makeConfig({ claudeAwsRegion: 'eu-central-1' }), REQUEST);

    expect(prepared.url).toBe('https://aws-external-anthropic.eu-central-1.api.aws/v1/messages');
    expect(prepared.viaProxy).toBe(false);
    expect(prepared.headers).toEqual({
      'content-type':           'application/json',
      'x-api-key':              'aws-key',
      'anthropic-version':      ANTHROPIC_VERSION,
      'anthropic-workspace-id': 'wrkspc_123',
    });
  });

  it('sends the same body shape as first-party Anthropic', () => {
    const cfg = makeConfig({ llmModel: 'claude-opus-5' });

    expect(JSON.parse(prepareClaudeAws(cfg, REQUEST).body))
      .toEqual(JSON.parse(prepareAnthropic(cfg, REQUEST).body));
  });

  it('trims the region and the workspace id out of the form fields', () => {
    const prepared = prepareClaudeAws(
      makeConfig({ claudeAwsRegion: ' us-west-2 ', claudeAwsWorkspaceId: ' wrkspc_9 ' }),
      REQUEST,
    );

    expect(prepared.url).toBe('https://aws-external-anthropic.us-west-2.api.aws/v1/messages');
    expect(prepared.headers['anthropic-workspace-id']).toBe('wrkspc_9');
  });

  it.each([
    [{ claudeAwsApiKey: null }, 'No Claude on AWS API key configured.'],
    [{ claudeAwsWorkspaceId: null }, 'No Claude on AWS workspace id configured.'],
    [{ claudeAwsWorkspaceId: '  ' }, 'No Claude on AWS workspace id configured.'],
    [{ claudeAwsRegion: null }, 'No Claude on AWS region configured.'],
    [{ claudeAwsRegion: '  ' }, 'No Claude on AWS region configured.'],
  ])('names what is missing for %p', (over, message) => {
    // Each of these otherwise fails upstream as a 400, a 403 or a DNS error.
    expect(() => prepareClaudeAws(makeConfig(over), REQUEST)).toThrow(message);
  });
});

describe('prepareVertex', () => {
  it('puts the model in the URL and the version in the body', async() => {
    const prepared = await prepareVertex(makeConfig({ llmModel: 'claude-opus-5', vertexRegion: 'us-east5' }), REQUEST);

    expect(prepared.url).toBe(
      'https://us-east5-aiplatform.googleapis.com/v1/projects/my-project/locations/us-east5' +
      '/publishers/anthropic/models/claude-opus-5:rawPredict'
    );

    const body = JSON.parse(prepared.body);

    expect(body).toEqual({
      anthropic_version: VERTEX_ANTHROPIC_VERSION,
      max_tokens:        16,
      system:            'You are terse.',
      messages:          [{ role: 'user', content: 'ping' }],
    });
    expect(body).not.toHaveProperty('model');
  });

  it('rewrites a dated snapshot to the @ spelling', async() => {
    const prepared = await prepareVertex(makeConfig({ llmModel: 'claude-haiku-4-5-20251001' }), REQUEST);

    expect(prepared.url).toContain('/models/claude-haiku-4-5@20251001:rawPredict');
  });

  it('defaults to the global location', async() => {
    const prepared = await prepareVertex(makeConfig({ vertexRegion: null }), REQUEST);

    expect(prepared.url).toContain('https://aiplatform.googleapis.com/v1/projects/my-project/locations/global/');
  });

  it('treats a blank region as unset', async() => {
    const prepared = await prepareVertex(makeConfig({ vertexRegion: '   ' }), REQUEST);

    expect(prepared.url).toContain('/locations/global/');
  });

  it('authenticates with a bearer token and no api key', async() => {
    const prepared = await prepareVertex(makeConfig(), REQUEST);

    expect(prepared.headers).toEqual({ 'content-type': 'application/json', Authorization: 'Bearer ya29.token' });
    expect(prepared.headers['x-api-key']).toBeUndefined();
  });

  it('is the only provider marked for the proxy hop', async() => {
    expect((await prepareVertex(makeConfig(), REQUEST)).viaProxy).toBe(true);
    expect(prepareAnthropic(makeConfig(), REQUEST).viaProxy).toBe(false);
    expect(prepareClaudeAws(makeConfig(), REQUEST).viaProxy).toBe(false);
  });

  it('refuses without a project id, before minting a token', async() => {
    await expect(prepareVertex(makeConfig({ vertexProjectId: null }), REQUEST))
      .rejects.toThrow('No Vertex project id configured.');
    await expect(prepareVertex(makeConfig({ vertexProjectId: '  ' }), REQUEST))
      .rejects.toThrow('No Vertex project id configured.');

    expect(vertexAccessToken).not.toHaveBeenCalled();
  });

  it('surfaces a token failure rather than calling Vertex unauthenticated', async() => {
    (vertexAccessToken as jest.Mock).mockRejectedValue(new Error('Google token exchange failed: invalid_grant'));

    await expect(prepareVertex(makeConfig(), REQUEST)).rejects.toThrow('invalid_grant');
  });
});

describe('prepare', () => {
  it('routes to the provider named in the config', async() => {
    expect((await prepare(makeConfig({ llmProvider: 'anthropic' }), REQUEST)).url)
      .toBe('https://api.anthropic.com/v1/messages');
    expect((await prepare(makeConfig({ llmProvider: 'claudeAws' }), REQUEST)).url)
      .toContain('aws-external-anthropic');
    expect((await prepare(makeConfig({ llmProvider: 'vertex' }), REQUEST)).url)
      .toContain('aiplatform.googleapis.com');
  });

  it('falls back to Anthropic for an unrecognised provider', async() => {
    const cfg = makeConfig({ llmProvider: 'something-else' as LlmProvider });

    expect((await prepare(cfg, REQUEST)).url).toBe('https://api.anthropic.com/v1/messages');
  });
});

describe('textOf', () => {
  it('joins the text blocks in order', () => {
    expect(textOf({ content: [{ type: 'text', text: 'one ' }, { type: 'text', text: 'two' }] })).toBe('one two');
  });

  it('skips blocks that are not text', () => {
    expect(textOf({
      content: [
        { type: 'thinking', text: 'hidden' },
        { type: 'text', text: 'shown' },
        { type: 'tool_use' },
      ],
    })).toBe('shown');
  });

  it('is empty rather than throwing for a reply with no content', () => {
    expect(textOf(null)).toBe('');
    expect(textOf(undefined)).toBe('');
    expect(textOf({})).toBe('');
    expect(textOf({ content: [] })).toBe('');
    expect(textOf({ content: [{ type: 'text' }] })).toBe('');
  });
});

describe('proxyUrl', () => {
  it('drops the https scheme, which is what Rancher expects', () => {
    expect(proxyUrl('https://aiplatform.googleapis.com/v1/x'))
      .toBe('/meta/proxy/aiplatform.googleapis.com/v1/x');
  });

  it('keeps a single-slash http marker for plain-http upstreams', () => {
    expect(proxyUrl('http://example.test/v1/x')).toBe('/meta/proxy/http:/example.test/v1/x');
  });

  it('leaves the query string alone', () => {
    expect(proxyUrl('https://host.test/v1/x?a=1&b=2')).toBe('/meta/proxy/host.test/v1/x?a=1&b=2');
  });
});

describe('PROVIDER_LABELS', () => {
  it('names each provider in the way the error messages do', () => {
    expect(PROVIDER_LABELS).toEqual({
      anthropic: 'Anthropic',
      vertex:    'Claude on Vertex AI',
      claudeAws: 'Claude on AWS',
    });
  });
});

describe('useClaude().sendMessage — direct providers', () => {
  it('fetches Anthropic and returns the reply text', async() => {
    fetchMock.mockResolvedValue({ ok: true, json: async() => ({ content: [{ type: 'text', text: 'OK' }] }) });

    const { store, dispatch } = makeStore();

    expect(await useClaude(store).sendMessage(makeConfig(), REQUEST)).toBe('OK');

    const [url, init] = fetchMock.mock.calls[0];

    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.method).toBe('POST');
    expect(init.headers['x-api-key']).toBe('sk-ant-key');
    // Nothing goes near Rancher for a provider the browser can reach.
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('fetches Claude on AWS with the workspace id', async() => {
    fetchMock.mockResolvedValue({ ok: true, json: async() => ({ content: [{ type: 'text', text: 'OK' }] }) });

    const { store } = makeStore();

    await useClaude(store).sendMessage(makeConfig({ llmProvider: 'claudeAws' }), REQUEST);

    expect(fetchMock.mock.calls[0][1].headers['anthropic-workspace-id']).toBe('wrkspc_123');
  });

  it('reports the provider, the status and the upstream body on failure', async() => {
    fetchMock.mockResolvedValue({
      ok:         false,
      status:     401,
      statusText: 'Unauthorized',
      text:       async() => '{"error":{"message":"invalid x-api-key"}}',
    });

    const { store } = makeStore();

    await expect(useClaude(store).sendMessage(makeConfig(), REQUEST))
      .rejects.toThrow('Anthropic API error (401): {"error":{"message":"invalid x-api-key"}}');
  });

  it('falls back to the status text when the error body cannot be read', async() => {
    fetchMock.mockResolvedValue({
      ok:         false,
      status:     502,
      statusText: 'Bad Gateway',
      text:       async() => {
        throw new Error('stream closed');
      },
    });

    const { store } = makeStore();

    await expect(useClaude(store).sendMessage(makeConfig(), REQUEST))
      .rejects.toThrow('Anthropic API error (502): Bad Gateway');
  });

  it('never allow-lists a proxy host for a provider that does not need one', async() => {
    fetchMock.mockResolvedValue({ ok: true, json: async() => ({ content: [] }) });

    const { store } = makeStore();

    await useClaude(store).sendMessage(makeConfig(), REQUEST);

    expect(useProxyEndpoint).not.toHaveBeenCalled();
  });
});

describe('useClaude().sendMessage — Vertex through the proxy', () => {
  it('issues the call through Rancher, with the bearer in x-api-auth-header', async() => {
    const dispatch = jest.fn(async() => ({ content: [{ type: 'text', text: 'OK' }] }));
    const { store } = makeStore(dispatch as unknown as jest.Mock);

    const reply = await useClaude(store).sendMessage(
      makeConfig({ llmProvider: 'vertex', vertexRegion: 'europe-west1' }),
      REQUEST,
    );

    expect(reply).toBe('OK');
    // The page never touches rawPredict itself — that is the CORS refusal.
    expect(fetchMock).not.toHaveBeenCalled();

    const [action, payload] = dispatch.mock.calls.at(-1) as unknown as [string, Record<string, unknown>];

    expect(action).toBe('management/request');
    expect(payload.url).toBe(
      '/meta/proxy/europe-west1-aiplatform.googleapis.com/v1/projects/my-project/locations/europe-west1' +
      `/publishers/anthropic/models/${ DEFAULT_MODELS.vertex }:rawPredict`
    );
    expect(payload.method).toBe('POST');
    expect(payload.headers).toEqual({ 'content-type': 'application/json', 'x-api-auth-header': 'Bearer ya29.token' });
    expect(payload.data).toEqual({
      anthropic_version: VERTEX_ANTHROPIC_VERSION,
      max_tokens:        16,
      system:            'You are terse.',
      messages:          [{ role: 'user', content: 'ping' }],
    });
    expect(payload.redirectUnauthorized).toBe(false);
  });

  it('sends the token as x-api-auth-header, never as a bare Authorization header', async() => {
    // Rancher strips `x-api-auth-header` and replays it upstream; an
    // `Authorization` here would be the dashboard's own session instead.
    const dispatch = jest.fn(async() => ({ content: [] }));
    const { store } = makeStore(dispatch as unknown as jest.Mock);

    await useClaude(store).sendMessage(makeConfig({ llmProvider: 'vertex', vertexRegion: 'us-west1' }), REQUEST);

    const payload = (dispatch.mock.calls.at(-1) as unknown as [string, Record<string, unknown>])[1];

    expect(payload.headers).not.toHaveProperty('Authorization');
  });

  it('allow-lists the Vertex host before the first call to it', async() => {
    const dispatch = jest.fn(async() => ({ content: [] }));
    const { store } = makeStore(dispatch as unknown as jest.Mock);

    await useClaude(store).sendMessage(makeConfig({ llmProvider: 'vertex', vertexRegion: 'us-east4' }), REQUEST);

    expect(useProxyEndpoint).toHaveBeenCalledWith(
      store,
      'us-east4-aiplatform.googleapis.com',
      vertexProxyEndpointName('us-east4-aiplatform.googleapis.com'),
    );
    expect(ensure).toHaveBeenCalledTimes(1);
  });

  it('checks a given host once, not once per request', async() => {
    // A classification run sends a request every few seconds and the check is
    // a findAll over a cluster-scoped type.
    const dispatch = jest.fn(async() => ({ content: [] }));
    const { store } = makeStore(dispatch as unknown as jest.Mock);
    const cfg = makeConfig({ llmProvider: 'vertex', vertexRegion: 'asia-east1' });

    await useClaude(store).sendMessage(cfg, REQUEST);
    await useClaude(store).sendMessage(cfg, REQUEST);
    await useClaude(store).sendMessage(cfg, REQUEST);

    expect(ensure).toHaveBeenCalledTimes(1);
  });

  it('checks each host separately, so switching region re-checks', async() => {
    const dispatch = jest.fn(async() => ({ content: [] }));
    const { store } = makeStore(dispatch as unknown as jest.Mock);
    const claude = useClaude(store);

    await claude.sendMessage(makeConfig({ llmProvider: 'vertex', vertexRegion: 'northamerica-northeast1' }), REQUEST);
    await claude.sendMessage(makeConfig({ llmProvider: 'vertex', vertexRegion: 'southamerica-east1' }), REQUEST);

    expect(ensure).toHaveBeenCalledTimes(2);
    expect((useProxyEndpoint as jest.Mock).mock.calls.map((c) => c[1])).toEqual([
      'northamerica-northeast1-aiplatform.googleapis.com',
      'southamerica-east1-aiplatform.googleapis.com',
    ]);
  });

  it('adds the allow-list hint when Rancher refuses the hop', async() => {
    // Rancher's own refusal says nothing about Vertex, so on its own it reads
    // like a broken credential.
    const dispatch = jest.fn(async() => {
      // Shaped like a Rancher store rejection: an Error carrying a status.
      throw Object.assign(new Error('no such proxy route'), { status: 503 });
    });
    const { store } = makeStore(dispatch as unknown as jest.Mock);

    await expect(useClaude(store).sendMessage(
      makeConfig({ llmProvider: 'vertex', vertexRegion: 'australia-southeast1' }),
      REQUEST,
    )).rejects.toThrow(
      'Claude on Vertex AI API error (503): no such proxy route ' +
      'extensionsCenter.errors.vertexProxyFailed({"host":"australia-southeast1-aiplatform.googleapis.com"})'
    );
  });

  it('reports status 0 when the failure carries none', async() => {
    const dispatch = jest.fn(async() => {
      throw new Error('Network request failed');
    });
    const { store } = makeStore(dispatch as unknown as jest.Mock);

    await expect(useClaude(store).sendMessage(
      makeConfig({ llmProvider: 'vertex', vertexRegion: 'me-west1' }),
      REQUEST,
    )).rejects.toThrow('Claude on Vertex AI API error (0): Network request failed');
  });

  it('does not reach Rancher at all when the token cannot be minted', async() => {
    (vertexAccessToken as jest.Mock).mockRejectedValue(new Error('Google token exchange failed: invalid_grant'));

    const dispatch = jest.fn();
    const { store } = makeStore(dispatch);

    await expect(useClaude(store).sendMessage(
      makeConfig({ llmProvider: 'vertex', vertexRegion: 'us-south1' }),
      REQUEST,
    )).rejects.toThrow('invalid_grant');

    expect(dispatch).not.toHaveBeenCalled();
    expect(ensure).not.toHaveBeenCalled();
  });
});
