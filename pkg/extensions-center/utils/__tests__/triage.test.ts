import { Advisory, PackageGroup, PrFix, RepoSecurity } from '../../types/security';
import {
  AdvisoryFacts,
  applyPrs,
  emptyTriageCounts,
  exposureOf,
  matchingPr,
  nonShippedSegment,
  remediationCommand,
  triageAdvisory,
  withTriage,
  worstTriage,
  NON_SHIPPED_PATH_SEGMENTS,
  TRIAGE_ORDER
} from '../triage';

function facts(over: Partial<AdvisoryFacts> = {}): AdvisoryFacts {
  return {
    id:              'GHSA-xxxx@lodash',
    packageName:     'lodash',
    ecosystem:       'npm',
    ghsa:            'GHSA-xxxx',
    cve:             'CVE-2021-0001',
    summary:         'Prototype pollution',
    severity:        'high',
    manifest:        'yarn.lock',
    vulnerableRange: '< 4.17.21',
    patchedVersion:  '4.17.21',
    scope:           'runtime',
    relationship:    'transitive',
    state:           'open',
    createdAt:       '2025-01-01T00:00:00Z',
    closedAt:        null,
    url:             'https://github.com/x/y/security/dependabot/1',
    ...over,
  };
}

function pr(over: Partial<PrFix> = {}): PrFix {
  return {
    name:    'lodash',
    version: '4.17.21',
    number:  42,
    title:   'Bump lodash from 4.17.20 to 4.17.21 in /shell',
    url:     'https://github.com/x/y/pull/42',
    draft:   false,
    ...over,
  };
}

describe('matchingPr', () => {
  it('matches a PR bumping the package to the patched version', () => {
    expect(matchingPr(facts(), [pr()])?.number).toBe(42);
  });

  it('matches a PR that overshoots the patched version', () => {
    // A bump past the fix still closes the advisory.
    expect(matchingPr(facts({ patchedVersion: '4.17.21' }), [pr({ version: '4.18.0' })])).not.toBeNull();
  });

  it('does not match a PR that falls short', () => {
    expect(matchingPr(facts({ patchedVersion: '4.17.21' }), [pr({ version: '4.17.20' })])).toBeNull();
  });

  it('does not match a PR for a different package', () => {
    expect(matchingPr(facts(), [pr({ name: 'handlebars' })])).toBeNull();
  });

  it('matches a routine bump, not only a security PR', () => {
    // `handlebars` 4.7.10 landed on rancher/dashboard as an ordinary version
    // bump and happens to clear three open advisories.
    const advisory = facts({ packageName: 'handlebars', patchedVersion: '4.7.7' });

    expect(matchingPr(advisory, [pr({ name: 'handlebars', version: '4.7.10' })])).not.toBeNull();
  });

  it('has nothing to match against when there is no published fix', () => {
    expect(matchingPr(facts({ patchedVersion: null }), [pr()])).toBeNull();
  });

  it('returns null rather than undefined for an empty PR list', () => {
    expect(matchingPr(facts(), [])).toBeNull();
  });
});

describe('triageAdvisory', () => {
  it('is no-fix when nothing is published', () => {
    expect(triageAdvisory(facts({ patchedVersion: null }), [pr()])).toBe('no-fix');
  });

  it('is fix-ready when a fix exists but nobody has raised the PR', () => {
    expect(triageAdvisory(facts(), [])).toBe('fix-ready');
  });

  it('is in-review once a PR would close it', () => {
    expect(triageAdvisory(facts(), [pr()])).toBe('in-review');
  });

  it('still counts a draft PR as in review', () => {
    // Someone has acted; it needs a reviewer, not an author.
    expect(triageAdvisory(facts(), [pr({ draft: true })])).toBe('in-review');
  });
});

