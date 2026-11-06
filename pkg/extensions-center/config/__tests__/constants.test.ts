import {
  ANTHROPIC_API_URL,
  ANTHROPIC_PROXY_DOMAIN,
  ANTHROPIC_VERSION,
  CLAUDE_AWS_API_URL,
  DEFAULT_CLAUDE_AWS_REGION,
  DEFAULT_LLM_PROVIDER,
  DEFAULT_MODELS,
  DEFAULT_VERTEX_REGION,
  GCP_SCOPE,
  GCP_TOKEN_LIFETIME,
  GCP_TOKEN_SKEW,
  GCP_TOKEN_URL,
  LLM_PROVIDERS,
  VERTEX_ANTHROPIC_VERSION,
  claudeAwsHost,
  claudeAwsProxyEndpointName,
  vertexApiUrl,
  vertexHost,
  vertexModelId,
  vertexProxyEndpointName
} from '../constants';

describe('LLM provider set', () => {
  it('is exactly the three providers the extension supports', () => {
    expect([...LLM_PROVIDERS]).toEqual(['anthropic', 'vertex', 'claudeAws']);
  });

  it('defaults to the one needing no cloud account', () => {
    expect(LLM_PROVIDERS).toContain(DEFAULT_LLM_PROVIDER);
    expect(DEFAULT_LLM_PROVIDER).toBe('anthropic');
  });

  it('has a default model for every provider and none for anything else', () => {
    // A provider added without a model entry silently falls back to the
    // Anthropic id in `modelFor`, which on Vertex is a 404 rather than an error.
    expect(Object.keys(DEFAULT_MODELS).sort()).toEqual([...LLM_PROVIDERS].sort());
    Object.values(DEFAULT_MODELS).forEach((model) => expect(model).toBeTruthy());
  });
});

describe('vertexHost', () => {
  it.each([
    ['global', 'aiplatform.googleapis.com'],
    ['us', 'aiplatform.us.rep.googleapis.com'],
    ['eu', 'aiplatform.eu.rep.googleapis.com'],
    ['us-east5', 'us-east5-aiplatform.googleapis.com'],
    ['europe-west1', 'europe-west1-aiplatform.googleapis.com'],
  ])('maps %s to %s', (location, expected) => {
    expect(vertexHost(location)).toBe(expected);
  });

  it('is case- and whitespace-insensitive, since this comes out of a text field', () => {
    expect(vertexHost('  GLOBAL ')).toBe('aiplatform.googleapis.com');
    expect(vertexHost(' US-East5 ')).toBe('us-east5-aiplatform.googleapis.com');
    expect(vertexHost('EU')).toBe('aiplatform.eu.rep.googleapis.com');
  });

  it('does not treat a region beginning with "us" as the us multi-region', () => {
    // `us-east5` and `us` have completely different hostname shapes, and
    // getting it wrong returns a 404 that reads as a missing model.
    expect(vertexHost('us-central1')).toBe('us-central1-aiplatform.googleapis.com');
    expect(vertexHost('europe-west4')).not.toContain('.rep.');
  });
});

describe('vertexApiUrl', () => {
  it('puts the project, the location and the model in the path, ending in rawPredict', () => {
    expect(vertexApiUrl('my-project', 'us-east5', 'claude-opus-5')).toBe(
      'https://us-east5-aiplatform.googleapis.com/v1/projects/my-project/locations/us-east5' +
      '/publishers/anthropic/models/claude-opus-5:rawPredict'
    );
  });

  it('keeps the location in the path even when the host does not carry it', () => {
    // The global host has no region in its name, but the path still needs one.
    expect(vertexApiUrl('p', 'global', 'claude-opus-5')).toBe(
      'https://aiplatform.googleapis.com/v1/projects/p/locations/global' +
      '/publishers/anthropic/models/claude-opus-5:rawPredict'
    );
  });

  it('addresses the anthropic publisher, not google', () => {
    expect(vertexApiUrl('p', 'global', 'm')).toContain('/publishers/anthropic/');
  });
});

describe('vertexModelId', () => {
  it('leaves a bare model id alone', () => {
    expect(vertexModelId('claude-opus-5')).toBe('claude-opus-5');
    expect(vertexModelId('claude-haiku-4-5')).toBe('claude-haiku-4-5');
  });

  it('switches a trailing date to the @ spelling Vertex requires', () => {
    expect(vertexModelId('claude-haiku-4-5-20251001')).toBe('claude-haiku-4-5@20251001');
    expect(vertexModelId('claude-sonnet-4-5-20250929')).toBe('claude-sonnet-4-5@20250929');
  });

  it('only rewrites an eight-digit suffix', () => {
    // A version number is not a snapshot date, and turning `-5` into `@5`
    // would 404.
    expect(vertexModelId('claude-opus-4-1')).toBe('claude-opus-4-1');
    expect(vertexModelId('model-2025100')).toBe('model-2025100');
    expect(vertexModelId('model-202510011')).toBe('model-202510011');
  });

  it('leaves an id that already uses @ untouched', () => {
    expect(vertexModelId('claude-haiku-4-5@20251001')).toBe('claude-haiku-4-5@20251001');
  });
});

