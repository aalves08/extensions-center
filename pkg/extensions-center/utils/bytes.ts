/**
 * Byte counting and formatting for the analysis pages.
 *
 * Every number on both pages is a size, so these two helpers get used from
 * nearly every table cell.
 */

const UNITS = ['B', 'KB', 'MB', 'GB'];

/** `183274` → `179.0 KB`. Base 1024, matching how the source reports read. */
export function prettyBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || Number.isNaN(bytes)) {
    return '—';
  }

  let value = bytes;
  let unit = 0;

  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }

  // Whole bytes never need a decimal; everything else reads better with one.
  const digits = unit === 0 ? 0 : 1;

  return `${ value.toFixed(digits) } ${ UNITS[unit] }`;
}

/**
 * UTF-8 byte length of a string.
 *
 * `Buffer.byteLength` is what the Node pipeline used and does not exist here,
 * and `new TextEncoder().encode(s).length` allocates a copy of every file it
 * measures — which, across ~98MB of source maps, is a lot of garbage for a
 * number. Counting code units directly costs nothing.
 */
export function utf8Length(str: string): number {
  let bytes = 0;

  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);

    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      // Leading surrogate: the pair encodes to four bytes, so consume both.
      bytes += 4;
      i++;
    } else {
      bytes += 3;
    }
  }

  return bytes;
}
