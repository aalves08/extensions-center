/**
 * gzip, for documents that have to fit inside a ConfigMap.
 *
 * Built on `CompressionStream`, which every browser Rancher supports has had
 * for years, so this costs no dependency and no bundled copy of an inflate
 * implementation.
 *
 * It exists for one reason: etcd rejects objects over ~1MiB, and the Security
 * document comes to roughly 870KB of JSON across the estate — close enough to
 * the ceiling that storing it plainly would be waiting for the first repo that
 * tips it over. Compressed it is around 40KB, which is not a close call. The
 * data is almost all repeated advisory text and package names, so the ratio is
 * ~20x rather than the ~3x generic prose gets.
 */

/** Base64 is built in slices: `fromCharCode` takes arguments, not an array. */
const CHUNK = 0x8000;

/**
 * Whether this browser can compress at all.
 *
 * Checked rather than assumed, because the failure mode matters: a caller that
 * cannot compress must fall back to not persisting, which is merely slow. The
 * alternative — writing an uncompressed document — is an object the API server
 * may refuse, several hundred KB at a time.
 */
export function isCompressionSupported(): boolean {
  return typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';
}

/** Drain a stream to one byte array. */
async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();

  for (;;) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    chunks.push(value);
  }

  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let at = 0;

  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }

  return out;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';

  // Sliced rather than spread in one call. `String.fromCharCode(...bytes)` on
  // a 40KB array is tens of thousands of arguments, which overflows the call
  // stack in every engine — and does so only once the data grows, which is the
  // worst time to find out.
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }

  return btoa(binary);
}

function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}

/** Compress text to base64, ready to store as a ConfigMap value. */
export async function gzipToBase64(text: string): Promise<string> {
  const input = new Blob([text]).stream();
  const compressed = input.pipeThrough(new CompressionStream('gzip'));

  return toBase64(await readAll(compressed));
}

/** The inverse. Throws on anything that is not valid base64 of valid gzip. */
export async function gunzipFromBase64(b64: string): Promise<string> {
  const input = new Blob([fromBase64(b64)]).stream();
  const expanded = input.pipeThrough(new DecompressionStream('gzip'));

  return new TextDecoder().decode(await readAll(expanded));
}
