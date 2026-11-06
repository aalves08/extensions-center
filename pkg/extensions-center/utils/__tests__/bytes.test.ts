import { prettyBytes, utf8Length } from '../bytes';

describe('prettyBytes', () => {
  it('shows whole bytes without a decimal', () => {
    expect(prettyBytes(0)).toBe('0 B');
    expect(prettyBytes(512)).toBe('512 B');
    expect(prettyBytes(1023)).toBe('1023 B');
  });

  it('uses base 1024, not 1000', () => {
    expect(prettyBytes(1000)).toBe('1000 B');
    expect(prettyBytes(1024)).toBe('1.0 KB');
  });

  it.each([
    [183274, '179.0 KB'],
    [1024 * 1024, '1.0 MB'],
    [1024 * 1024 * 1024, '1.0 GB'],
    [1536, '1.5 KB'],
  ])('formats %i as %s', (input, expected) => {
    expect(prettyBytes(input)).toBe(expected);
  });

  it('stops at GB rather than inventing a larger unit', () => {
    expect(prettyBytes(5 * 1024 ** 4)).toBe('5120.0 GB');
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['NaN', NaN],
  ])('renders %s as an em dash', (_label, input) => {
    expect(prettyBytes(input)).toBe('—');
  });

  it('does not mistake zero for missing', () => {
    // `0` is falsy; a truthiness check here would print '—' for an empty file.
    expect(prettyBytes(0)).not.toBe('—');
  });
});

describe('utf8Length', () => {
  it('counts ASCII as one byte each', () => {
    expect(utf8Length('hello')).toBe(5);
  });

  it('is zero for an empty string', () => {
    expect(utf8Length('')).toBe(0);
  });

  it.each([
    ['e-acute', 'é', 2],
    ['euro sign', '€', 3],
    ['CJK', '日本語', 9],
    ['emoji', '\u{1f600}', 4],
  ])('counts %s as %d bytes', (_label, input, expected) => {
    expect(utf8Length(input as string)).toBe(expected);
  });

  it('counts a surrogate pair once, not twice', () => {
    // The emoji is 2 UTF-16 code units; summing per unit would give 6, not 4.
    expect(utf8Length('\u{1f600}')).toBe(4);
    expect('\u{1f600}'.length).toBe(2);
  });

  it('agrees with TextEncoder across a mixed string', () => {
    const samples = [
      'plain ascii',
      'café résumé',
      '日本語テキスト',
      'emoji \u{1f600}\u{1f389} and ascii',
      '{"key":"välue","n":1}',
      '\u007f\u0080\u07ff\u0800\uffff',
    ];

    for (const s of samples) {
      expect(utf8Length(s)).toBe(new TextEncoder().encode(s).length);
    }
  });

  it('counts a boundary code point on each side of every threshold', () => {
    expect(utf8Length('\u007f')).toBe(1);
    expect(utf8Length('\u0080')).toBe(2);
    expect(utf8Length('\u07ff')).toBe(2);
    expect(utf8Length('\u0800')).toBe(3);
    expect(utf8Length('\uffff')).toBe(3);
  });

  it('counts an unpaired surrogate the way TextEncoder does', () => {
    // A lone trailing surrogate costs 3 bytes, matching the replacement
    // character TextEncoder substitutes. Worth pinning, since a truncated
    // source map can end mid-pair.
    expect(utf8Length('\udc00')).toBe(3);
    expect(new TextEncoder().encode('\udc00').length).toBe(3);
  });
});
