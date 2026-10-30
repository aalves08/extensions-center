import { GCP_SCOPE, GCP_TOKEN_LIFETIME, GCP_TOKEN_SKEW, GCP_TOKEN_URL } from '../config/constants';
import { ExtensionConfig } from '../types/common';
import {
  buildClaims,
  credentialFingerprint,
  GcpCredential,
  parseGcpCredential,
  refreshTokenRequestBody,
  signAssertion,
  tokenRequestBody
} from '../utils/gcpJwt';

/**
 * Access tokens for Vertex, minted in the browser from a Google credential.
 *
 * Two steps, both of which run client-side: build a grant (`utils/gcpJwt`),
 * then trade it at Google's token endpoint. The exchange is a form-encoded
 * POST with no custom headers, which CORS classes as a simple request — no
 * preflight is sent, so there is nothing for Google to reject, and the
 * response carries `access-control-allow-origin`. That is specific to this
 * endpoint: the `rawPredict` call the token is *for* does get preflighted and
 * does get refused, which is why only that half goes through Rancher's proxy.
 *
 * Either credential file works. A service-account key signs a JWT assertion; a
 * user credential from `gcloud auth application-default login` presents its
 * refresh token. Both land on the same endpoint with the same encoding and
 * come back with the same response shape, so only the body differs.
 *
 * Tokens last an hour and a classification run makes a call every few seconds,
 * so they are cached at module scope and shared across pages. Cached by
 * credential fingerprint plus scope, so switching credentials in Settings
 * cannot hand the new one the old one's token.
 */

interface CachedToken {
  token: string;
  /** Epoch ms, already reduced by `GCP_TOKEN_SKEW` */
  expiresAt: number;
}

/** Shape of a successful token response; the error shape is handled inline. */
interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

const cache = new Map<string, CachedToken>();

/** In-flight exchanges, so a burst of calls mints one token rather than ten. */
const inFlight = new Map<string, Promise<string>>();

/** Drop every cached token. Called when credentials are saved or cleared. */
export function clearVertexTokenCache(): void {
  cache.clear();
  inFlight.clear();
}

/** The form body for whichever grant this credential uses. */
async function grantBody(credential: GcpCredential, audience: string): Promise<string> {
  if (credential.kind === 'authorized_user') {
    return refreshTokenRequestBody(credential);
  }

  const now = Math.floor(Date.now() / 1000);
  const claims = buildClaims(credential, GCP_SCOPE, audience, now, GCP_TOKEN_LIFETIME);

  return tokenRequestBody(await signAssertion(credential, claims));
}

async function exchange(key: string, credential: GcpCredential): Promise<string> {
  const audience = credential.token_uri || GCP_TOKEN_URL;
  const body = await grantBody(credential, audience);

  const res = await fetch(audience, {
    method:  'POST',
    // Deliberately the only header. Adding anything else — including an
    // explicit `accept` — makes the request non-simple and triggers the
    // preflight this flow depends on not having.
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });

  let parsed: TokenResponse;

  try {
    parsed = await res.json();
  } catch {
    throw new Error(`Google token endpoint returned ${ res.status } with an unreadable body.`);
  }

  if (!res.ok || !parsed.access_token) {
    // `invalid_grant` here almost always means the clock is off or the key has
    // been revoked; `unauthorized_client` means domain-wide delegation. Both
    // are worth passing through verbatim rather than flattening.
    const detail = parsed.error_description || parsed.error || `HTTP ${ res.status }`;

    throw new Error(`Google token exchange failed: ${ detail }`);
  }

  const lifetime = parsed.expires_in || GCP_TOKEN_LIFETIME;

  cache.set(key, {
    token:     parsed.access_token,
    expiresAt: Date.now() + Math.max(lifetime - GCP_TOKEN_SKEW, 0) * 1000,
  });

  return parsed.access_token;
}

/**
 * A valid access token for the configured credential.
 *
 * Mints one on first use and reuses it until it is close to expiring.
 */
export async function vertexAccessToken(cfg: ExtensionConfig): Promise<string> {
  const json = cfg.vertexServiceAccount;

  if (!json?.trim()) {
    throw new Error('No Vertex service account configured.');
  }

  // Parsed up front partly to fail on a bad paste before any network call, and
  // partly to key the cache by credential rather than by the whole JSON blob,
  // which would be a credential sitting in a Map key. Test connection runs on
  // unsaved form values while the cache is only cleared on save, so the key has
  // to distinguish two files the user pastes one after the other.
  const credential = parseGcpCredential(json);
  const key = `${ await credentialFingerprint(credential) }|${ GCP_SCOPE }`;
  const hit = cache.get(key);

  if (hit && hit.expiresAt > Date.now()) {
    return hit.token;
  }

  const pending = inFlight.get(key);

  if (pending) {
    return pending;
  }

  const promise = exchange(key, credential).finally(() => inFlight.delete(key));

  inFlight.set(key, promise);

  return promise;
}
