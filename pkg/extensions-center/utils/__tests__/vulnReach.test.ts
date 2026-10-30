import { BundleAnalysisDoc, BundlePackage, ExtensionBundle } from '../../types/analysis';
import { Advisory, PackageGroup, RepoSecurity, Severity } from '../../types/security';
import { emptyCounts } from '../severity';
import { emptyTriageCounts } from '../triage';
import { buildReach } from '../vulnReach';

function advisory(over: Partial<Advisory> = {}): Advisory {
  return {
    id:              'GHSA-1@lodash',
    packageName:     'lodash',
    ecosystem:       'npm',
    ghsa:            'GHSA-1',
    cve:             null,
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
    triage:          'fix-ready',
    exposure:        'shipped',
    prFix:           null,
    ...over,
  };
}

function group(name: string, advisories: Advisory[], over: Partial<PackageGroup> = {}): PackageGroup {
  const counts = emptyCounts();

  advisories.forEach((a) => counts[a.severity]++);

  return {
    id:             `npm/${ name }`,
    name,
    ecosystem:      'npm',
    worstSeverity:  advisories[0]?.severity || 'unknown',
    advisories,
    counts,
    manifests:      ['yarn.lock'],
    patchedVersion: '4.17.21',
    scope:          'runtime',
    oldest:         '2025-01-01T00:00:00Z',
    triage:         'fix-ready',
    ...over,
  };
}

function repo(id: string, groups: PackageGroup[], over: Partial<RepoSecurity> = {}): RepoSecurity {
  return {
    id,
    repo:         `rancher/${ id }`,
    label:        id,
    source:       'dependabot',
    groups,
    counts:       emptyCounts(),
    openTotal:    groups.reduce((n, g) => n + g.advisories.length, 0),
    triageCounts: emptyTriageCounts(),
    oldestOpen:   '2025-01-01T00:00:00Z',
    history:      null,
    unresolved:   0,
    fetchedAt:    '2025-02-01T00:00:00Z',
    ...over,
  };
}

function pkg(over: Partial<BundlePackage> = {}): BundlePackage {
  return {
    pkg:      'lodash',
    category: 'external-lib',
    bytes:    1000,
    files:    4,
    cause:    'extension-dep',
    versions: ['4.17.20'],
    ...over,
  };
}

function bundle(name: string, byPackage: BundlePackage[] | null, over: Partial<ExtensionBundle> = {}): ExtensionBundle {
  return {
    name,
    repo:             `rancher/${ name }`,
    semver:           '1.0.0',
    inManifest:       true,
    pluginDir:        `${ name }/1.0.0`,
    chunkCount:       3,
    totalBundleBytes: 5000,
    chunks:           [],
    hasSourceMaps:    true,
    byCategory:       null,
    byCause:          null,
    byPackage,
    leaks:            null,
    totalSourceBytes: 10_000,
    ratio:            0.5,
    shellCausedBytes: 0,
    ...over,
  };
}

function doc(extensions: ExtensionBundle[]): BundleAnalysisDoc {
  return {
    version: 1, fetchedAt: '2025-02-01T00:00:00Z', extensions
  };
}