describe('worstTriage', () => {
  it('ranks fix-ready above in-review, because nothing is moving on it', () => {
    expect(worstTriage(['in-review', 'fix-ready', 'no-fix'])).toBe('fix-ready');
  });

  it('prefers in-review over no-fix', () => {
    expect(worstTriage(['no-fix', 'in-review'])).toBe('in-review');
  });

  it('is no-fix when that is all there is, and for an empty list', () => {
    expect(worstTriage(['no-fix', 'no-fix'])).toBe('no-fix');
    expect(worstTriage([])).toBe('no-fix');
  });

  it('follows TRIAGE_ORDER rather than a separate ranking', () => {
    expect([...TRIAGE_ORDER]).toEqual(['fix-ready', 'in-review', 'no-fix']);
    TRIAGE_ORDER.forEach((status, i) => {
      expect(worstTriage(TRIAGE_ORDER.slice(i))).toBe(status);
    });
  });
});

describe('emptyTriageCounts', () => {
  it('starts every status at zero rather than undefined', () => {
    expect(emptyTriageCounts()).toEqual({
      'fix-ready': 0, 'in-review': 0, 'no-fix': 0
    });
  });

  it('hands back a fresh object each time', () => {
    const first = emptyTriageCounts();

    first['no-fix'] = 9;

    expect(emptyTriageCounts()['no-fix']).toBe(0);
  });
});

describe('withTriage', () => {
  it('fills in all three derived fields at once', () => {
    const result = withTriage(facts(), [pr()]);

    expect(result.triage).toBe('in-review');
    expect(result.exposure).toBe('shipped');
    expect(result.prFix?.number).toBe(42);
  });

  it('is safe to re-run on an already-derived advisory', () => {
    // Called once while the finding is built with no PRs known, then again
    // when the repo's PRs arrive.
    const first = withTriage(facts(), []);

    expect(first.triage).toBe('fix-ready');
    expect(first.prFix).toBeNull();

    const second = withTriage(first, [pr()]);

    expect(second.triage).toBe('in-review');
    expect(second.prFix?.number).toBe(42);
  });

  it('leaves the underlying facts untouched', () => {
    const input = facts();
    const result = withTriage(input, [pr()]);

    expect(result.packageName).toBe(input.packageName);
    expect(result.severity).toBe(input.severity);
    expect(input).not.toHaveProperty('triage');
  });
});

describe('exposureOf', () => {
  it('is tooling for a declared development dependency', () => {
    expect(exposureOf(facts({ scope: 'development' }))).toBe('tooling');
  });

  it('outranks the manifest path with an explicit development scope', () => {
    expect(exposureOf(facts({ scope: 'development', manifest: 'yarn.lock' }))).toBe('tooling');
  });

  it('is tooling for a lockfile under a non-shipped directory', () => {
    expect(exposureOf(facts({ manifest: 'cypress/yarn.lock' }))).toBe('tooling');
    expect(exposureOf(facts({ manifest: 'docusaurus/yarn.lock' }))).toBe('tooling');
  });

  it('is shipped for a runtime dependency in a shipped lockfile', () => {
    expect(exposureOf(facts({ manifest: 'shell/yarn.lock' }))).toBe('shipped');
  });

  it('is unknown for a public-data row with nothing to judge it on', () => {
    // An SBOM carries no manifest and no scope; calling that shipped would
    // invent a fact.
    expect(exposureOf(facts({ manifest: null, scope: null }))).toBe('unknown');
  });

  it('is shipped for a scoped runtime dependency with no manifest', () => {
    expect(exposureOf(facts({ manifest: null, scope: 'runtime' }))).toBe('shipped');
  });
});

describe('nonShippedSegment', () => {
  it('names the directory that made the call, so a reader can disagree', () => {
    expect(nonShippedSegment('cypress/yarn.lock')).toBe('cypress');
    expect(nonShippedSegment('pkg/thing/__tests__/package.json')).toBe('__tests__');
  });

  it('ignores the filename, only the directories', () => {
    // A lockfile literally called `test` says nothing about what ships.
    expect(nonShippedSegment('test')).toBeNull();
    expect(nonShippedSegment('shell/test')).toBeNull();
    expect(nonShippedSegment('docs/yarn.lock')).toBe('docs');
  });

  it('is case-insensitive', () => {
    expect(nonShippedSegment('Cypress/yarn.lock')).toBe('Cypress');
    expect(nonShippedSegment('DOCS/yarn.lock')).toBe('DOCS');
  });

  it('is null for a shipped path and for no path at all', () => {
    expect(nonShippedSegment('shell/yarn.lock')).toBeNull();
    expect(nonShippedSegment('yarn.lock')).toBeNull();
    expect(nonShippedSegment(null)).toBeNull();
  });

  it('matches a non-shipped segment anywhere in the path', () => {
    expect(nonShippedSegment('a/b/storybook/c/yarn.lock')).toBe('storybook');
  });

  it('only matches whole segments', () => {
    // `docsite` is not `docs`.
    expect(nonShippedSegment('docsite/yarn.lock')).toBeNull();
    expect(nonShippedSegment('my-tests/yarn.lock')).toBeNull();
  });

  it('covers the segments the comment claims it does', () => {
    ['cypress', 'docusaurus', 'e2e', 'tests', 'docs', 'storybook', 'scripts'].forEach((segment) => {
      expect(NON_SHIPPED_PATH_SEGMENTS.has(segment)).toBe(true);
    });
  });
});

