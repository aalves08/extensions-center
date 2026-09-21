/**
 * Minimal AWS Signature Version 4 signer for a single POST request.
 *
 * Bedrock has no static-token auth: every call has to be signed. Rather than
 * pull in the AWS SDK (which would add megabytes to an extension bundle for one
 * request shape), this signs with the Web Crypto API the browser already has.
 *
 * Scope is deliberately narrow — a JSON POST with no query string, which is all
 * `InvokeModel` needs. It is not a general-purpose signer.
 *
 * Reference: https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_sigv4-signing-elements.html
 */

const ALGORITHM = 'AWS4-HMAC-SHA256';

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(message: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(message));

  return toHex(digest);
}

async function hmac(key: ArrayBuffer | Uint8Array, message: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  return crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(message));
}

/**
 * `20260918T101942Z` and `20260918` — SigV4 wants both forms of the same
 * instant, and they must agree or the signature is rejected.
 */
function timestamps(now: Date): { amzDate: string; dateStamp: string } {
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');

  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

export interface SigV4Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  /** Only present for temporary (STS) credentials */
  sessionToken?: string | null;
  region: string;
}

export interface SigV4Request {
  /** Full URL, no query string */
  url: string;
  /** AWS service name, e.g. `bedrock` */
  service: string;
  body: string;
}

/**
 * Returns the headers to send with the request, including `Authorization`.
 *
 * `host` is signed but deliberately not returned: browsers forbid setting it,
 * and they will send the correct one themselves.
 */
export async function signRequest(
  {
    accessKeyId, secretAccessKey, sessionToken, region
  }: SigV4Credentials,
  { url, service, body }: SigV4Request,
): Promise<Record<string, string>> {
  const { host, pathname } = new URL(url);
  const { amzDate, dateStamp } = timestamps(new Date());
  const payloadHash = await sha256Hex(body);

  // Signed headers must be sorted by lowercase name, and the canonical request
  // has to list exactly the headers we end up sending.
  const headers: Record<string, string> = {
    'content-type':         'application/json',
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date':           amzDate,
  };

  if (sessionToken) {
    headers['x-amz-security-token'] = sessionToken;
  }

  const sortedNames = Object.keys(headers).sort();
  const canonicalHeaders = sortedNames.map((n) => `${ n }:${ headers[n].trim() }\n`).join('');
  const signedHeaders = sortedNames.join(';');

  // The path is already URI-encoded in the URL we were handed; Bedrock model
  // ids contain a `:` which must stay encoded as-is for the signature to match.
  const canonicalRequest = [
    'POST', pathname, '', canonicalHeaders, signedHeaders, payloadHash,
  ].join('\n');

  const credentialScope = `${ dateStamp }/${ region }/${ service }/aws4_request`;
  const stringToSign = [
    ALGORITHM, amzDate, credentialScope, await sha256Hex(canonicalRequest),
  ].join('\n');

  // Derive the signing key: one HMAC per scope element, chained.
  let signingKey: ArrayBuffer | Uint8Array = new TextEncoder().encode(`AWS4${ secretAccessKey }`);

  for (const part of [dateStamp, region, service, 'aws4_request']) {
    signingKey = await hmac(signingKey, part);
  }

  const signature = toHex(await hmac(signingKey, stringToSign));

  const authorization = `${ ALGORITHM } Credential=${ accessKeyId }/${ credentialScope }, ` +
    `SignedHeaders=${ signedHeaders }, Signature=${ signature }`;

  // `host` is dropped: the browser sets it and rejects attempts to override it.
  const { host: _host, ...sendable } = headers;

  return { ...sendable, Authorization: authorization };
}
