/**
 * Service-account authentication for Google Cloud, done in the browser.
 *
 * The canonical way to do this is `google-auth-library`, which is Node-only —
 * it reaches for `crypto`, `fs` and `child_process`, and its own published
 * support matrix lists Node, Deno, Bun and edge runtimes but not browsers. The
 * usual workaround is to stand a small server in front of it.
 *
 * None of that is necessary. The flow it implements is two steps: sign a JWT
 * asserting "this service account wants this scope", then POST it to Google's
 * token endpoint in exchange for an access token. The signature is RS256, and
 * `crypto.subtle` does RS256 natively — `importKey('pkcs8', …)` reads the
 * PEM out of the service-account file directly, which is the only part that
 * looked like it needed a library. What is left is this file.
 *
 * Everything here is pure apart from `signAssertion`, which needs WebCrypto.
 */

/** The three fields of a service-account JSON that actually get used. */
export interface ServiceAccount {
  client_email: string;
  private_key: string;
  /** Google always writes `https://oauth2.googleapis.com/token`, but honour it */
  token_uri?: string;
}

/**
 * The other file Google hands out: what `gcloud auth application-default
 * login` writes to `~/.config/gcloud/application_default_credentials.json`.
 *
 * There is no key to sign with here. It is a long-lived refresh token for a
 * *person*, redeemed with the plain `refresh_token` grant instead of the
 * JWT-bearer one. Same endpoint, same form encoding, so it is equally
 * CORS-simple — the only difference is the body.
 */
export interface AuthorizedUser {
  client_id: string;
  client_secret: string;
  refresh_token: string;
  /** Absent in the files gcloud writes, which rely on the default endpoint */
  token_uri?: string;
}

/** Either credential file, tagged so callers can pick the right grant. */
export type GcpCredential =
  | ({ kind: 'service_account' } & ServiceAccount)
  | ({ kind: 'authorized_user' } & AuthorizedUser);

/** Base64url: standard base64 with the URL alphabet and no padding. */
export function base64Url(input: ArrayBuffer | Uint8Array | string): string {
  let binary: string;

  if (typeof input === 'string') {
    // `btoa` is Latin-1 only, so a multi-byte character in the claim set — a
    // project id is ASCII but an error path might not be — has to be encoded
    // to bytes first rather than handed over as a string.
    binary = String.fromCharCode(...new TextEncoder().encode(input));
  } else {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);

    // Chunked because `String.fromCharCode(...bytes)` on a 256-byte signature
    // is fine but the same call on a large buffer blows the argument limit.
    const parts: string[] = [];

    for (let i = 0; i < bytes.length; i += 0x8000) {
      parts.push(String.fromCharCode(...bytes.subarray(i, i + 0x8000)));
    }

    binary = parts.join('');
  }

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Pull the DER bytes out of a PEM block.
 *
 * Service-account keys arrive as PKCS#8 (`BEGIN PRIVATE KEY`). The `\n`
 * escapes inside the JSON are real newlines once parsed, but a key pasted by
 * hand often still carries them literally, so both spellings are accepted.
 */
export function pemToDer(pem: string): ArrayBuffer {
  const body = pem
    .replace(/\\n/g, '\n')
    .replace(/-----BEGIN [^-]+-----/, '')
    .replace(/-----END [^-]+-----/, '')
    .replace(/\s+/g, '');

  if (!body) {
    throw new Error('Service account private key is empty.');
  }

  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes.buffer;
}

/**
 * Read and check a service-account JSON blob.
 *
 * Checked here rather than at the first API call because every mistake in this
 * field — pasting the wrong file, pasting an OAuth client, truncating the key
 * — otherwise surfaces as an opaque `invalid_grant` from Google much later.
 */
export function parseServiceAccount(json: string | null | undefined): ServiceAccount {
  if (!json?.trim()) {
    throw new Error('No Vertex service account configured.');
  }

  let parsed: Record<string, unknown>;

  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('Vertex service account is not valid JSON. Paste the key file exactly as downloaded.');
  }

  if (parsed.type && parsed.type !== 'service_account') {
    throw new Error(`Expected a service account key, got "${ String(parsed.type) }".`);
  }

  const email = typeof parsed.client_email === 'string' ? parsed.client_email : '';
  const key = typeof parsed.private_key === 'string' ? parsed.private_key : '';

  if (!email) {
    throw new Error('Vertex service account has no client_email.');
  }

  if (!key) {
    throw new Error('Vertex service account has no private_key.');
  }

  if (!/-----BEGIN [^-]*PRIVATE KEY-----/.test(key)) {
    throw new Error('Vertex service account private_key is not a PEM block.');
  }

  return {
    client_email: email,
    private_key:  key,
    token_uri:    typeof parsed.token_uri === 'string' ? parsed.token_uri : undefined,
  };
}

