import { gunzipFromBase64, gzipToBase64, isCompressionSupported } from '../gzip';

/** The gzip magic number, as the first two base64-decoded bytes. */
function firstBytes(b64: string, count: number): number[] {
  return [...atob(b64).slice(0, count)].map((c) => c.charCodeAt(0));
}

describe('isCompressionSupported', () => {
  it('is true where both halves of the pair exist', () => {
    expect(isCompressionSupported()).toBe(true);
  });

  it('is false when the browser has neither', () => {
    // The caller has to be able to fall back to not persisting, which is only
    // slow. Writing the document uncompressed is an object the API server may
    // refuse, several hundred KB at a time.
    const compression = globalThis.CompressionStream;

    delete (globalThis as { CompressionStream?: unknown }).CompressionStream;

    try {
      expect(isCompressionSupported()).toBe(false);
    } finally {
      globalThis.CompressionStream = compression;
    }
  });

  it('is false when only one half exists', () => {
    const decompression = globalThis.DecompressionStream;

    delete (globalThis as { DecompressionStream?: unknown }).DecompressionStream;

    try {
      expect(isCompressionSupported()).toBe(false);
    } finally {
      globalThis.DecompressionStream = decompression;
    }
  });
});

describe('gzipToBase64 / gunzipFromBase64', () => {
  it('round-trips text', async() => {
    const text = 'the quick brown fox';

    expect(await gunzipFromBase64(await gzipToBase64(text))).toBe(text);
  });

  it('round-trips a document of the shape this exists for', async() => {
    // Mostly repeated advisory text and package names, which is why the ratio
    // is ~20x rather than the ~3x generic prose gets.
    const doc = JSON.stringify({
      version: 1,
      repos:   Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`repo-${ i }`, {
        repo:   `rancher/repo-${ i }`,
        groups: Array.from({ length: 20 }, (_, j) => ({
          name:       'lodash',
          ecosystem:  'npm',
          advisories: [{
            ghsa: `GHSA-${ j }`, summary: 'Prototype pollution in lodash', severity: 'high'
          }],
        })),
      }])),
    });

    const packed = await gzipToBase64(doc);

    expect(await gunzipFromBase64(packed)).toBe(doc);
    expect(packed.length).toBeLessThan(doc.length / 10);
  });

  it('produces a real gzip stream, not a raw deflate one', async() => {
    // `1f 8b 08` is the gzip header; a consumer outside this file has to be
    // able to read it.
    expect(firstBytes(await gzipToBase64('anything'), 3)).toEqual([0x1f, 0x8b, 0x08]);
  });

  it('emits base64 and nothing else', async() => {
    expect(await gzipToBase64('a'.repeat(1000))).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });

  it('round-trips an empty string', async() => {
    expect(await gunzipFromBase64(await gzipToBase64(''))).toBe('');
  });

  it('round-trips non-ASCII text without mangling it', async() => {
    const text = 'shell’s own screens — ü, 中文, 🎉';

    expect(await gunzipFromBase64(await gzipToBase64(text))).toBe(text);
  });

  it('handles a payload well past the base64 chunking threshold', async() => {
    // `String.fromCharCode(...bytes)` in one call on this many arguments
    // overflows the stack in every engine, and only once the data grows.
    const text = Array.from({ length: 50_000 }, (_, i) => `line ${ i } of mostly unique text ${ Math.sin(i) }`).join('\n');
    const packed = await gzipToBase64(text);

    expect(atob(packed).length).toBeGreaterThan(0x8000);
    expect(await gunzipFromBase64(packed)).toBe(text);
  });

  it('refuses something that is not base64', async() => {
    await expect(gunzipFromBase64('not base64 at all!!')).rejects.toThrow();
  });

  it('refuses valid base64 that is not gzip', async() => {
    await expect(gunzipFromBase64(btoa('plain text, never compressed'))).rejects.toThrow();
  });

  it('refuses a truncated stream rather than returning half a document', async() => {
    const packed = await gzipToBase64('a'.repeat(5000));
    const bytes = atob(packed);
    const truncated = btoa(bytes.slice(0, Math.floor(bytes.length / 2)));

    await expect(gunzipFromBase64(truncated)).rejects.toThrow();
  });
});