describe('remediationCommand', () => {
  it('prints a yarn upgrade for a direct dependency', () => {
    expect(remediationCommand(facts({ relationship: 'direct' }))).toEqual({
      command: 'yarn upgrade lodash@^4.17.21', kind: 'command', file: null
    });
  });

  it('reads the package manager off the lockfile name', () => {
    expect(remediationCommand(facts({ relationship: 'direct', manifest: 'package-lock.json' })))
      .toMatchObject({ command: 'npm install lodash@^4.17.21' });
    expect(remediationCommand(facts({ relationship: 'direct', manifest: 'pnpm-lock.yaml' })))
      .toMatchObject({ command: 'pnpm upgrade lodash@^4.17.21' });
    expect(remediationCommand(facts({ relationship: 'direct', manifest: 'npm-shrinkwrap.json' })))
      .toMatchObject({ command: 'npm install lodash@^4.17.21' });
  });

  it('assumes yarn for a bare package.json', () => {
    // Dependabot files direct alerts against `package.json`, which names no
    // manager; every repo this page reads resolves through a `yarn.lock`.
    expect(remediationCommand(facts({ relationship: 'direct', manifest: 'package.json' })))
      .toMatchObject({ command: 'yarn upgrade lodash@^4.17.21' });
  });

  it('prints a resolutions entry for a transitive dependency, not an upgrade', () => {
    // `yarn upgrade` does not move a transitive dependency, and all 18 of
    // rancher/dashboard's open alerts are transitive.
    expect(remediationCommand(facts())).toEqual({
      command: '"resolutions": { "lodash": "^4.17.21" }',
      kind:    'manifest',
      file:    'package.json',
    });
  });

  it('uses each manager\'s own override field', () => {
    expect(remediationCommand(facts({ manifest: 'package-lock.json' })))
      .toMatchObject({ command: '"overrides": { "lodash": "^4.17.21" }' });
    expect(remediationCommand(facts({ manifest: 'pnpm-lock.yaml' })))
      .toMatchObject({ command: '"pnpm": { "overrides": { "lodash": "^4.17.21" } }' });
  });

  it('points the edit at the package.json beside the lockfile', () => {
    expect(remediationCommand(facts({ manifest: 'shell/yarn.lock' })))
      .toMatchObject({ file: 'shell/package.json' });
    expect(remediationCommand(facts({ manifest: 'a/b/yarn.lock' })))
      .toMatchObject({ file: 'a/b/package.json' });
  });

  it('treats an unstated relationship as transitive, which is the safe way round', () => {
    expect(remediationCommand(facts({ relationship: null }))?.kind).toBe('manifest');
  });

  it('says nothing for a non-npm ecosystem', () => {
    // A plausible-looking command for the wrong toolchain is worse than none.
    expect(remediationCommand(facts({ ecosystem: 'Go' }))).toBeNull();
    expect(remediationCommand(facts({ ecosystem: 'PyPI' }))).toBeNull();
    expect(remediationCommand(facts({ ecosystem: 'Maven' }))).toBeNull();
  });

  it('is case-insensitive about the ecosystem name', () => {
    expect(remediationCommand(facts({ ecosystem: 'NPM' }))).not.toBeNull();
  });

  it('says nothing when there is no fix or no manifest', () => {
    expect(remediationCommand(facts({ patchedVersion: null }))).toBeNull();
    expect(remediationCommand(facts({ manifest: null }))).toBeNull();
  });
});

