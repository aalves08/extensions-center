import { DEFAULT_LLM_PROVIDER, GCP_SCOPE, GCP_TOKEN_LIFETIME } from '../../config/constants';
import { ExtensionConfig } from '../../types/common';
import { clearVertexTokenCache, vertexAccessToken } from '../useVertexAuth';

/**
 * Only the signing is mocked.
 *
 * `parseServiceAccount` stays real because the cache key is built from what it
 * returns, so stubbing it would stop these tests saying anything about whether
 * two different service accounts can share a token. Signing is replaced only
 * to keep a 2048-bit RSA keygen out of every case.
 */
jest.mock('../../utils/gcpJwt', () => ({
  ...jest.requireActual('../../utils/gcpJwt'),
  signAssertion: jest.fn(async() => 'header.payload.signature'),
}));

const { buildClaims, signAssertion, tokenRequestBody } = jest.requireMock('../../utils/gcpJwt');

const PEM = '-----BEGIN PRIVATE KEY-----\nQUFBQQ==\n-----END PRIVATE KEY-----\n';

function serviceAccount(email = 'robot@p.iam.gserviceaccount.com', extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: 'service_account', client_email: email, private_key: PEM, ...extra
  });
}

function configWith(json: string | null): ExtensionConfig {
  return {
    githubToken:          null,
    llmProvider:          DEFAULT_LLM_PROVIDER,
    llmModel:             null,
    anthropicApiKey:      null,
    vertexServiceAccount: json,
    vertexProjectId:      'my-project',
    vertexRegion:         null,
    claudeAwsApiKey:      null,
    claudeAwsWorkspaceId: null,
    claudeAwsRegion:      null,
  };
}

/** A successful token response, with a lifetime long enough to be cached. */
function tokenOk(token = 'ya29.token', expiresIn = 3600) {
  return {
    ok:   true,
    json: async() => ({ access_token: token, expires_in: expiresIn }),
  };
}

const fetchMock = jest.fn();

