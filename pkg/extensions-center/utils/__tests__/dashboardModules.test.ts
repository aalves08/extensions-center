import { componentsCandidates, resolveSize, shellCandidates } from '../dashboardModules';

describe('shellCandidates', () => {
  it('tries the bare path before any extension', () => {
    // Imports written '@shell/components/Loading.vue' already carry their
    // extension; appending would produce 'Loading.vue.ts' and miss the file.
    expect(shellCandidates('@shell/components/Loading.vue')[0]).toBe('shell/components/Loading.vue');
  });

  it('offers every resolution a bundler would try', () => {
    expect(shellCandidates('@shell/utils/object')).toEqual([
      'shell/utils/object',
      'shell/utils/object.ts',
      'shell/utils/object.js',
      'shell/utils/object.vue',
      'shell/utils/object/index.ts',
      'shell/utils/object/index.js',
      'shell/utils/object/index.vue',
    ]);
  });

  it('accepts the package form as well as the alias', () => {
    expect(shellCandidates('@rancher/shell/utils/object'))
      .toEqual(shellCandidates('@shell/utils/object'));
  });

  it('handles a bare alias with no subpath', () => {
    expect(shellCandidates('@shell')[0]).toBe('shell');
    expect(shellCandidates('@rancher/shell')[0]).toBe('shell');
  });
});

describe('componentsCandidates', () => {
  it('tries the components subdirectory first', () => {
    const out = componentsCandidates('@rancher/components/Banner');

    expect(out[0]).toBe('pkg/rancher-components/src/components/Banner');
    expect(out).toContain('pkg/rancher-components/src/components/Banner.vue');
  });

  it('also tries the package root, where a handful of files live', () => {
    expect(componentsCandidates('@components/Banner'))
      .toContain('pkg/rancher-components/src/Banner.vue');
  });

  it('accepts the alias and the package form alike', () => {
    expect(componentsCandidates('@components/Banner'))
      .toEqual(componentsCandidates('@rancher/components/Banner'));
  });

  it('handles a bare alias with no subpath', () => {
    expect(componentsCandidates('@components')[0]).toBe('pkg/rancher-components/src');
  });

  it('puts every components/ candidate before every root candidate', () => {
    const out = componentsCandidates('@components/Banner');
    const lastNested = out.map((c) => c.includes('/components/')).lastIndexOf(true);
    const firstRoot = out.findIndex((c) => !c.includes('/components/'));

    expect(lastNested).toBeLessThan(firstRoot);
  });
});

describe('resolveSize', () => {
  const sizes = new Map([
    ['shell/utils/object.ts', 4096],
    ['shell/components/Loading.vue', 512],
    ['shell/empty.ts', 0],
  ]);

  it('returns the size of the first candidate present', () => {
    expect(resolveSize(shellCandidates('@shell/utils/object'), sizes)).toBe(4096);
  });

  it('resolves a path that already carries its extension', () => {
    expect(resolveSize(shellCandidates('@shell/components/Loading.vue'), sizes)).toBe(512);
  });

  it('returns null when nothing matches', () => {
    expect(resolveSize(shellCandidates('@shell/gone/missing'), sizes)).toBeNull();
  });

  it('returns null for an empty candidate list', () => {
    expect(resolveSize([], sizes)).toBeNull();
  });

  it('treats a zero-byte file as found, not missing', () => {
    // `sizes.get` returns 0 here; a truthiness check would report it absent.
    expect(resolveSize(['shell/empty.ts'], sizes)).toBe(0);
  });

  it('honours candidate order', () => {
    const both = new Map([['a', 1], ['b', 2]]);

    expect(resolveSize(['a', 'b'], both)).toBe(1);
    expect(resolveSize(['b', 'a'], both)).toBe(2);
  });
});
