import { parseUpdatedDependencies } from '../dependabotPr';

/** A commit message in the shape Dependabot writes it. */
function commit(body: string): string {
  return [
    'Bump handlebars from 4.7.7 to 4.7.10',
    '',
    'Bumps handlebars to 4.7.10.',
    '',
    '---',
    'updated-dependencies:',
    body,
    '...',
    '',
    'Signed-off-by: dependabot[bot] <support@github.com>',
  ].join('\n');
}

describe('parseUpdatedDependencies', () => {
  it('reads the package and version out of the trailer', () => {
    expect(parseUpdatedDependencies(commit([
      '- dependency-name: handlebars',
      '  dependency-version: 4.7.10',
      '  dependency-type: indirect',
    ].join('\n')))).toEqual([{ name: 'handlebars', version: '4.7.10' }]);
  });

  it('reads every entry in a multi-package commit', () => {
    expect(parseUpdatedDependencies(commit([
      '- dependency-name: handlebars',
      '  dependency-version: 4.7.10',
      '  dependency-type: indirect',
      '- dependency-name: js-yaml',
      '  dependency-version: 4.1.0',
      '  dependency-type: direct:production',
    ].join('\n')))).toEqual([
      { name: 'handlebars', version: '4.7.10' },
      { name: 'js-yaml', version: '4.1.0' },
    ]);
  });

  it('strips the quotes Dependabot puts round a scoped name', () => {
    // Everything downstream joins this against `Advisory.packageName`, which is
    // `@types/semver` — with the quotes on, a scoped package never matches.
    expect(parseUpdatedDependencies(commit([
      '- dependency-name: "@types/semver"',
      '  dependency-version: 7.8.0',
    ].join('\n')))).toEqual([{ name: '@types/semver', version: '7.8.0' }]);
  });

  it('strips single quotes too', () => {
    expect(parseUpdatedDependencies(commit([
      '- dependency-name: \'@rancher/shell\'',
      '  dependency-version: 3.0.14',
    ].join('\n')))).toEqual([{ name: '@rancher/shell', version: '3.0.14' }]);
  });

  it('ignores the prose above the block', () => {
    // The title names one package even when the PR bumps several, which is the
    // whole reason this reads the trailer instead.
    const message = [
      'Bump jest and associated dependencies to 30.5.1',
      '',
      'Bumps jest. These dependencies need to be updated together.',
      '---',
      'updated-dependencies:',
      '- dependency-name: jest-environment-jsdom',
      '  dependency-version: 30.5.1',
      '...',
    ].join('\n');

    expect(parseUpdatedDependencies(message)).toEqual([
      { name: 'jest-environment-jsdom', version: '30.5.1' },
    ]);
  });

  it('stops at the end-of-document marker', () => {
    const message = [
      'updated-dependencies:',
      '- dependency-name: handlebars',
      '  dependency-version: 4.7.10',
      '...',
      '',
      'Signed-off-by: dependabot[bot] <support@github.com>',
      '- dependency-name: evil',
      '  dependency-version: 9.9.9',
    ].join('\n');

    expect(parseUpdatedDependencies(message)).toEqual([{ name: 'handlebars', version: '4.7.10' }]);
  });

  it('does not treat a blank line as the end of the block', () => {
    // `...` is the terminator; a blank line is not, and ending there would drop
    // the second half of a multi-package commit.
    const message = [
      'updated-dependencies:',
      '- dependency-name: handlebars',
      '  dependency-version: 4.7.10',
      '',
      '- dependency-name: js-yaml',
      '  dependency-version: 4.1.0',
      '...',
    ].join('\n');

    expect(parseUpdatedDependencies(message)).toHaveLength(2);
  });

  it('drops an entry that names a package but no version', () => {
    // Older Dependabot wrote `dependency-version` only for some update types,
    // and a name on its own cannot be compared against a patched version.
    expect(parseUpdatedDependencies(commit([
      '- dependency-name: handlebars',
      '  dependency-type: indirect',
      '- dependency-name: js-yaml',
      '  dependency-version: 4.1.0',
    ].join('\n')))).toEqual([{ name: 'js-yaml', version: '4.1.0' }]);
  });

  it('takes only the first version after a name', () => {
    expect(parseUpdatedDependencies(commit([
      '- dependency-name: handlebars',
      '  dependency-version: 4.7.10',
      '  dependency-version: 9.9.9',
    ].join('\n')))).toEqual([{ name: 'handlebars', version: '4.7.10' }]);
  });

  it('says nothing about a commit with no trailer', () => {
    expect(parseUpdatedDependencies('Merge pull request #18965 from rancher/dependabot')).toEqual([]);
  });

  it('copes with an empty or missing message', () => {
    expect(parseUpdatedDependencies('')).toEqual([]);
    expect(parseUpdatedDependencies(null as unknown as string)).toEqual([]);
  });

  it('returns nothing for a block with no entries', () => {
    expect(parseUpdatedDependencies('updated-dependencies:\n...')).toEqual([]);
  });

  it('keeps a prerelease version intact', () => {
    expect(parseUpdatedDependencies(commit([
      '- dependency-name: "@rancher/shell"',
      '  dependency-version: 3.0.14-rc.4',
    ].join('\n')))).toEqual([{ name: '@rancher/shell', version: '3.0.14-rc.4' }]);
  });
});
