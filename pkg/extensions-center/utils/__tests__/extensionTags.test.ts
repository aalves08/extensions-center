import { matchTag, semverFromTag, tagBelongsTo } from '../extensionTags';

describe('semverFromTag', () => {
  it.each([
    ['kubewarden', 'kubewarden-4.2.1', '4.2.1'],
    ['observability', 'observability@2.4.0', '2.4.0'],
    ['anything', 'v1.9.0', '1.9.0'],
    ['anything', '1.9.0', '1.9.0'],
    ['anything', 'v1.10.0-dev-20261011', '1.10.0-dev-20261011'],
  ])('reads %s / %s as %s', (ext, tag, expected) => {
    expect(semverFromTag(ext, tag)).toBe(expected);
  });

  it('strips the name prefix before the v', () => {
    expect(semverFromTag('kubewarden', 'kubewarden-v4.2.1')).toBe('4.2.1');
  });

  it('only strips a v that a digit follows', () => {
    // A plain /^v/ is what produced 'irtual-clusters-1.2.0' in the old report.
    expect(semverFromTag('other', 'virtual-clusters-1.2.0')).toBe('virtual-clusters-1.2.0');
    expect(semverFromTag('other', 'vulnerability-scanner-0.9.0')).toBe('vulnerability-scanner-0.9.0');
  });

  it('matches the name prefix case-insensitively', () => {
    expect(semverFromTag('kubewarden', 'Kubewarden-4.2.1')).toBe('4.2.1');
  });

  it('treats regex metacharacters in the name as literal text', () => {
    expect(semverFromTag('a.b', 'a.b-1.0.0')).toBe('1.0.0');
    // The escaped dot must not match an arbitrary character.
    expect(semverFromTag('a.b', 'axb-1.0.0')).toBe('axb-1.0.0');
  });

  it('leaves a tag belonging to something else alone', () => {
    expect(semverFromTag('vulnerability-scanner', 'runtime-enforcer-0.1.1')).toBe('runtime-enforcer-0.1.1');
  });
});

describe('matchTag', () => {
  it.each([
    ['kubewarden', 'kubewarden-4.2.2'],
    ['observability', 'observability@2.4.2'],
  ])('calls %s / %s named', (ext, tag) => {
    expect(matchTag(ext, tag)).toBe('named');
  });

  it.each([
    ['v1.9.0'],
    ['1.9.0'],
    ['1.9'],
    ['v1.10.0-dev-20261011'],
    ['2.0.0+build.1'],
  ])('calls %s bare', (tag) => {
    expect(matchTag('kubewarden', tag)).toBe('bare');
  });

  it.each([
    ['stackstate-0.7.0'],
    ['runtime-enforcer-0.1.1'],
    ['release-candidate'],
  ])('calls %s other', (tag) => {
    expect(matchTag('vulnerability-scanner', tag)).toBe('other');
  });
});

describe('tagBelongsTo', () => {
  it('accepts a named tag regardless of siblings', () => {
    expect(tagBelongsTo('kubewarden', 'kubewarden-4.2.2', 0)).toBe(true);
    expect(tagBelongsTo('kubewarden', 'kubewarden-4.2.2', 3)).toBe(true);
  });

  it('accepts a bare version only when the repo holds one extension', () => {
    expect(tagBelongsTo('kubewarden', 'v1.9.0', 0)).toBe(true);
    expect(tagBelongsTo('kubewarden', 'v1.9.0', 1)).toBe(false);
  });

  it('never accepts another extension\'s tag', () => {
    expect(tagBelongsTo('vulnerability-scanner', 'runtime-enforcer-0.1.1', 0)).toBe(false);
    expect(tagBelongsTo('vulnerability-scanner', 'runtime-enforcer-0.1.1', 3)).toBe(false);
  });

  it('picks the right tag out of an interleaved multi-extension stream', () => {
    // The neuvector/security-ui-exts case this module exists for: taking the
    // newest tag would hand vulnerability-scanner a runtime-enforcer release.
    const tags = [
      'vulnerability-scanner-0.9.2',
      'runtime-enforcer-0.1.1',
      'vulnerability-scanner-0.9.1',
      'runtime-enforcer-0.1.0',
    ];
    const mine = tags.filter((t) => tagBelongsTo('vulnerability-scanner', t, 3));

    expect(mine).toEqual(['vulnerability-scanner-0.9.2', 'vulnerability-scanner-0.9.1']);
    expect(semverFromTag('vulnerability-scanner', mine[0])).toBe('0.9.2');
  });
});
