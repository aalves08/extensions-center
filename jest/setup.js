/**
 * Global test setup.
 *
 * The shell installs a `t` on every component instance from its i18n plugin,
 * and this extension's templates call it directly. Rather than mount the real
 * plugin — which wants a store, a locale file and a loaded set of translations
 * — tests get a `t` that echoes the key and its arguments, so an assertion can
 * check *which* string was chosen without pinning the English wording.
 */
const { Blob } = require('node:buffer');
const { webcrypto } = require('node:crypto');
const { CompressionStream, DecompressionStream } = require('node:stream/web');
const { TextDecoder, TextEncoder } = require('node:util');

const { config } = require('@vue/test-utils');

/**
 * jsdom does not install these, but every real browser has them and this
 * extension's code assumes so — `utils/gzip.ts` encodes with one and decodes
 * with the other. Node's implementations are the same WHATWG API.
 */
if (typeof globalThis.TextEncoder === 'undefined') {
  globalThis.TextEncoder = TextEncoder;
  globalThis.TextDecoder = TextDecoder;
}

/**
 * jsdom's `crypto` is `getRandomValues` and nothing else — it has no `subtle`,
 * which is the whole of `utils/gcpJwt`'s signing. Node's WebCrypto is the same
 * standard API a browser exposes, so swapping it in tests the real code path
 * rather than a mock of it. `defineProperty` because `window.crypto` is a
 * read-only accessor and a plain assignment is silently dropped.
 */
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto, configurable: true, writable: true
  });
}

/**
 * Same story for the compression streams, which `utils/gzip` is built on.
 *
 * jsdom's `Blob` has to be replaced along with them: it has no `stream()` at
 * all, and `gzip.ts` starts every operation with `new Blob([…]).stream()`.
 * Node's `Blob` returns a WHATWG `ReadableStream` that `CompressionStream`
 * from the same runtime can be piped into, which jsdom's could not have been.
 */
if (typeof globalThis.CompressionStream === 'undefined') {
  globalThis.CompressionStream = CompressionStream;
  globalThis.DecompressionStream = DecompressionStream;
  globalThis.Blob = Blob;
}

config.global = config.global || {};
config.global.mocks = {
  ...(config.global.mocks || {}),
  t: (key, args) => (args ? `${ key }(${ JSON.stringify(args) })` : key),
};
