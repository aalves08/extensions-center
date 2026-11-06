import { INVENTORY_SUGGESTION_LIMIT } from '../../config/constants';
import { BundleAnalysisDoc, BundlePackage, ExtensionBundle } from '../../types/analysis';
import { InventoryDoc, InventoryExtension } from '../../types/inventory';
import { Advisory, PackageGroup, RepoSecurity } from '../../types/security';
import { parseQuery, searchInventory } from '../inventorySearch';
import { emptyCounts } from '../severity';
import { emptyTriageCounts } from '../triage';

function ext(name: string, packages: Record<string, string[]>, over: Partial<InventoryExtension> = {}): InventoryExtension {
  return {
    name,
    repo:     `rancher/${ name }`,
    tag:      'v1.0.0',
    semver:   '1.0.0',
    source:   'release',
    lockfile: 'yarn.lock',
    packages,
    ...over,
  };
}

function inventory(extensions: InventoryExtension[]): InventoryDoc {
  return {
    version: 1, fetchedAt: '2025-02-01T00:00:00Z', extensions
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
    chunkCount:       1,
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

function bundleDoc(extensions: ExtensionBundle[]): BundleAnalysisDoc {
  return {
    version: 1, fetchedAt: '2025-02-01T00:00:00Z', extensions
  };
}

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

function repo(name: string, groups: PackageGroup[], over: Partial<RepoSecurity> = {}): RepoSecurity {
  return {
    id:           name,
    repo:         `rancher/${ name }`,
    label:        name,
    source:       'dependabot',
    groups,
    counts:       emptyCounts(),
    openTotal:    0,
    triageCounts: emptyTriageCounts(),
    oldestOpen:   null,
    history:      null,
    unresolved:   0,
    fetchedAt:    '2025-02-01T00:00:00Z',
    ...over,
  };
}

function group(name: string, advisories: Advisory[]): PackageGroup {
  return {
    id:             `npm/${ name }`,
    name,
    ecosystem:      'npm',
    worstSeverity:  'high',
    advisories,
    counts:         emptyCounts(),
    manifests:      ['yarn.lock'],
    patchedVersion: '4.17.21',
    scope:          'runtime',
    oldest:         null,
    triage:         'fix-ready',
  };
}

describe('parseQuery', () => {
  it('splits a name from a range on the last @', () => {
    expect(parseQuery('lodash@<4.17.21')).toEqual({ name: 'lodash', range: '<4.17.21' });
  });

  it('keeps a scoped name whole', () => {
    // The separator has to be the *last* `@`, because a scoped name opens
    // with one.
    expect(parseQuery('@scope/pkg@^1.0.0')).toEqual({ name: '@scope/pkg', range: '^1.0.0' });
    expect(parseQuery('@rancher/shell')).toEqual({ name: '@rancher/shell', range: null });
  });

  it('takes a bare name with no version', () => {
    expect(parseQuery('chalk')).toEqual({ name: 'chalk', range: null });
  });

  it('trims whitespace and the quotes a paste brings with it', () => {
    expect(parseQuery('  "lodash@< 4.17.21"  ')).toEqual({ name: 'lodash', range: '< 4.17.21' });
  });

  it('treats a trailing @ as no range rather than an empty one', () => {
    expect(parseQuery('lodash@')).toEqual({ name: 'lodash', range: null });
  });

  it('has nothing to search for when nothing was typed', () => {
    expect(parseQuery('')).toBeNull();
    expect(parseQuery('   ')).toBeNull();
    expect(parseQuery(null as unknown as string)).toBeNull();
  });
});

describe('searchInventory — finding the package', () => {
  it('reports every extension whose lockfile resolved the name', () => {
    const result = searchInventory(
      { name: 'lodash', range: null },
      inventory([
        ext('alpha', { lodash: ['4.17.20'] }),
        ext('beta', { chalk: ['5.0.0'] }),
        ext('gamma', { lodash: ['4.17.21', '3.10.1'] }),
      ]),
      null,
      [],
    );

    expect(result.hits.map((h) => h.ext)).toEqual(['alpha', 'gamma']);
    expect(result.hits[1].versions).toEqual(['4.17.21', '3.10.1']);
    expect(result.searched).toBe(3);
  });

  it('matches the name exactly rather than by substring', () => {
    const result = searchInventory(
      { name: 'yaml', range: null },
      inventory([ext('alpha', { 'js-yaml': ['4.1.0'] })]),
      null,
      [],
    );

    expect(result.hits).toEqual([]);
  });

  it('carries the ref each answer was read at, so a row can show its own source', () => {
    const result = searchInventory(
      { name: 'lodash', range: null },
      inventory([ext('harvester', { lodash: ['4.17.20'] }, {
        tag: 'v1.9.0', semver: '1.9.0', source: 'branch', lockfile: 'pkg/harvester/yarn.lock'
      })]),
      null,
      [],
    );

    expect(result.hits[0]).toMatchObject({
      repo: 'rancher/harvester', tag: 'v1.9.0', semver: '1.9.0', source: 'branch', lockfile: 'pkg/harvester/yarn.lock'
    });
  });

  it('names the extensions it could not read rather than ignoring them', () => {
    // "Not found" has to be qualified by how much was actually looked at.
    const result = searchInventory(
      { name: 'lodash', range: null },
      inventory([
        ext('alpha', { lodash: ['4.17.20'] }),
        ext('broken', {}, { error: 'no lockfile at v1.0.0' }),
      ]),
      null,
      [],
    );

    expect(result.unreadable).toEqual(['broken']);
    expect(result.searched).toBe(2);
  });

  it('treats an extension that resolved the name to nothing as a miss', () => {
    const result = searchInventory(
      { name: 'lodash', range: null },
      inventory([ext('alpha', { lodash: [] })]),
      null,
      [],
    );

    expect(result.hits).toEqual([]);
  });

  it('has nothing to search when the inventory was never built', () => {
    expect(searchInventory({ name: 'lodash', range: null }, null, null, [])).toEqual({
      query:       { name: 'lodash', range: null },
      hits:        [],
      searched:    0,
      unreadable:  [],
      suggestions: [],
    });
  });
});

describe('searchInventory — the version question', () => {
  it('says nothing about versions when the query named none', () => {
    // Null is not `unknown`: there was no question, rather than a question
    // that could not be answered.
    const result = searchInventory(
      { name: 'lodash', range: null },
      inventory([ext('alpha', { lodash: ['4.17.20'] })]),
      null,
      [],
    );

    expect(result.hits[0].verdict).toBeNull();
  });

  it('confirms a resolved version inside the range', () => {
    const result = searchInventory(
      { name: 'lodash', range: '< 4.17.21' },
      inventory([ext('alpha', { lodash: ['4.17.20'] })]),
      null,
      [],
    );

    expect(result.hits[0].verdict).toBe('hit');
  });

  it('reports a lockfile that resolved it both ways as partial', () => {
    const result = searchInventory(
      { name: 'lodash', range: '< 4.17.21' },
      inventory([ext('alpha', { lodash: ['4.17.20', '4.17.21'] })]),
      null,
      [],
    );

    expect(result.hits[0].verdict).toBe('partial');
  });

  it('clears a version already past the range', () => {
    const result = searchInventory(
      { name: 'lodash', range: '< 4.17.21' },
      inventory([ext('alpha', { lodash: ['4.17.21'] })]),
      null,
      [],
    );

    expect(result.hits[0].verdict).toBe('miss');
  });

  it('is unknown for a range this cannot parse, and still reports the hit', () => {
    const result = searchInventory(
      { name: 'lodash', range: '^4.0.0' },
      inventory([ext('alpha', { lodash: ['4.17.20'] })]),
      null,
      [],
    );

    expect(result.hits[0].verdict).toBe('unknown');
    expect(result.hits).toHaveLength(1);
  });
});

describe('searchInventory — what reaches a browser', () => {
  it('marks a hit that is also inside the published bundle', () => {
    const result = searchInventory(
      { name: 'lodash', range: null },
      inventory([ext('alpha', { lodash: ['4.17.20'] })]),
      bundleDoc([bundle('alpha', [pkg({ bytes: 1000 })], { ratio: 0.5 })]),
      [],
    );

    expect(result.hits[0]).toMatchObject({
      shipped: true, shippedBytes: 500, cause: 'extension-dep'
    });
  });

  it('reports a package that is in the tree but not in any bundle', () => {
    // Most npm supply-chain attacks run from a postinstall script and never
    // reach a browser at all, so this is a real answer rather than a gap.
    const result = searchInventory(
      { name: 'lodash', range: null },
      inventory([ext('alpha', { lodash: ['4.17.20'] })]),
      bundleDoc([bundle('alpha', [pkg({ pkg: 'chalk' })])]),
      [],
    );

    expect(result.hits[0]).toMatchObject({
      shipped: false, shippedBytes: null, cause: null
    });
  });

  it('keys the bundle on the extension, not the repo', () => {
    // Two extensions out of one repo have one repo name between them but
    // their own bundles.
    const result = searchInventory(
      { name: 'lodash', range: null },
      inventory([
        ext('alpha', { lodash: ['4.17.20'] }, { repo: 'rancher/monorepo' }),
        ext('beta', { lodash: ['4.17.20'] }, { repo: 'rancher/monorepo' }),
      ]),
      bundleDoc([bundle('alpha', [pkg()], { repo: 'rancher/monorepo' })]),
      [],
    );

    expect(result.hits.map((h) => h.shipped)).toEqual([true, false]);
  });

  it('leaves the size null when the bundle has no ratio to scale by', () => {
    const result = searchInventory(
      { name: 'lodash', range: null },
      inventory([ext('alpha', { lodash: ['4.17.20'] })]),
      bundleDoc([bundle('alpha', [pkg()], { ratio: null })]),
      [],
    );

    expect(result.hits[0]).toMatchObject({ shipped: true, shippedBytes: null });
  });

  it('ignores the analyser\'s synthetic names and the extension\'s own code', () => {
    const result = searchInventory(
      { name: 'lodash', range: null },
      inventory([ext('alpha', { lodash: ['4.17.20'] })]),
      bundleDoc([bundle('alpha', [pkg({ cause: 'extension-code' })])]),
      [],
    );

    expect(result.hits[0].shipped).toBe(false);
  });
});

describe('searchInventory — advisories already open', () => {
  it('attaches the advisories raised against the package in that repo', () => {
    const result = searchInventory(
      { name: 'lodash', range: null },
      inventory([ext('alpha', { lodash: ['4.17.20'] })]),
      null,
      [repo('alpha', [group('lodash', [advisory()])])],
    );

    expect(result.hits[0].advisories.map((a) => a.ghsa)).toEqual(['GHSA-1']);
  });

  it('attaches nothing from another repo', () => {
    const result = searchInventory(
      { name: 'lodash', range: null },
      inventory([ext('alpha', { lodash: ['4.17.20'] })]),
      null,
      [repo('beta', [group('lodash', [advisory()])])],
    );

    expect(result.hits[0].advisories).toEqual([]);
  });

  it('lists one GHSA once when two targets slice the same repo', () => {
    const result = searchInventory(
      { name: 'lodash', range: null },
      inventory([ext('alpha', { lodash: ['4.17.20'] })]),
      null,
      [
        repo('target-one', [group('lodash', [advisory()])], { repo: 'rancher/alpha' }),
        repo('target-two', [group('lodash', [advisory()])], { repo: 'rancher/alpha' }),
      ],
    );

    expect(result.hits[0].advisories).toHaveLength(1);
  });

  it('skips a repo that could not be read', () => {
    const result = searchInventory(
      { name: 'lodash', range: null },
      inventory([ext('alpha', { lodash: ['4.17.20'] })]),
      null,
      [repo('alpha', [group('lodash', [advisory()])], { error: 'HTTP 404' })],
    );

    expect(result.hits[0].advisories).toEqual([]);
  });
});

describe('searchInventory — order', () => {
  it('leads with whoever is confirmed to be on the bad version', () => {
    // During an incident the ordering question is "who do I call".
    const result = searchInventory(
      { name: 'lodash', range: '< 4.17.21' },
      inventory([
        ext('clean', { lodash: ['4.17.21'] }),
        ext('mixed', { lodash: ['4.17.20', '4.17.21'] }),
        ext('bad', { lodash: ['4.17.20'] }),
      ]),
      null,
      [],
    );

    expect(result.hits.map((h) => h.ext)).toEqual(['bad', 'mixed', 'clean']);
  });

  it('puts what ships above what does not, among the unconfirmed', () => {
    const result = searchInventory(
      { name: 'lodash', range: null },
      inventory([
        ext('not-shipped', { lodash: ['4.17.20'] }),
        ext('shipped', { lodash: ['4.17.20'] }),
      ]),
      bundleDoc([bundle('shipped', [pkg()])]),
      [],
    );

    expect(result.hits.map((h) => h.ext)).toEqual(['shipped', 'not-shipped']);
  });

  it('breaks the remaining tie on name, so the order is stable between runs', () => {
    const result = searchInventory(
      { name: 'lodash', range: null },
      inventory([ext('zulu', { lodash: ['1.0.0'] }), ext('alpha', { lodash: ['1.0.0'] })]),
      null,
      [],
    );

    expect(result.hits.map((h) => h.ext)).toEqual(['alpha', 'zulu']);
  });
});

describe('searchInventory — suggestions', () => {
  it('offers near names when the exact one finds nothing', () => {
    const result = searchInventory(
      { name: 'yaml', range: null },
      inventory([ext('alpha', {
        'js-yaml': ['4.1.0'], 'yaml-loader': ['0.8.0'], lodash: ['4.17.20']
      })]),
      null,
      [],
    );

    expect(result.suggestions).toEqual(['js-yaml', 'yaml-loader']);
  });

  it('stays quiet when the search succeeded', () => {
    // A successful search should not be followed by a list of things it could
    // have been instead.
    const result = searchInventory(
      { name: 'lodash', range: null },
      inventory([ext('alpha', { lodash: ['4.17.20'], 'lodash.merge': ['4.6.2'] })]),
      null,
      [],
    );

    expect(result.suggestions).toEqual([]);
  });

  it('will not guess from a query too short to mean anything', () => {
    const result = searchInventory(
      { name: 'ya', range: null },
      inventory([ext('alpha', { 'js-yaml': ['4.1.0'] })]),
      null,
      [],
    );

    expect(result.suggestions).toEqual([]);
  });

  it('matches case-insensitively and dedupes across extensions', () => {
    const result = searchInventory(
      { name: 'YAML', range: null },
      inventory([
        ext('alpha', { 'js-yaml': ['4.1.0'] }),
        ext('beta', { 'js-yaml': ['3.14.1'] }),
      ]),
      null,
      [],
    );

    expect(result.suggestions).toEqual(['js-yaml']);
  });

  it('caps the list and shows the shortest names first', () => {
    const packages: Record<string, string[]> = {};

    for (let i = 0; i < INVENTORY_SUGGESTION_LIMIT + 5; i++) {
      packages[`yaml-${ 'x'.repeat(i) }`] = ['1.0.0'];
    }

    const result = searchInventory({ name: 'yaml', range: null }, inventory([ext('alpha', packages)]), null, []);

    expect(result.suggestions).toHaveLength(INVENTORY_SUGGESTION_LIMIT);
    expect(result.suggestions[0]).toBe('yaml-');
  });
});
