import { parseHelmIndexVersions } from '../helmIndex';

describe('parseHelmIndexVersions', () => {
  it('reads chart names and versions', () => {
    const yaml = `apiVersion: v1
entries:
  kubewarden:
  - apiVersion: v2
    name: kubewarden
    version: 4.2.1
  - apiVersion: v2
    name: kubewarden
    version: 4.2.0
  elemental:
  - apiVersion: v2
    version: 1.6.0
generated: "2026-01-01T00:00:00Z"
`;

    expect(parseHelmIndexVersions(yaml)).toEqual({
      kubewarden: ['4.2.1', '4.2.0'],
      elemental:  ['1.6.0'],
    });
  });

  it('keeps versions in file order', () => {
    const yaml = `entries:
  c:
  - version: 1.0.0
  - version: 3.0.0
  - version: 2.0.0
`;

    expect(parseHelmIndexVersions(yaml).c).toEqual(['1.0.0', '3.0.0', '2.0.0']);
  });

  it('ignores a nested dependency version', () => {
    // A `dependencies` block carries a `version` of its own, two spaces
    // deeper. Reading it would record a dependency's range as the chart's.
    const yaml = `entries:
  kubewarden:
  - name: kubewarden
    version: 4.2.1
    dependencies:
    - name: common
      version: 9.9.9
`;

    expect(parseHelmIndexVersions(yaml).kubewarden).toEqual(['4.2.1']);
  });

  it('reads a version sitting on the dash line itself', () => {
    const yaml = `entries:
  thing:
  - version: 1.0.0
`;

    expect(parseHelmIndexVersions(yaml).thing).toEqual(['1.0.0']);
  });

  it('strips quotes from a quoted version', () => {
    const yaml = `entries:
  thing:
  - version: "1.0.0"
  - version: '2.0.0'
`;

    expect(parseHelmIndexVersions(yaml).thing).toEqual(['1.0.0', '2.0.0']);
  });

  it('closes the entries block at the next top-level key', () => {
    const yaml = `entries:
  thing:
  - version: 1.0.0
generated: "2026-01-01T00:00:00Z"
other:
  thing:
  - version: 9.9.9
`;

    expect(parseHelmIndexVersions(yaml).thing).toEqual(['1.0.0']);
  });

  it('records a chart with no versions as an empty list', () => {
    const yaml = `entries:
  empty:
`;

    expect(parseHelmIndexVersions(yaml)).toEqual({ empty: [] });
  });

  it('merges two blocks naming the same chart', () => {
    const yaml = `entries:
  thing:
  - version: 1.0.0
  thing:
  - version: 2.0.0
`;

    expect(parseHelmIndexVersions(yaml).thing).toEqual(['1.0.0', '2.0.0']);
  });

  it('ignores comments and blank lines', () => {
    const yaml = `# a comment
entries:

  thing:
    # another
  - version: 1.0.0
`;

    expect(parseHelmIndexVersions(yaml).thing).toEqual(['1.0.0']);
  });

  it.each([
    ['empty input', ''],
    ['null input', null],
    ['undefined input', undefined],
    ['an index with no entries block', 'apiVersion: v1\ngenerated: "x"\n'],
  ])('returns an empty object for %s', (_label, input) => {
    expect(parseHelmIndexVersions(input as unknown as string)).toEqual({});
  });

  it('accepts the dots and dashes real chart names use', () => {
    const yaml = `entries:
  my-chart.v2_beta:
  - version: 1.0.0
`;

    expect(parseHelmIndexVersions(yaml)['my-chart.v2_beta']).toEqual(['1.0.0']);
  });
});