describe('buildReach — which advisories make a row', () => {
  it('makes one row per vulnerable package', () => {
    const summary = buildReach([repo('a', [
      group('lodash', [advisory()]),
      group('js-yaml', [advisory({
        id: 'b', ghsa: 'GHSA-2', packageName: 'js-yaml'
      })]),
    ])], null);

    expect(summary.rows.map((r) => r.pkg).sort()).toEqual(['js-yaml', 'lodash']);
  });

  it('merges the same package across repos into one row', () => {
    const summary = buildReach([
      repo('a', [group('lodash', [advisory({ id: 'a', ghsa: 'GHSA-1' })])]),
      repo('b', [group('lodash', [advisory({ id: 'b', ghsa: 'GHSA-2' })])]),
    ], null);

    expect(summary.rows).toHaveLength(1);
    expect(summary.rows[0].advisories).toHaveLength(2);
    expect(summary.rows[0].repos.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('counts one GHSA once however many targets report it', () => {
    // Two targets can be slices of one monorepo, and public-data repos dedupe
    // nothing — counting it twice would inflate the number people quote.
    const summary = buildReach([
      repo('dashboard', [group('lodash', [advisory()])]),
      repo('shell', [group('lodash', [advisory()])]),
    ], null);

    expect(summary.rows[0].advisories).toHaveLength(1);
    expect(summary.rows[0].counts.high).toBe(1);
  });

  it('takes the worst severity seen in any repo', () => {
    const summary = buildReach([
      repo('a', [group('lodash', [advisory({ severity: 'low' })], { worstSeverity: 'low' })]),
      repo('b', [group('lodash', [advisory({
        id: 'b', ghsa: 'GHSA-2', severity: 'critical'
      })], { worstSeverity: 'critical' })]),
    ], null);

    expect(summary.rows[0].worstSeverity).toBe('critical');
  });

  it('skips a repo that could not be read at all', () => {
    const summary = buildReach([
      repo('a', [group('lodash', [advisory()])], { error: 'HTTP 404' }),
    ], null);

    expect(summary.rows).toEqual([]);
  });

  it('skips ecosystems a browser bundle cannot contain', () => {
    // A Go advisory on a repo that also builds a UI is real, but listing it
    // here would claim a reach analysis that was never done.
    const summary = buildReach([repo('a', [
      group('lodash', [advisory()]),
      group('golang.org/x/net', [advisory({
        id: 'g', ghsa: 'GHSA-G', packageName: 'golang.org/x/net'
      })], { ecosystem: 'Go' }),
    ])], null);

    expect(summary.rows.map((r) => r.pkg)).toEqual(['lodash']);
  });

  it('is case-insensitive about the npm ecosystem name', () => {
    const summary = buildReach([repo('a', [group('lodash', [advisory()], { ecosystem: 'NPM' })])], null);

    expect(summary.rows).toHaveLength(1);
  });
});

describe('buildReach — joining against the bundles', () => {
  it('reports the bundles a vulnerable package was found inside', () => {
    const summary = buildReach(
      [repo('a', [group('lodash', [advisory()])])],
      doc([bundle('harvester', [pkg()])]),
    );

    expect(summary.rows[0].shipped).toEqual([{
      ext:       'harvester',
      repo:      'rancher/harvester',
      semver:    '1.0.0',
      bytes:     1000,
      diskBytes: 500,
      cause:     'extension-dep',
      versions:  ['4.17.20'],
      verdict:   'hit',
    }]);
  });

  it('matches across repos, not only the one that raised the advisory', () => {
    // Several extensions cannot run Dependabot for us at all, which is exactly
    // the blind spot this is for.
    const summary = buildReach(
      [repo('dashboard', [group('lodash', [advisory()])])],
      doc([bundle('elemental', [pkg()])]),
    );

    expect(summary.rows[0].shipped.map((h) => h.ext)).toEqual(['elemental']);
  });

  it('scales source bytes by the bundle\'s own ratio', () => {
    const summary = buildReach(
      [repo('a', [group('lodash', [advisory()])])],
      doc([
        bundle('one', [pkg({ bytes: 1000 })], { ratio: 0.2971 }),
        bundle('two', [pkg({ bytes: 1000 })], { ratio: 0.6619 }),
      ]),
    );

    expect(summary.rows[0].shipped.map((h) => h.diskBytes).sort((a, b) => Number(a) - Number(b))).toEqual([297, 662]);
  });

  it('leaves disk bytes null when the bundle has no ratio', () => {
    const summary = buildReach(
      [repo('a', [group('lodash', [advisory()])])],
      doc([bundle('one', [pkg()], { ratio: null })]),
    );

    expect(summary.rows[0].shipped[0].diskBytes).toBeNull();
    expect(summary.rows[0].shippedBytes).toBeNull();
  });

  it('totals only the bundles that could be measured', () => {
    const summary = buildReach(
      [repo('a', [group('lodash', [advisory()])])],
      doc([
        bundle('one', [pkg({ bytes: 1000 })], { ratio: 0.5 }),
        bundle('two', [pkg({ bytes: 4000 })], { ratio: null }),
      ]),
    );

    expect(summary.rows[0].shippedBytes).toBe(500);
  });

  it('puts the biggest bundle first, by download size where it is known', () => {
    const summary = buildReach(
      [repo('a', [group('lodash', [advisory()])])],
      doc([
        bundle('small', [pkg({ bytes: 1000 })], { ratio: 0.5 }),
        bundle('big', [pkg({ bytes: 1000 })], { ratio: 0.9 }),
      ]),
    );

    expect(summary.rows[0].shipped.map((h) => h.ext)).toEqual(['big', 'small']);
  });

  it('ignores the names the analyser invents, which can never be a package', () => {
    const summary = buildReach(
      [repo('a', [group('webpack-runtime', [advisory({ packageName: 'webpack-runtime' })])])],
      doc([bundle('one', [pkg({ pkg: 'webpack-runtime' })])]),
    );

    expect(summary.rows[0].shipped).toEqual([]);
  });

  it('ignores the extension\'s own code', () => {
    const summary = buildReach(
      [repo('a', [group('lodash', [advisory()])])],
      doc([bundle('one', [pkg({ cause: 'extension-code' })])]),
    );

    expect(summary.rows[0].shipped).toEqual([]);
  });

  it('counts only the bundles it could actually join against', () => {
    const summary = buildReach(
      [repo('a', [group('lodash', [advisory()])])],
      doc([
        bundle('analysed', [pkg()]),
        bundle('no-maps', null),
        bundle('empty', []),
      ]),
    );

    expect(summary.bundlesJoined).toBe(1);
  });

  it('still produces rows with no bundle data at all', () => {
    const summary = buildReach([repo('a', [group('lodash', [advisory()])])], null);

    expect(summary.rows[0].shipped).toEqual([]);
    expect(summary.rows[0].verdict).toBe('miss');
    expect(summary.bundlesJoined).toBe(0);
  });
});

describe('buildReach — the verdict', () => {
  it('is a hit when every shipped version is inside the vulnerable range', () => {
    const summary = buildReach(
      [repo('a', [group('lodash', [advisory({ vulnerableRange: '< 4.17.21' })])])],
      doc([bundle('one', [pkg({ versions: ['4.17.19', '4.17.20'] })])]),
    );

    expect(summary.rows[0].verdict).toBe('hit');
    expect(summary.confirmed).toBe(1);
  });

  it('is partial when a lockfile resolved the package both ways', () => {
    // Reporting that as a plain hit overstates it; as a miss it hides a real
    // exposure.
    const summary = buildReach(
      [repo('a', [group('lodash', [advisory({ vulnerableRange: '< 4.17.21' })])])],
      doc([bundle('one', [pkg({ versions: ['4.17.20', '4.17.21'] })])]),
    );

    expect(summary.rows[0].verdict).toBe('partial');
    expect(summary.confirmed).toBe(1);
  });

  it('is a miss when the shipped version is already past the range', () => {
    const summary = buildReach(
      [repo('a', [group('lodash', [advisory({ vulnerableRange: '< 4.17.21' })])])],
      doc([bundle('one', [pkg({ versions: ['4.17.21'] })])]),
    );

    expect(summary.rows[0].verdict).toBe('miss');
    expect(summary.confirmed).toBe(0);
  });

  it('is unknown when the lockfile could not be read', () => {
    // Shown as "version unconfirmed" rather than dropped: a package that ships
    // and might be vulnerable still outranks one that does not ship.
    const summary = buildReach(
      [repo('a', [group('lodash', [advisory()])])],
      doc([bundle('one', [pkg({ versions: [] })])]),
    );

    expect(summary.rows[0].verdict).toBe('unknown');
    expect(summary.unconfirmed).toBe(1);
  });

  it('is unknown when the advisory\'s range is in a form this cannot parse', () => {
    const summary = buildReach(
      [repo('a', [group('lodash', [advisory({ vulnerableRange: '^4.0.0' })])])],
      doc([bundle('one', [pkg({ versions: ['4.17.20'] })])]),
    );

    expect(summary.rows[0].verdict).toBe('unknown');
  });

  it('takes the most alarming verdict across every advisory on the package', () => {
    const summary = buildReach(
      [repo('a', [group('lodash', [
        advisory({
          id: 'a', ghsa: 'GHSA-1', vulnerableRange: '< 4.0.0'
        }),
        advisory({
          id: 'b', ghsa: 'GHSA-2', vulnerableRange: '< 4.17.21'
        }),
      ])])],
      doc([bundle('one', [pkg({ versions: ['4.17.20'] })])]),
    );

    expect(summary.rows[0].shipped[0].verdict).toBe('hit');
  });

  it('takes the most alarming verdict across every bundle', () => {
    const summary = buildReach(
      [repo('a', [group('lodash', [advisory({ vulnerableRange: '< 4.17.21' })])])],
      doc([
        bundle('clean', [pkg({ versions: ['4.17.21'], bytes: 100 })]),
        bundle('stale', [pkg({ versions: ['4.17.20'], bytes: 50 })]),
      ]),
    );

    expect(summary.rows[0].verdict).toBe('hit');
  });
});

describe('buildReach — order and totals', () => {
  it('puts what ships above what does not, regardless of severity', () => {
    // A critical on something no user downloads is lockfile hygiene; a high
    // one inside every extension is an incident.
    const summary = buildReach(
      [repo('a', [
        group('unused', [advisory({
          id: 'u', ghsa: 'GHSA-U', packageName: 'unused', severity: 'critical'
        })], { worstSeverity: 'critical' }),
        group('lodash', [advisory({ vulnerableRange: '< 4.17.21' })]),
      ])],
      doc([bundle('one', [pkg({ versions: ['4.17.20'] })])]),
    );

    expect(summary.rows.map((r) => r.pkg)).toEqual(['lodash', 'unused']);
  });

  it('ranks by severity among packages with the same verdict', () => {
    const severities: Severity[] = ['low', 'critical', 'medium'];
    const summary = buildReach(
      [repo('a', [...severities].map((severity, i) => group(`pkg-${ i }`, [advisory({
        id: `a${ i }`, ghsa: `GHSA-${ i }`, packageName: `pkg-${ i }`, severity
      })], { worstSeverity: severity })))],
      null,
    );

    expect(summary.rows.map((r) => r.worstSeverity)).toEqual(['critical', 'medium', 'low']);
  });

  it('breaks a tie on how many bundles carry it, then on name', () => {
    const summary = buildReach(
      [repo('a', [
        group('zzz', [advisory({
          id: 'z', ghsa: 'GHSA-Z', packageName: 'zzz'
        })]),
        group('aaa', [advisory({
          id: 'a', ghsa: 'GHSA-A', packageName: 'aaa'
        })]),
        group('wide', [advisory({
          id: 'w', ghsa: 'GHSA-W', packageName: 'wide'
        })]),
      ])],
      doc([
        bundle('one', [pkg({ pkg: 'wide', versions: [] })]),
        bundle('two', [pkg({ pkg: 'wide', versions: [] })]),
        bundle('three', [pkg({ pkg: 'zzz', versions: [] })]),
        bundle('four', [pkg({ pkg: 'aaa', versions: [] })]),
      ]),
    );

    expect(summary.rows.map((r) => r.pkg)).toEqual(['wide', 'aaa', 'zzz']);
  });

  it('splits the totals three ways, which is what the tiles report', () => {
    const summary = buildReach(
      [repo('a', [
        group('hit-pkg', [advisory({
          id: 'h', ghsa: 'GHSA-H', packageName: 'hit-pkg', vulnerableRange: '< 4.17.21'
        })]),
        group('unknown-pkg', [advisory({
          id: 'u', ghsa: 'GHSA-U', packageName: 'unknown-pkg'
        })]),
        group('absent-pkg', [advisory({
          id: 'n', ghsa: 'GHSA-N', packageName: 'absent-pkg'
        })]),
      ])],
      doc([bundle('one', [
        pkg({ pkg: 'hit-pkg', versions: ['4.17.20'] }),
        pkg({ pkg: 'unknown-pkg', versions: [] }),
      ])]),
    );

    expect(summary).toMatchObject({
      confirmed: 1, unconfirmed: 1, notShipped: 1, bundlesJoined: 1
    });
  });

  it('has nothing to say about no repos', () => {
    expect(buildReach([], null)).toEqual({
      rows: [], confirmed: 0, unconfirmed: 0, notShipped: 0, bundlesJoined: 0
    });
  });
});