describe('applyPrs', () => {
  function group(advisories: Advisory[]): PackageGroup {
    return {
      id:            'npm/lodash',
      name:          'lodash',
      ecosystem:     'npm',
      worstSeverity: 'high',
      advisories,
      counts:        {
        critical: 0, high: advisories.length, medium: 0, low: 0, unknown: 0
      },
      manifests:      ['yarn.lock'],
      patchedVersion: '4.17.21',
      scope:          'runtime',
      oldest:         '2025-01-01T00:00:00Z',
      triage:         'fix-ready',
    };
  }

  function repo(groups: PackageGroup[]): RepoSecurity {
    return {
      id:     'dashboard',
      repo:   'rancher/dashboard',
      label:  'dashboard',
      source: 'dependabot',
      groups,
      counts: {
        critical: 0, high: 1, medium: 0, low: 0, unknown: 0
      },
      openTotal:    1,
      triageCounts: emptyTriageCounts(),
      oldestOpen:   '2025-01-01T00:00:00Z',
      history:      null,
      unresolved:   0,
      fetchedAt:    '2025-02-01T00:00:00Z',
    };
  }

  it('re-judges every advisory against the repo\'s open PRs', () => {
    const before = repo([group([withTriage(facts(), [])])]);

    expect(before.groups[0].advisories[0].triage).toBe('fix-ready');

    const after = applyPrs(before, [pr()]);

    expect(after.groups[0].advisories[0].triage).toBe('in-review');
    expect(after.groups[0].advisories[0].prFix?.number).toBe(42);
  });

  it('rolls the group status up to whichever leaves the most to do', () => {
    // One advisory in a PR, one whose fix nobody has raised — rolling up to
    // `in-review` would say the package was handled.
    const advisories = [
      withTriage(facts({ id: 'a' }), []),
      withTriage(facts({ id: 'b', patchedVersion: '5.0.0' }), []),
    ];

    const after = applyPrs(repo([group(advisories)]), [pr()]);

    expect(after.groups[0].advisories.map((a) => a.triage)).toEqual(['in-review', 'fix-ready']);
    expect(after.groups[0].triage).toBe('fix-ready');
  });

  it('recounts the whole repo rather than adjusting the old tally', () => {
    const advisories = [
      withTriage(facts({ id: 'a' }), []),
      withTriage(facts({
        id: 'b', packageName: 'handlebars', patchedVersion: null
      }), []),
    ];

    const after = applyPrs(repo([group(advisories)]), [pr()]);

    expect(after.triageCounts).toEqual({
      'in-review': 1, 'fix-ready': 0, 'no-fix': 1
    });
  });

  it('matches per package across the repo, not per lockfile', () => {
    // The commit trailer names the package and version, never the directory.
    const advisories = [
      withTriage(facts({ id: 'a', manifest: 'shell/yarn.lock' }), []),
      withTriage(facts({ id: 'b', manifest: 'cypress/yarn.lock' }), []),
    ];

    const after = applyPrs(repo([group(advisories)]), [pr()]);

    expect(after.groups[0].advisories.map((a) => a.triage)).toEqual(['in-review', 'in-review']);
  });

  it('returns a new object and leaves the input alone', () => {
    const before = repo([group([withTriage(facts(), [])])]);
    const after = applyPrs(before, [pr()]);

    expect(after).not.toBe(before);
    expect(after.groups).not.toBe(before.groups);
    expect(before.groups[0].advisories[0].triage).toBe('fix-ready');
  });

  it('leaves everything fix-ready when no PRs could be listed', () => {
    // Overstates the work rather than hiding any of it.
    const after = applyPrs(repo([group([withTriage(facts(), [pr()])])]), []);

    expect(after.groups[0].advisories[0].triage).toBe('fix-ready');
    expect(after.groups[0].advisories[0].prFix).toBeNull();
  });

  it('copes with a repo that has no groups', () => {
    const after = applyPrs(repo([]), [pr()]);

    expect(after.groups).toEqual([]);
    expect(after.triageCounts).toEqual(emptyTriageCounts());
  });
});
