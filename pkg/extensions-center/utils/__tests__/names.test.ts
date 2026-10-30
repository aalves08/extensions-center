import { fallbackName } from '../names';

describe('fallbackName', () => {
  it.each([
    ['owner/rancher-foo-ui-extension', 'Foo'],
    ['rancher/kubewarden-ui', 'Kubewarden'],
    ['rancher/elemental-ui', 'Elemental'],
    // Only a *trailing* `ui` is stripped, so the leading one survives here.
    ['rancher/ui-plugin-examples', 'Ui Plugin Examples'],
    ['neuvector/security-ui-exts', 'Security'],
  ])('turns %s into %s', (id, expected) => {
    expect(fallbackName(id)).toBe(expected);
  });

  it('strips the extension suffix in each spelling it appears in', () => {
    expect(fallbackName('o/thing-extension')).toBe('Thing');
    expect(fallbackName('o/thing-extensions')).toBe('Thing');
    expect(fallbackName('o/thing-ext')).toBe('Thing');
    expect(fallbackName('o/thing-exts')).toBe('Thing');
    expect(fallbackName('o/thing-ui-ext')).toBe('Thing');
    expect(fallbackName('o/thing_ui_extension')).toBe('Thing');
  });

  it('title-cases every word', () => {
    expect(fallbackName('o/multi-word-name-ui')).toBe('Multi Word Name');
  });

  it('handles an id with no owner segment', () => {
    expect(fallbackName('kubewarden-ui')).toBe('Kubewarden');
  });

  it('keeps a bare `ui` left behind after the prefix is stripped', () => {
    // The `[-_]ui$` rule needs a separator, so 'rancher-ui' lands on 'Ui'
    // rather than being reduced to nothing.
    expect(fallbackName('owner/rancher-ui')).toBe('Ui');
  });

  it('falls back to the raw repo rather than rendering an empty cell', () => {
    expect(fallbackName('owner/extension')).toBe('Extension');
    expect(fallbackName('owner/-ui-extension')).toBe('-Ui-Extension');
  });

  it('collapses runs of separators into a single space', () => {
    expect(fallbackName('o/a--b__c')).toBe('A B C');
  });

  it('is case-insensitive about the prefixes and suffixes it strips', () => {
    expect(fallbackName('o/Rancher-Thing-UI')).toBe('Thing');
  });

  it('leaves an already-clean name alone apart from casing', () => {
    expect(fallbackName('o/harvester')).toBe('Harvester');
  });
});
