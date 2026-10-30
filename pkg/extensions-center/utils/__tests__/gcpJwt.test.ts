import {
  base64Url,
  buildClaims,
  parseServiceAccount,
  pemToDer,
  signAssertion,
  signingInput,
  tokenRequestBody,
  ServiceAccount
} from '../gcpJwt';

/** Decode a base64url segment back to text, the way a JWT consumer would. */
function decodeSegment(segment: string): string {
  const padded = segment.replace(/-/g, '+').replace(/_/g, '/');

  return new TextDecoder().decode(
    Uint8Array.from(atob(padded + '=='.slice(0, (4 - (padded.length % 4)) % 4)), (c) => c.charCodeAt(0))
  );
}

/** Wrap DER bytes in the PEM envelope a service-account file carries. */
function toPem(der: ArrayBuffer): string {
  const b64 = btoa(String.fromCharCode(...new Uint8Array(der)));
  const lines = b64.match(/.{1,64}/g) || [];

  return `-----BEGIN PRIVATE KEY-----\n${ lines.join('\n') }\n-----END PRIVATE KEY-----\n`;
}

/**
 * A real RSA key, generated per run rather than checked in.
 *
 * Generated rather than hard-coded so the repo never carries something shaped
 * like a private key, and so the signature can be checked against the matching
 * public half instead of a recorded string.
 */
async function generateAccount(): Promise<{ account: ServiceAccount; publicKey: CryptoKey }> {
  const pair = await crypto.subtle.generateKey(
    {
      name:           'RSASSA-PKCS1-v1_5',
      modulusLength:  2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash:           'SHA-256',
    },
    true,
    ['sign', 'verify'],
  ) as { privateKey: CryptoKey; publicKey: CryptoKey };

  const der = await crypto.subtle.exportKey('pkcs8', pair.privateKey);

  return {
    account: {
      client_email: 'robot@example-project.iam.gserviceaccount.com',
      private_key:  toPem(der),
    },
    publicKey: pair.publicKey,
  };
}

describe('base64Url', () => {
  it('uses the URL alphabet and drops the padding', () => {
    // `>>>` is 0x3e3e3e, which standard base64 writes as `Pj4+` — the `+` is
    // exactly what a JWT segment may not contain.
    expect(base64Url('>>>')).toBe('Pj4-');
    expect(base64Url('???')).toBe('Pz8_');
    expect(base64Url('a')).toBe('YQ');
    expect(base64Url('ab')).toBe('YWI');
    expect(base64Url('abc')).toBe('YWJj');
  });

  it('encodes a string as UTF-8 rather than handing it to btoa raw', () => {
    // `btoa('é')` throws, so this is the difference between working and not.
    expect(base64Url('é')).toBe('w6k');
    expect(decodeSegment(base64Url('ok — fine'))).toBe('ok — fine');
  });

  it('accepts a Uint8Array and an ArrayBuffer alike', () => {
    const bytes = new Uint8Array([0xff, 0xfe, 0xfd]);

    expect(base64Url(bytes)).toBe('__79');
    expect(base64Url(bytes.buffer)).toBe('__79');
  });

  it('handles a buffer past the chunking threshold', () => {
    // 0x8000 is the chunk size; `String.fromCharCode(...bytes)` on one pass
    // over this many arguments is what the chunking exists to avoid.
    const big = new Uint8Array(0x8000 * 2 + 7).fill(0x41);

    expect(base64Url(big)).toBe(base64Url(new Uint8Array(big).buffer));
    expect(decodeSegment(base64Url(big))).toBe('A'.repeat(big.length));
  });

  it('returns an empty string for empty input', () => {
    expect(base64Url('')).toBe('');
    expect(base64Url(new Uint8Array(0))).toBe('');
  });
});

describe('pemToDer', () => {
  const der = new Uint8Array([1, 2, 3, 4, 5]);
  const b64 = btoa(String.fromCharCode(...der));

  it('strips the envelope and the newlines', () => {
    const pem = `-----BEGIN PRIVATE KEY-----\n${ b64 }\n-----END PRIVATE KEY-----\n`;

    expect(new Uint8Array(pemToDer(pem))).toEqual(der);
  });

  it('accepts literal backslash-n escapes, as a hand-pasted key carries', () => {
    const pem = `-----BEGIN PRIVATE KEY-----\\n${ b64 }\\n-----END PRIVATE KEY-----\\n`;

    expect(new Uint8Array(pemToDer(pem))).toEqual(der);
  });

  it('accepts other key labels, not just PRIVATE KEY', () => {
    const pem = `-----BEGIN RSA PRIVATE KEY-----\n${ b64 }\n-----END RSA PRIVATE KEY-----`;

    expect(new Uint8Array(pemToDer(pem))).toEqual(der);
  });

  it('throws when the envelope contains nothing', () => {
    expect(() => pemToDer('-----BEGIN PRIVATE KEY-----\n\n-----END PRIVATE KEY-----'))
      .toThrow('Service account private key is empty.');
    expect(() => pemToDer('   ')).toThrow('Service account private key is empty.');
  });
});

