import { matchVersions, satisfiesRange } from '../semverRange';

describe('satisfiesRange', () => {
  it('handles the comma-separated AND form advisories actually use', () => {
    expect(satisfiesRange('4.17.15', '>= 4.0.0, < 4.17.19')).toBe(true);
    expect(satisfiesRange('4.17.19', '>= 4.0.0, < 4.17.19')).toBe(false);
    expect(satisfiesRange('3.9.0', '>= 4.0.0, < 4.17.19')).toBe(false);
  });

  it.each([
    ['>= 1.0.0', '1.0.0', true],
    ['>= 1.0.0', '0.9.9', false],
    ['<= 1.0.0', '1.0.0', true],
    ['<= 1.0.0', '1.0.1', false],
    ['> 1.0.0', '1.0.0', false],
    ['> 1.0.0', '1.0.1', true],
    ['< 1.0.0', '0.9.9', true],
    ['< 1.0.0', '1.0.0', false],
    ['= 1.0.0', '1.0.0', true],
    ['== 1.0.0', '1.0.0', true],
    ['= 1.0.0', '1.0.1', false],
  ])('evaluates %s against %s', (range, version, expected) => {
    expect(satisfiesRange(version, range)).toBe(expected);
  });

  it('treats a bare version as equality', () => {
    expect(satisfiesRange('1.2.3', '1.2.3')).toBe(true);
    expect(satisfiesRange('1.2.4', '1.2.3')).toBe(false);
  });

  it('accepts a v prefix on the range side', () => {
    expect(satisfiesRange('1.2.3', '>= v1.0.0')).toBe(true);
  });

  it('tolerates missing whitespace after the operator', () => {
    expect(satisfiesRange('1.2.3', '>=1.0.0')).toBe(true);
  });

  it.each([
    ['no range at all', undefined],
    ['an empty range', ''],
    ['a whitespace-only range', '   '],
    ['a comma with nothing around it', ','],
  ])('returns null for %s', (_label, range) => {
    expect(satisfiesRange('1.2.3', range)).toBeNull();
  });

  it.each([
    ['a caret range', '^1.0.0'],
    ['a tilde range', '~1.2.0'],
    ['an x wildcard', '1.2.x'],
    ['a star wildcard', '*'],
    ['an OR', '>= 1.0.0 || < 0.5.0'],
    ['a partial version', '>= 1.2'],
    ['an unknown operator', '!= 1.2.3'],
  ])('returns null rather than false for %s', (_label, range) => {
    // The distinction that matters: "undetermined", not "not vulnerable".
    // Any of these reaching a comparison would come back as a confident
    // answer that happens to be wrong.
    expect(satisfiesRange('1.2.3', range)).toBeNull();
  });

  it('accepts build metadata on the range side', () => {
    expect(satisfiesRange('1.2.3', '>= 1.0.0+build.5')).toBe(true);
  });

  it('returns null when the version itself cannot be ranked', () => {
    // compareSemver sorts unparseable input last, which would otherwise make
    // this a silent hit against any lower bound.
    expect(satisfiesRange('nonsense', '>= 4.0.0')).toBeNull();
    expect(satisfiesRange('1.2', '>= 1.0.0')).toBeNull();
    expect(satisfiesRange('', '>= 1.0.0')).toBeNull();
  });

  it('poisons the whole range when one clause of an AND is unparseable', () => {
    // Skipping the bad clause would widen the range and invent a hit.
    expect(satisfiesRange('1.2.3', '>= 1.0.0, ^2.0.0')).toBeNull();
  });

  it('short-circuits to false before reaching an unparseable clause', () => {
    expect(satisfiesRange('0.1.0', '>= 1.0.0, ^2.0.0')).toBe(false);
  });

  it('compares prereleases below their release', () => {
    expect(satisfiesRange('2.0.0-rc.1', '< 2.0.0')).toBe(true);
  });
});

describe('matchVersions', () => {
  it('reports hit when every resolved version is in range', () => {
    expect(matchVersions(['4.17.15', '4.17.11'], '>= 4.0.0, < 4.17.19')).toBe('hit');
  });

  it('reports miss when none are', () => {
    expect(matchVersions(['4.17.21'], '>= 4.0.0, < 4.17.19')).toBe('miss');
  });

  it('reports partial for a lockfile resolving one name twice, only one vulnerable', () => {
    expect(matchVersions(['4.17.15', '4.17.21'], '>= 4.0.0, < 4.17.19')).toBe('partial');
  });

  it('reports unknown when there are no versions to check', () => {
    expect(matchVersions([], '>= 1.0.0')).toBe('unknown');
  });

  it('reports unknown when the range is unparseable', () => {
    expect(matchVersions(['1.2.3'], '^1.0.0')).toBe('unknown');
  });

  it('reports unknown when the range is missing', () => {
    expect(matchVersions(['1.2.3'], null)).toBe('unknown');
  });

  it('lets a single unrankable version poison an otherwise clean match', () => {
    // Not 'partial' and not 'hit': one version nobody can place makes the
    // whole verdict untrustworthy, and saying so beats guessing either way.
    expect(matchVersions(['4.17.15', 'nonsense'], '< 4.17.19')).toBe('unknown');
    expect(matchVersions(['nonsense'], '>= 4.0.0')).toBe('unknown');
  });
});
