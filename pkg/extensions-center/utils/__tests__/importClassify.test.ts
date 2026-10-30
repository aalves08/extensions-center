import { classifyImport, normaliseShellPath, packageName } from '../importClassify';

describe('normaliseShellPath', () => {
  it('rewrites the @shell alias to the package path', () => {
    expect(normaliseShellPath('@shell/utils/object')).toBe('@rancher/shell/utils/object');
  });

  it('rewrites the bare alias', () => {
    expect(normaliseShellPath('@shell')).toBe('@rancher/shell');
  });

  it('leaves the package form untouched', () => {
    expect(normaliseShellPath('@rancher/shell/utils/object')).toBe('@rancher/shell/utils/object');
  });

  it('leaves unrelated imports untouched', () => {
    expect(normaliseShellPath('lodash/debounce')).toBe('lodash/debounce');
    expect(normaliseShellPath('@components/Banner')).toBe('@components/Banner');
  });

  it('does not rewrite a package that merely starts with the alias text', () => {
    // '@shelly' is not '@shell'; a prefix check without the boundary would
    // turn it into '@rancher/shelly'.
    expect(normaliseShellPath('@shelly/thing')).toBe('@shelly/thing');
  });
});

describe('classifyImport', () => {
  const ext = 'kubewarden';

  it.each([
    ['@shell/utils/object'],
    ['@shell'],
    ['@rancher/shell/config/types'],
  ])('classifies %s as shell', (source) => {
    expect(classifyImport(source, ext)).toBe('shell');
  });

  it.each([
    ['@components/Banner'],
    ['@components'],
    ['@rancher/components/Banner'],
    ['@rancher/icons'],
  ])('classifies %s as components', (source) => {
    expect(classifyImport(source, ext)).toBe('components');
  });

  it.each([
    ['./sibling'],
    ['../parent/thing'],
    ['/absolute/path'],
    ['@pkg/kubewarden/types'],
    ['@common/shared'],
    ['@kubewarden/modules/thing'],
  ])('classifies %s as internal', (source) => {
    expect(classifyImport(source, ext)).toBe('internal');
  });

  it.each([
    ['lodash'],
    ['lodash/debounce'],
    ['vue'],
    ['@types/node'],
    ['js-yaml'],
  ])('classifies %s as external', (source) => {
    expect(classifyImport(source, ext)).toBe('external');
  });

  it('treats the extension aliasing itself under its own scope as internal', () => {
    expect(classifyImport('@kubewarden/thing', 'kubewarden')).toBe('internal');
  });

  it('accepts the underscored spelling of a hyphenated extension name', () => {
    expect(classifyImport('@my_ext/thing', 'my-ext')).toBe('internal');
    expect(classifyImport('@my-ext/thing', 'my-ext')).toBe('internal');
  });

  it('does not treat another extension\'s scope as internal', () => {
    expect(classifyImport('@elemental/thing', 'kubewarden')).toBe('external');
  });

  it('prefers shell over components for @rancher/shell', () => {
    // Both branches could claim it; shell is checked first and is correct.
    expect(classifyImport('@rancher/shell/utils/object', ext)).toBe('shell');
  });
});

describe('packageName', () => {
  it.each([
    ['lodash', 'lodash'],
    ['lodash/debounce', 'lodash'],
    ['lodash/fp/get', 'lodash'],
    ['@rancher/shell', '@rancher/shell'],
    ['@rancher/shell/utils/object', '@rancher/shell'],
    ['@scope/pkg', '@scope/pkg'],
  ])('reduces %s to %s', (source, expected) => {
    expect(packageName(source)).toBe(expected);
  });

  it('collapses many subpaths of one package to a single name', () => {
    const sources = ['lodash/debounce', 'lodash/get', 'lodash/merge'];

    expect(new Set(sources.map(packageName))).toEqual(new Set(['lodash']));
  });
});