beforeEach(() => {
  clearVertexTokenCache();
  fetchMock.mockReset();
  (signAssertion as jest.Mock).mockClear();
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe('vertexAccessToken', () => {
  it('refuses before it signs anything when no account is configured', async() => {
    await expect(vertexAccessToken(configWith(null))).rejects.toThrow('No Vertex service account configured.');
    await expect(vertexAccessToken(configWith('   '))).rejects.toThrow('No Vertex service account configured.');

    expect(signAssertion).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('exchanges a signed assertion for an access token', async() => {
    fetchMock.mockResolvedValue(tokenOk());

    expect(await vertexAccessToken(configWith(serviceAccount()))).toBe('ya29.token');

    const [url, init] = fetchMock.mock.calls[0];

    expect(url).toBe('https://oauth2.googleapis.com/token');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(tokenRequestBody('header.payload.signature'));
  });

  it('sends content-type and nothing else, so the POST stays CORS-simple', () => {
    // Any extra header — even `accept` — makes this non-simple, which triggers
    // the preflight the whole browser-side flow depends on not happening.
    fetchMock.mockResolvedValue(tokenOk());

    return vertexAccessToken(configWith(serviceAccount())).then(() => {
      expect(fetchMock.mock.calls[0][1].headers).toEqual({ 'content-type': 'application/x-www-form-urlencoded' });
    });
  });

  it('claims the cloud-platform scope for the configured account', async() => {
    fetchMock.mockResolvedValue(tokenOk());

    await vertexAccessToken(configWith(serviceAccount('someone@p.iam.gserviceaccount.com')));

    const claims = (signAssertion as jest.Mock).mock.calls[0][1];

    expect(claims).toMatchObject({
      iss:   'someone@p.iam.gserviceaccount.com',
      scope: GCP_SCOPE,
      aud:   'https://oauth2.googleapis.com/token',
    });
    expect(claims.exp - claims.iat).toBe(GCP_TOKEN_LIFETIME);
  });

  it('honours a token_uri from the key file, as both audience and endpoint', async() => {
    fetchMock.mockResolvedValue(tokenOk());

    const json = serviceAccount('robot@p.iam.gserviceaccount.com', { token_uri: 'https://example.test/token' });

    await vertexAccessToken(configWith(json));

    expect(fetchMock.mock.calls[0][0]).toBe('https://example.test/token');
    expect((signAssertion as jest.Mock).mock.calls[0][1].aud).toBe('https://example.test/token');
  });

  it('reuses a cached token rather than minting one per call', async() => {
    fetchMock.mockResolvedValue(tokenOk());

    const cfg = configWith(serviceAccount());

    expect(await vertexAccessToken(cfg)).toBe('ya29.token');
    expect(await vertexAccessToken(cfg)).toBe('ya29.token');
    expect(await vertexAccessToken(cfg)).toBe('ya29.token');

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('collapses a burst of concurrent calls onto one exchange', async() => {
    // A classification run fires requests back to back; without this each one
    // would mint its own token.
    let release: (value: unknown) => void = () => undefined;
    const gate = new Promise((resolve) => {
      release = resolve;
    });

    fetchMock.mockImplementation(async() => {
      await gate;

      return tokenOk();
    });

    const cfg = configWith(serviceAccount());
    const all = Promise.all([vertexAccessToken(cfg), vertexAccessToken(cfg), vertexAccessToken(cfg)]);

    release(undefined);

    expect(await all).toEqual(['ya29.token', 'ya29.token', 'ya29.token']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('lets a later call retry after a failed exchange', async() => {
    // The in-flight entry has to be cleared on rejection too, or one network
    // blip would wedge every subsequent call on the same dead promise.
    fetchMock.mockResolvedValueOnce({ ok: false, json: async() => ({ error: 'invalid_grant' }) });

    const cfg = configWith(serviceAccount());

    await expect(vertexAccessToken(cfg)).rejects.toThrow('invalid_grant');

    fetchMock.mockResolvedValueOnce(tokenOk('ya29.second'));

    expect(await vertexAccessToken(cfg)).toBe('ya29.second');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('re-mints once the token is inside the refresh window', async() => {
    // `expires_in` under the skew means the cached entry is already expired,
    // which is exactly the boundary the skew exists to pull forward.
    fetchMock.mockResolvedValueOnce(tokenOk('ya29.short', 60));
    fetchMock.mockResolvedValueOnce(tokenOk('ya29.fresh'));

    const cfg = configWith(serviceAccount());

    expect(await vertexAccessToken(cfg)).toBe('ya29.short');
    expect(await vertexAccessToken(cfg)).toBe('ya29.fresh');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('never hands one service account another one\'s token', async() => {
    fetchMock.mockResolvedValueOnce(tokenOk('ya29.first'));
    fetchMock.mockResolvedValueOnce(tokenOk('ya29.second'));

    expect(await vertexAccessToken(configWith(serviceAccount('a@p.iam.gserviceaccount.com')))).toBe('ya29.first');
    expect(await vertexAccessToken(configWith(serviceAccount('b@p.iam.gserviceaccount.com')))).toBe('ya29.second');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('caches by account, not by the raw JSON blob', async() => {
    // Same account, file reformatted — still one token.
    fetchMock.mockResolvedValue(tokenOk());

    await vertexAccessToken(configWith(serviceAccount()));
    await vertexAccessToken(configWith(`${ serviceAccount() }\n`));

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('passes Google\'s own explanation through rather than flattening it', async() => {
    fetchMock.mockResolvedValue({
      ok:   false,
      json: async() => ({ error: 'invalid_grant', error_description: 'Invalid JWT: Token must be a short-lived token' }),
    });

    await expect(vertexAccessToken(configWith(serviceAccount())))
      .rejects.toThrow('Google token exchange failed: Invalid JWT: Token must be a short-lived token');
  });

  it('falls back to the error code, then to the status, when there is no description', async() => {
    fetchMock.mockResolvedValueOnce({ ok: false, json: async() => ({ error: 'unauthorized_client' }) });
    await expect(vertexAccessToken(configWith(serviceAccount())))
      .rejects.toThrow('Google token exchange failed: unauthorized_client');

    clearVertexTokenCache();
    fetchMock.mockResolvedValueOnce({
      ok: false, status: 500, json: async() => ({})
    });
    await expect(vertexAccessToken(configWith(serviceAccount())))
      .rejects.toThrow('Google token exchange failed: HTTP 500');
  });

  it('treats a 200 with no access_token as a failure', async() => {
    fetchMock.mockResolvedValue({ ok: true, json: async() => ({ expires_in: 3600 }) });

    await expect(vertexAccessToken(configWith(serviceAccount())))
      .rejects.toThrow('Google token exchange failed');
  });

  it('reports the status when the body cannot be read at all', async() => {
    fetchMock.mockResolvedValue({
      ok:     false,
      status: 502,
      json:   async() => {
        throw new Error('Unexpected token < in JSON');
      },
    });

    await expect(vertexAccessToken(configWith(serviceAccount())))
      .rejects.toThrow('Google token endpoint returned 502 with an unreadable body.');
  });

  it('surfaces a bad key before it reaches the network', async() => {
    // `authorized_user` is a supported type now, so the unsupported one here is
    // an OAuth client — the other file people reach for by mistake.
    await expect(vertexAccessToken(configWith('{"type":"external_account"}')))
      .rejects.toThrow('Expected a service account or user credentials key, got "external_account".');

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('clearVertexTokenCache', () => {
  it('forces the next call to mint a fresh token', async() => {
    fetchMock.mockResolvedValueOnce(tokenOk('ya29.first'));
    fetchMock.mockResolvedValueOnce(tokenOk('ya29.second'));

    const cfg = configWith(serviceAccount());

    expect(await vertexAccessToken(cfg)).toBe('ya29.first');

    // What saving new credentials in Settings does.
    clearVertexTokenCache();

    expect(await vertexAccessToken(cfg)).toBe('ya29.second');
  });
});

describe('the mocked signing boundary', () => {
  it('still builds claims with the real helper', () => {
    // Guards the mock itself: `requireActual` spread means a typo in the
    // factory would otherwise silently stub out more than intended.
    expect(buildClaims({ client_email: 'a@b.c', private_key: 'x' }, 's', 'aud', 10, 20))
      .toEqual({
        iss: 'a@b.c', scope: 's', aud: 'aud', iat: 10, exp: 30
      });
  });
});
