import {
  compareSemver, dependencyVersion, isPrerelease, latestStableVersion, latestVersion
} from '../version';
import { PackageJson } from '../../types/github';

describe('compareSemver', () => {
  it.each([
    ['1.0.0', '1.0.1'],
    ['1.0.0', '1.1.0'],
    ['1.9.0', '1.10.0'],
    ['1.0.0', '2.0.0'],
    ['2.9.9', '10.0.0'],
  ])('sorts %s before %s', (a, b) => {
    expect(compareSemver(a, b)).toBeLessThan(0);
    expect(compareSemver(b, a)).toBeGreaterThan(0);
  });

  it('treats equal versions as equal', () => {
    expect(compareSemver('1.2.3', '1.2.3')).toBe(0);
  });

  it('ignores a leading v', () => {
    expect(compareSemver('v1.2.3', '1.2.3')).toBe(0);
  });

  it('compares numerically rather than lexically', () => {
    // The bug a string sort would introduce: '10' < '9' as text.
    expect(compareSemver('0.10.0', '0.9.0')).toBeGreaterThan(0);
  });

  it('ranks a release above its own prerelease', () => {
    expect(compareSemver('3.0.2', '3.0.2-rc.1')).toBeGreaterThan(0);
    expect(compareSemver('3.0.2-rc.1', '3.0.2')).toBeLessThan(0);
  });

  it('orders two prereleases of the same version', () => {
    expect(compareSemver('1.0.0-alpha', '1.0.0-beta')).toBeLessThan(0);
  });

  it('treats identical prereleases as equal', () => {
    expect(compareSemver('1.0.0-rc.1', '1.0.0-rc.1')).toBe(0);
  });

  it('still ranks by release numbers when only one side is a prerelease', () => {
    expect(compareSemver('2.0.0-rc.1', '1.9.9')).toBeGreaterThan(0);
  });

  it('sorts unparseable versions after parseable ones', () => {
    expect(compareSemver('not-a-version', '1.0.0')).toBeGreaterThan(0);
    expect(compareSemver('1.0.0', 'not-a-version')).toBeLessThan(0);
  });

  it('keeps a stable order between two unparseable versions', () => {
    expect(compareSemver('alpha', 'beta')).toBeLessThan(0);
    expect(compareSemver('beta', 'alpha')).toBeGreaterThan(0);
  });

  it('is a usable Array#sort comparator', () => {
    const sorted = ['1.10.0', '1.2.0', '1.2.0-rc.1', '2.0.0', '0.9.0'].sort(compareSemver);

    expect(sorted).toEqual(['0.9.0', '1.2.0-rc.1', '1.2.0', '1.10.0', '2.0.0']);
  });
});

describe('latestVersion', () => {
  it('returns the highest version', () => {
    expect(latestVersion(['1.0.0', '2.3.4', '0.9.9'])).toBe('2.3.4');
  });

  it('returns null for an empty list', () => {
    expect(latestVersion([])).toBeNull();
  });

  it('tolerates a null-ish list', () => {
    expect(latestVersion(undefined as unknown as string[])).toBeNull();
  });

  it('does not mutate its input', () => {
    const input = ['2.0.0', '1.0.0'];

    latestVersion(input);

    expect(input).toEqual(['2.0.0', '1.0.0']);
  });

  it('still picks a prerelease when it outranks every release', () => {
    expect(latestVersion(['3.0.2-rc.996', '3.0.1'])).toBe('3.0.2-rc.996');
  });
});

describe('isPrerelease', () => {
  it.each(['1.2.3-rc.1', '1.0.0-alpha', 'v2.0.0-dev-20261011'])('is true for %s', (v) => {
    expect(isPrerelease(v)).toBe(true);
  });

  it.each(['1.2.3', 'v1.2.3', 'nonsense'])('is false for %s', (v) => {
    expect(isPrerelease(v)).toBe(false);
  });

  it('does not treat build metadata as a prerelease', () => {
    expect(isPrerelease('1.2.3+build.5')).toBe(false);
  });
});

describe('latestStableVersion', () => {
  it('ignores prereleases outranking every release', () => {
    expect(latestStableVersion(['3.0.2-rc.996', '3.0.1'])).toBe('3.0.1');
  });

  it('returns null when every version is a prerelease', () => {
    expect(latestStableVersion(['1.0.0-rc.1', '1.0.0-rc.2'])).toBeNull();
  });

  it('tolerates a null-ish list', () => {
    expect(latestStableVersion(undefined as unknown as string[])).toBeNull();
  });
});

describe('dependencyVersion', () => {
  const pkg: PackageJson = {
    dependencies:     { '@rancher/shell': '^3.0.13' },
    devDependencies:  { typescript: '5.4.0' },
    peerDependencies: { vue: '^3.4.0' },
    resolutions:      { '@types/node': '~25.3.0' },
  } as PackageJson;

  it.each([
    ['@rancher/shell', '^3.0.13'],
    ['typescript', '5.4.0'],
    ['vue', '^3.4.0'],
    ['@types/node', '~25.3.0'],
  ])('finds %s', (name, expected) => {
    expect(dependencyVersion(pkg, name)).toBe(expected);
  });

  it('returns null when the dependency is absent', () => {
    expect(dependencyVersion(pkg, 'lodash')).toBeNull();
  });

  it('returns null for a null package.json', () => {
    expect(dependencyVersion(null, '@rancher/shell')).toBeNull();
  });

  it('prefers dependencies over devDependencies for the same name', () => {
    const both = {
      dependencies:    { vue: '3.4.0' },
      devDependencies: { vue: '3.0.0' },
    } as PackageJson;

    expect(dependencyVersion(both, 'vue')).toBe('3.4.0');
  });

  it('coerces a non-string value to a string', () => {
    const odd = { dependencies: { weird: 3 } } as unknown as PackageJson;

    expect(dependencyVersion(odd, 'weird')).toBe('3');
  });
});
