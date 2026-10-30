import { Advisory, SEVERITIES, Severity } from '../../types/security';
import {
  addCounts,
  ageInDays,
  countGroups,
  emptyCounts,
  groupByPackage,
  normaliseSeverity,
  severityRank,
  worseOf
} from '../severity';

function advisory(over: Partial<Advisory> = {}): Advisory {
  return {
    id:              'GHSA-xxxx@lodash',
    packageName:     'lodash',
    ecosystem:       'npm',
    ghsa:            'GHSA-xxxx',
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

describe('severityRank', () => {
  it('ranks most severe first, with unknown last', () => {
    expect(SEVERITIES.map(severityRank)).toEqual([0, 1, 2, 3, 4]);
  });

  it('gives every severity a rank, so a sort never compares against undefined', () => {
    SEVERITIES.forEach((severity) => expect(Number.isFinite(severityRank(severity))).toBe(true));
  });
});

describe('worseOf', () => {
  it('keeps the more severe of the two', () => {
    expect(worseOf('high', 'critical')).toBe('critical');
    expect(worseOf('critical', 'high')).toBe('critical');
    expect(worseOf('low', 'medium')).toBe('medium');
  });

  it('treats unknown as the least severe, not the most', () => {
    // `unknown` means ungraded; letting it win would make every repo with one
    // OSV record read as its worst case.
    expect(worseOf('unknown', 'low')).toBe('low');
    expect(worseOf('low', 'unknown')).toBe('low');
  });

  it('is stable when both are the same', () => {
    expect(worseOf('medium', 'medium')).toBe('medium');
  });
});

describe('emptyCounts', () => {
  it('starts every severity at zero rather than undefined', () => {
    expect(emptyCounts()).toEqual({
      critical: 0, high: 0, medium: 0, low: 0, unknown: 0
    });
  });

  it('hands back a fresh object each time', () => {
    const first = emptyCounts();

    first.high = 7;

    expect(emptyCounts().high).toBe(0);
  });
});

describe('addCounts', () => {
  it('adds in place, across every severity', () => {
    const into = emptyCounts();

    addCounts(into, {
      critical: 1, high: 2, medium: 3, low: 4, unknown: 5
    });
    addCounts(into, {
      critical: 1, high: 0, medium: 0, low: 0, unknown: 1
    });

    expect(into).toEqual({
      critical: 2, high: 2, medium: 3, low: 4, unknown: 6
    });
  });

  it('leaves the source untouched', () => {
    const from = {
      critical: 1, high: 1, medium: 1, low: 1, unknown: 1
    };

    addCounts(emptyCounts(), from);

    expect(from).toEqual({
      critical: 1, high: 1, medium: 1, low: 1, unknown: 1
    });
  });
});

describe('normaliseSeverity', () => {
  it('passes through the levels both sources agree on', () => {
    expect(normaliseSeverity('critical')).toBe('critical');
    expect(normaliseSeverity('high')).toBe('high');
    expect(normaliseSeverity('low')).toBe('low');
  });

  it('maps OSV\'s "moderate" onto "medium", which is the same thing', () => {
    expect(normaliseSeverity('moderate')).toBe('medium');
    expect(normaliseSeverity('medium')).toBe('medium');
  });

  it('reads OSV\'s upper case', () => {
    expect(normaliseSeverity('CRITICAL')).toBe('critical');
    expect(normaliseSeverity('MODERATE')).toBe('medium');
  });

  it.each([null, undefined, '', 'important', 'none'])('grades %p as unknown, not low', (raw) => {
    // `unknown` is its own level: an advisory nobody graded is not evidence of
    // low risk, and filing it as `low` is the level readers dismiss.
    expect(normaliseSeverity(raw)).toBe('unknown');
  });
});

describe('groupByPackage', () => {
  it('collapses advisories against one package into one row', () => {
    const groups = groupByPackage([
      advisory({ id: 'a', ghsa: 'GHSA-1' }),
      advisory({ id: 'b', ghsa: 'GHSA-2' }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].id).toBe('npm/lodash');
    expect(groups[0].name).toBe('lodash');
    expect(groups[0].advisories).toHaveLength(2);
    expect(groups[0].counts.high).toBe(2);
  });

  it('keys on ecosystem as well as name', () => {
    // Two different packages that happen to share a name are two rows.
    const groups = groupByPackage([
      advisory({ id: 'a' }),
      advisory({ id: 'b', ecosystem: 'Go' }),
    ]);

    expect(groups.map((g) => g.id).sort()).toEqual(['Go/lodash', 'npm/lodash']);
  });

  it('leaves out everything that is not open', () => {
    // A row reading "fixed eight months ago" is noise in a list of work to do;
    // the caller keeps the closed ones for the history series.
    const groups = groupByPackage([
      advisory({
        id: 'a', state: 'fixed', closedAt: '2025-06-01T00:00:00Z'
      }),
      advisory({ id: 'b', state: 'dismissed' }),
      advisory({ id: 'c', state: 'auto_dismissed' }),
    ]);

    expect(groups).toEqual([]);
  });

  it('takes the worst severity in the group', () => {
    const groups = groupByPackage([
      advisory({ id: 'a', severity: 'low' }),
      advisory({ id: 'b', severity: 'critical' }),
      advisory({ id: 'c', severity: 'medium' }),
    ]);

    expect(groups[0].worstSeverity).toBe('critical');
    expect(groups[0].counts).toEqual({
      critical: 1, high: 0, medium: 1, low: 1, unknown: 0
    });
  });

  it('sorts a group\'s own advisories worst first', () => {
    const groups = groupByPackage([
      advisory({ id: 'a', severity: 'low' }),
      advisory({ id: 'b', severity: 'critical' }),
      advisory({ id: 'c', severity: 'medium' }),
    ]);

    expect(groups[0].advisories.map((a) => a.severity)).toEqual(['critical', 'medium', 'low']);
  });

  it('shows the fix for the worst advisory, not the highest version in the group', () => {
    // A low-severity advisory often needs a newer release than the critical
    // one does; showing that version would overstate how far the bump has to
    // go and understate how urgent it is.
    const groups = groupByPackage([
      advisory({
        id: 'a', severity: 'low', patchedVersion: '5.0.0'
      }),
      advisory({
        id: 'b', severity: 'critical', patchedVersion: '4.17.21'
      }),
    ]);

    expect(groups[0].patchedVersion).toBe('4.17.21');
  });

  it('has no fix on the row when the worst advisory has none', () => {
    const groups = groupByPackage([
      advisory({
        id: 'a', severity: 'critical', patchedVersion: null
      }),
      advisory({
        id: 'b', severity: 'low', patchedVersion: '5.0.0'
      }),
    ]);

    expect(groups[0].patchedVersion).toBeNull();
  });

  it('rolls triage up to whichever advisory leaves the most to do', () => {
    // The critical being in a PR does not mean the package is handled.
    const groups = groupByPackage([
      advisory({
        id: 'a', severity: 'critical', triage: 'in-review'
      }),
      advisory({
        id: 'b', severity: 'medium', triage: 'fix-ready'
      }),
    ]);

    expect(groups[0].triage).toBe('fix-ready');
  });

  it('collects every manifest once, sorted', () => {
    const groups = groupByPackage([
      advisory({ id: 'a', manifest: 'shell/yarn.lock' }),
      advisory({ id: 'b', manifest: 'cypress/yarn.lock' }),
      advisory({ id: 'c', manifest: 'shell/yarn.lock' }),
      advisory({ id: 'd', manifest: null }),
    ]);

    expect(groups[0].manifests).toEqual(['cypress/yarn.lock', 'shell/yarn.lock']);
  });

  it('keeps the earliest creation date, ignoring the ones that carry none', () => {
    const groups = groupByPackage([
      advisory({ id: 'a', createdAt: '2025-06-01T00:00:00Z' }),
      advisory({ id: 'b', createdAt: null }),
      advisory({ id: 'c', createdAt: '2024-02-01T00:00:00Z' }),
    ]);

    expect(groups[0].oldest).toBe('2024-02-01T00:00:00Z');
  });

  it('leaves oldest null when nothing carries a date', () => {
    expect(groupByPackage([advisory({ createdAt: null })])[0].oldest).toBeNull();
  });

  describe('scope', () => {
    it('is the single scope when every advisory agrees', () => {
      expect(groupByPackage([
        advisory({ id: 'a', scope: 'development' }),
        advisory({ id: 'b', scope: 'development' }),
      ])[0].scope).toBe('development');
    });

    it('is mixed when the package arrives both ways', () => {
      expect(groupByPackage([
        advisory({ id: 'a', scope: 'runtime' }),
        advisory({ id: 'b', scope: 'development' }),
      ])[0].scope).toBe('mixed');
    });

    it('ignores advisories that state no scope rather than letting them win', () => {
      expect(groupByPackage([
        advisory({ id: 'a', scope: null }),
        advisory({ id: 'b', scope: 'runtime' }),
      ])[0].scope).toBe('runtime');
    });

    it('stays null when nobody states one', () => {
      expect(groupByPackage([advisory({ scope: null })])[0].scope).toBeNull();
    });
  });

  describe('row order', () => {
    it('puts the worst severity first', () => {
      const groups = groupByPackage([
        advisory({
          id: 'a', packageName: 'aaa', severity: 'low'
        }),
        advisory({
          id: 'b', packageName: 'bbb', severity: 'critical'
        }),
        advisory({
          id: 'c', packageName: 'ccc', severity: 'medium'
        }),
      ]);

      expect(groups.map((g) => g.name)).toEqual(['bbb', 'ccc', 'aaa']);
    });

    it('breaks a severity tie on how many advisories the package has', () => {
      const groups = groupByPackage([
        advisory({ id: 'a', packageName: 'aaa' }),
        advisory({ id: 'b', packageName: 'bbb' }),
        advisory({
          id: 'c', packageName: 'bbb', ghsa: 'GHSA-2'
        }),
      ]);

      expect(groups.map((g) => g.name)).toEqual(['bbb', 'aaa']);
    });

    it('breaks the remaining tie on name, so the order is stable between runs', () => {
      const groups = groupByPackage([
        advisory({ id: 'a', packageName: 'zzz' }),
        advisory({ id: 'b', packageName: 'aaa' }),
      ]);

      expect(groups.map((g) => g.name)).toEqual(['aaa', 'zzz']);
    });
  });

  it('returns nothing for an empty list', () => {
    expect(groupByPackage([])).toEqual([]);
  });
});

describe('countGroups', () => {
  it('totals the tiles above the table', () => {
    const groups = groupByPackage([
      advisory({
        id: 'a', packageName: 'aaa', severity: 'critical', triage: 'in-review', createdAt: '2025-03-01T00:00:00Z'
      }),
      advisory({
        id: 'b', packageName: 'bbb', severity: 'low', triage: 'no-fix', createdAt: '2024-01-01T00:00:00Z'
      }),
      advisory({
        id: 'c', packageName: 'bbb', severity: 'low', triage: 'no-fix', createdAt: '2025-01-01T00:00:00Z'
      }),
    ]);

    expect(countGroups(groups)).toEqual({
      counts: {
        critical: 1, high: 0, medium: 0, low: 2, unknown: 0
      },
      openTotal:    3,
      triageCounts: {
        'fix-ready': 0, 'in-review': 1, 'no-fix': 2
      },
      oldestOpen: '2024-01-01T00:00:00Z',
    });
  });

  it('counts advisories, not rows', () => {
    // One bump clears several alerts, but the tile reports the alerts.
    const groups = groupByPackage([
      advisory({ id: 'a' }), advisory({ id: 'b' }), advisory({ id: 'c' }),
    ]);

    expect(groups).toHaveLength(1);
    expect(countGroups(groups).openTotal).toBe(3);
  });

  it('is all zeroes with no groups, rather than undefined or null totals', () => {
    expect(countGroups([])).toEqual({
      counts:       emptyCounts(),
      openTotal:    0,
      triageCounts: {
        'fix-ready': 0, 'in-review': 0, 'no-fix': 0
      },
      oldestOpen: null,
    });
  });
});

describe('ageInDays', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2025-06-11T00:00:00Z'));
  });

  afterEach(() => jest.useRealTimers());

  it('counts whole days since the date', () => {
    expect(ageInDays('2025-06-01T00:00:00Z')).toBe(10);
    expect(ageInDays('2025-06-10T12:00:00Z')).toBe(0);
  });

  it('has nothing to say about no date', () => {
    expect(ageInDays(null)).toBeNull();
  });

  it('returns null rather than NaN for something that is not a date', () => {
    expect(ageInDays('not a date')).toBeNull();
  });

  it('floors a future date at zero rather than going negative', () => {
    expect(ageInDays('2025-12-01T00:00:00Z')).toBe(0);
  });
});

describe('severity levels', () => {
  it('has a rank for every level and no extras', () => {
    // A level added to `SEVERITIES` without a rank sorts as `undefined`, which
    // in a numeric comparator silently leaves the table in input order.
    const ranks = SEVERITIES.map((s: Severity) => severityRank(s));

    expect(new Set(ranks).size).toBe(SEVERITIES.length);
    expect(Object.keys(emptyCounts()).sort()).toEqual([...SEVERITIES].sort());
  });
});