describe('parseServiceAccount', () => {
  const valid = {
    type:         'service_account',
    client_email: 'robot@p.iam.gserviceaccount.com',
    private_key:  '-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n',
    token_uri:    'https://oauth2.googleapis.com/token',
  };

  it('returns only the three fields that get used', () => {
    expect(parseServiceAccount(JSON.stringify({
      ...valid, project_id: 'p', private_key_id: 'k'
    }))).toEqual({
      client_email: valid.client_email,
      private_key:  valid.private_key,
      token_uri:    valid.token_uri,
    });
  });

  /** `valid` minus one key — written this way because the field names are snake_case. */
  function without(key: keyof typeof valid): string {
    const copy: Record<string, unknown> = { ...valid };

    delete copy[key];

    return JSON.stringify(copy);
  }

  it('leaves token_uri undefined when the file omits it', () => {
    expect(parseServiceAccount(without('token_uri')).token_uri).toBeUndefined();
  });

  it('accepts a file with no type field at all', () => {
    expect(parseServiceAccount(without('type')).client_email).toBe(valid.client_email);
  });

  it.each([
    [null, 'No Vertex service account configured.'],
    [undefined, 'No Vertex service account configured.'],
    ['', 'No Vertex service account configured.'],
    ['   ', 'No Vertex service account configured.'],
  ])('rejects %p as unconfigured', (input, message) => {
    expect(() => parseServiceAccount(input as string | null)).toThrow(message);
  });

  it('rejects something that is not JSON', () => {
    expect(() => parseServiceAccount('not json at all'))
      .toThrow('Vertex service account is not valid JSON. Paste the key file exactly as downloaded.');
  });

  it('rejects the wrong kind of credential file by name', () => {
    // An OAuth client id file parses fine and has none of the fields we want,
    // so without this the user gets "no client_email" rather than "wrong file".
    expect(() => parseServiceAccount(JSON.stringify({ type: 'authorized_user' })))
      .toThrow('Expected a service account key, got "authorized_user".');
  });

  it('names the missing field rather than failing later at Google', () => {
    expect(() => parseServiceAccount(JSON.stringify({ ...valid, client_email: '' })))
      .toThrow('Vertex service account has no client_email.');
    expect(() => parseServiceAccount(JSON.stringify({ ...valid, private_key: '' })))
      .toThrow('Vertex service account has no private_key.');
    expect(() => parseServiceAccount(JSON.stringify({ ...valid, private_key: 'AAAA' })))
      .toThrow('Vertex service account private_key is not a PEM block.');
  });

  it('ignores fields of the wrong type instead of trusting them', () => {
    expect(() => parseServiceAccount(JSON.stringify({ ...valid, client_email: 42 })))
      .toThrow('Vertex service account has no client_email.');
  });
});

describe('buildClaims', () => {
  const account: ServiceAccount = { client_email: 'robot@p.iam.gserviceaccount.com', private_key: 'x' };

  it('asserts the account, the scope and the audience, expiring after the lifetime', () => {
    expect(buildClaims(account, 'scope-a', 'https://oauth2.googleapis.com/token', 1_700_000_000, 3600)).toEqual({
      iss:   'robot@p.iam.gserviceaccount.com',
      scope: 'scope-a',
      aud:   'https://oauth2.googleapis.com/token',
      iat:   1_700_000_000,
      exp:   1_700_003_600,
    });
  });
});

describe('signingInput', () => {
  it('is header.claims, both base64url, with an RS256 header', () => {
    const claims = buildClaims(
      { client_email: 'robot@p.iam.gserviceaccount.com', private_key: 'x' },
      'scope-a',
      'https://oauth2.googleapis.com/token',
      1_700_000_000,
      3600,
    );

    const [header, payload, ...rest] = signingInput(claims).split('.');

    expect(rest).toHaveLength(0);
    expect(JSON.parse(decodeSegment(header))).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(JSON.parse(decodeSegment(payload))).toEqual(claims);
  });
});

describe('signAssertion', () => {
  it('produces a three-part JWT whose signature verifies against the public key', async() => {
    const { account, publicKey } = await generateAccount();
    const claims = buildClaims(account, 'scope-a', 'https://oauth2.googleapis.com/token', 1_700_000_000, 3600);

    const jwt = await signAssertion(account, claims);
    const parts = jwt.split('.');

    expect(parts).toHaveLength(3);
    expect(JSON.parse(decodeSegment(parts[1]))).toEqual(claims);

    const signature = Uint8Array.from(
      atob(parts[2].replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (parts[2].length % 4)) % 4)),
      (c) => c.charCodeAt(0),
    );

    const ok = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      publicKey,
      signature,
      new TextEncoder().encode(`${ parts[0] }.${ parts[1] }`),
    );

    expect(ok).toBe(true);
  });

  it('signs with a key still carrying literal \\n escapes', async() => {
    const { account, publicKey } = await generateAccount();
    const escaped = { ...account, private_key: account.private_key.replace(/\n/g, '\\n') };
    const claims = buildClaims(escaped, 'scope-a', 'https://oauth2.googleapis.com/token', 1, 3600);

    const [header, payload, sig] = (await signAssertion(escaped, claims)).split('.');

    const signature = Uint8Array.from(
      atob(sig.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (sig.length % 4)) % 4)),
      (c) => c.charCodeAt(0),
    );

    await expect(crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      publicKey,
      signature,
      new TextEncoder().encode(`${ header }.${ payload }`),
    )).resolves.toBe(true);
  });

  it('rejects a key that is not usable rather than signing with nothing', async() => {
    await expect(signAssertion(
      { client_email: 'robot@p.iam.gserviceaccount.com', private_key: '-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----' },
      buildClaims({ client_email: 'a', private_key: 'x' }, 's', 'a', 1, 2),
    )).rejects.toThrow();
  });
});

describe('tokenRequestBody', () => {
  it('is form-encoded with the JWT bearer grant', () => {
    const body = tokenRequestBody('header.payload.sig');
    const parsed = new URLSearchParams(body);

    expect(parsed.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    expect(parsed.get('assertion')).toBe('header.payload.sig');
  });

  it('escapes the grant type, so the body stays a safelisted content type', () => {
    // If this ever came out as raw `:` characters it would still work, but the
    // point of the form encoding is that CORS treats the POST as simple — the
    // whole reason this flow needs no preflight.
    expect(tokenRequestBody('a.b.c')).toBe(
      'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=a.b.c'
    );
  });
});