/** Read and check an application-default-credentials blob. */
function parseAuthorizedUser(parsed: Record<string, unknown>): AuthorizedUser {
  const field = (name: string): string => {
    const value = typeof parsed[name] === 'string' ? (parsed[name] as string).trim() : '';

    if (!value) {
      throw new Error(`Vertex user credentials have no ${ name }.`);
    }

    return value;
  };

  return {
    client_id:     field('client_id'),
    client_secret: field('client_secret'),
    refresh_token: field('refresh_token'),
    token_uri:     typeof parsed.token_uri === 'string' ? parsed.token_uri : undefined,
  };
}

/**
 * Read whichever of the two credential files was pasted.
 *
 * Dispatches on `type`. A file with no `type` at all is treated as a service
 * account, which is what the service-account reader has always done — the
 * field is informational there, the private key is the real discriminator.
 */
export function parseGcpCredential(json: string | null | undefined): GcpCredential {
  if (!json?.trim()) {
    throw new Error('No Vertex service account configured.');
  }

  let parsed: Record<string, unknown>;

  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('Vertex service account is not valid JSON. Paste the key file exactly as downloaded.');
  }

  if (parsed.type === 'authorized_user') {
    return { kind: 'authorized_user', ...parseAuthorizedUser(parsed) };
  }

  if (parsed.type && parsed.type !== 'service_account') {
    throw new Error(`Expected a service account or user credentials key, got "${ String(parsed.type) }".`);
  }

  return { kind: 'service_account', ...parseServiceAccount(json) };
}

/**
 * A stable, non-reversible id for a credential, used to key the token cache.
 *
 * A service account has an email, which is an identifier rather than a secret
 * and can be used as-is. A user credential has nothing comparable: its
 * `client_id` is the gcloud CLI's own, identical for every person on earth who
 * ran `gcloud auth application-default login`, so keying on it would hand one
 * pasted file the token minted for another. The refresh token *is* unique, but
 * it is the secret itself and must not sit in a Map key — so it goes through
 * SHA-256 first. Truncated to 96 bits, which is far past collision territory
 * for a map that holds one or two entries.
 */
export async function credentialFingerprint(credential: GcpCredential): Promise<string> {
  if (credential.kind === 'service_account') {
    return credential.client_email;
  }

  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(credential.refresh_token),
  );

  return `user:${ base64Url(digest).slice(0, 16) }`;
}

/** The JWT claim set Google's service-account flow expects. */
export interface JwtClaims {
  iss: string;
  scope: string;
  aud: string;
  iat: number;
  exp: number;
}

/**
 * Claims asserting that `account` wants `scope`, valid from now.
 *
 * `nowSeconds` is a parameter rather than a `Date.now()` call so the claim set
 * can be asserted exactly in a test.
 */
export function buildClaims(
  account: ServiceAccount,
  scope: string,
  audience: string,
  nowSeconds: number,
  lifetimeSeconds: number
): JwtClaims {
  return {
    iss: account.client_email,
    scope,
    aud: audience,
    iat: nowSeconds,
    exp: nowSeconds + lifetimeSeconds,
  };
}

/** `base64url(header).base64url(claims)` — the bytes that get signed. */
export function signingInput(claims: JwtClaims): string {
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));

  return `${ header }.${ base64Url(JSON.stringify(claims)) }`;
}

/**
 * Sign the claim set with the account's private key, returning a full JWT.
 *
 * This is the entire job `google-auth-library` was needed for.
 */
export async function signAssertion(account: ServiceAccount, claims: JwtClaims): Promise<string> {
  const input = signingInput(claims);

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToDer(account.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(input),
  );

  return `${ input }.${ base64Url(signature) }`;
}

/**
 * The form body for the token exchange.
 *
 * `application/x-www-form-urlencoded` is not incidental. It is one of the three
 * content types CORS treats as safelisted, which makes the POST a *simple*
 * request: no preflight, so nothing for Google to refuse. Sending the same
 * exchange as JSON would trigger a preflight and fail.
 */
export function tokenRequestBody(assertion: string): string {
  return new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
  }).toString();
}

/**
 * The same exchange for a user credential — nothing is signed, the refresh
 * token is presented directly.
 *
 * No `scope` is sent. The refresh grant cannot widen what the user consented
 * to when they ran `gcloud auth application-default login`, and asking for a
 * scope that is not already on the token is an error rather than a narrowing,
 * so the token simply inherits the scopes it was granted — which for the ADC
 * login includes `cloud-platform`.
 */
export function refreshTokenRequestBody(credential: AuthorizedUser): string {
  return new URLSearchParams({
    grant_type:    'refresh_token',
    client_id:     credential.client_id,
    client_secret: credential.client_secret,
    refresh_token: credential.refresh_token,
  }).toString();
}