describe('vertexProxyEndpointName', () => {
  it('derives a distinct name per host, so switching region cannot collide', () => {
    expect(vertexProxyEndpointName('aiplatform.googleapis.com'))
      .toBe('extensions-center-vertex-aiplatform-googleapis-com');
    expect(vertexProxyEndpointName('us-east5-aiplatform.googleapis.com'))
      .toBe('extensions-center-vertex-us-east5-aiplatform-googleapis-com');
  });

  it('never produces the same name for two different hosts', () => {
    const names = ['global', 'us', 'eu', 'us-east5', 'europe-west1']
      .map((loc) => vertexProxyEndpointName(vertexHost(loc)));

    expect(new Set(names).size).toBe(names.length);
  });

  it('produces a valid Kubernetes object name', () => {
    ['global', 'us', 'eu', 'us-east5', 'europe-west1'].forEach((loc) => {
      const name = vertexProxyEndpointName(vertexHost(loc));

      expect(name).toMatch(/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/);
      expect(name.length).toBeLessThanOrEqual(253);
    });
  });
});

describe('claudeAwsProxyEndpointName', () => {
  it('derives a distinct name per host, so switching region cannot collide', () => {
    expect(claudeAwsProxyEndpointName(claudeAwsHost('us-east-1')))
      .toBe('extensions-center-claude-aws-aws-external-anthropic-us-east-1-api-aws');
  });

  it('produces a valid Kubernetes object name', () => {
    ['us-east-1', 'eu-central-1', 'ap-northeast-1'].forEach((region) => {
      const name = claudeAwsProxyEndpointName(claudeAwsHost(region));

      expect(name).toMatch(/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/);
      expect(name.length).toBeLessThanOrEqual(253);
    });
  });

  it('cannot collide with the Vertex names, which share the generator', () => {
    // Both hyphenate a hostname, so only the prefix keeps them apart.
    expect(claudeAwsProxyEndpointName('x.test')).not.toBe(vertexProxyEndpointName('x.test'));
  });
});

describe('claudeAwsHost', () => {
  it('is the hostname the URL is built from, with no scheme or path', () => {
    expect(claudeAwsHost('us-east-1')).toBe('aws-external-anthropic.us-east-1.api.aws');
    expect(CLAUDE_AWS_API_URL('us-east-1')).toContain(claudeAwsHost('us-east-1'));
  });

  it('normalises the region, so a pasted value still matches the allow-list', () => {
    // The host goes into a ProxyEndpoint as well as a URL, and a stray space
    // there is a route that silently never matches.
    expect(claudeAwsHost('  US-East-1  ')).toBe('aws-external-anthropic.us-east-1.api.aws');
  });
});

describe('provider endpoints', () => {
  it('calls Anthropic at the first-party messages endpoint', () => {
    expect(ANTHROPIC_API_URL).toBe('https://api.anthropic.com/v1/messages');
  });

  it('allow-lists the host the Anthropic URL actually points at', () => {
    expect(ANTHROPIC_API_URL).toContain(`https://${ ANTHROPIC_PROXY_DOMAIN }/`);
  });

  it('puts the Claude-on-AWS region in the hostname and nowhere else', () => {
    expect(CLAUDE_AWS_API_URL('us-east-1'))
      .toBe('https://aws-external-anthropic.us-east-1.api.aws/v1/messages');
    expect(CLAUDE_AWS_API_URL('eu-central-1'))
      .toBe('https://aws-external-anthropic.eu-central-1.api.aws/v1/messages');
  });

  it('is not Bedrock', () => {
    // Easy to conflate, and a Bedrock key fails here in a way that reads like
    // a bad key rather than the wrong product.
    expect(CLAUDE_AWS_API_URL('us-east-1')).not.toContain('bedrock');
  });

  it('keeps the two anthropic-version values apart', () => {
    expect(ANTHROPIC_VERSION).toBe('2023-06-01');
    expect(VERTEX_ANTHROPIC_VERSION).toBe('vertex-2023-10-16');
    expect(VERTEX_ANTHROPIC_VERSION).not.toBe(ANTHROPIC_VERSION);
  });
});

describe('GCP token settings', () => {
  it('exchanges at Google\'s OAuth2 endpoint with the cloud-platform scope', () => {
    expect(GCP_TOKEN_URL).toBe('https://oauth2.googleapis.com/token');
    expect(GCP_SCOPE).toBe('https://www.googleapis.com/auth/cloud-platform');
  });

  it('refreshes well before expiry, but still uses most of the token', () => {
    expect(GCP_TOKEN_LIFETIME).toBeLessThanOrEqual(3600);
    expect(GCP_TOKEN_SKEW).toBeGreaterThan(0);
    expect(GCP_TOKEN_SKEW).toBeLessThan(GCP_TOKEN_LIFETIME);
  });
});

describe('default regions', () => {
  it('uses the global Vertex location, which has the widest model availability', () => {
    expect(DEFAULT_VERTEX_REGION).toBe('global');
    expect(vertexHost(DEFAULT_VERTEX_REGION)).toBe('aiplatform.googleapis.com');
  });

  it('offers a real AWS region as the placeholder', () => {
    expect(DEFAULT_CLAUDE_AWS_REGION).toMatch(/^[a-z]{2}-[a-z]+-\d$/);
  });
});
