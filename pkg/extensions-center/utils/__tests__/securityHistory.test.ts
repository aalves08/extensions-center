import { Advisory, SEVERITIES, SeveritySeries } from '../../types/security';
import { buildHistory, sumSeries, trimSeries } from '../securityHistory';

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

/** "Now" for every case here, so the number of buckets is fixed. */
const NOW = '2025-04-03T00:00:00Z';

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

/** A series with explicit values, for the pure array maths. */
function series(dates: string[], values: Partial<Record<typeof SEVERITIES[number], number[]>>): SeveritySeries {
  const out = { dates } as SeveritySeries;

  for (const severity of SEVERITIES) {
    out[severity] = values[severity] || new Array(dates.length).fill(0);
  }

  return out;
}

beforeEach(() => jest.useFakeTimers().setSystemTime(new Date(NOW)));
afterEach(() => jest.useRealTimers());

describe('buildHistory', () => {
  it('has nothing to draw when no advisory carries a date', () => {
    // Null rather than an empty series, so the caller can say why the chart is
    // blank instead of rendering an axis with no line on it.
    expect(buildHistory([], 7)).toBeNull();
    expect(buildHistory([advisory({ createdAt: null })], 7)).toBeNull();
    expect(buildHistory([advisory({ createdAt: 'whenever' })], 7)).toBeNull();
  });

  it('counts an alert as open from the day it was raised until the day it closed', () => {
    const created = '2025-01-15T00:00:00Z';
    const closed = '2025-02-20T00:00:00Z';

    const result = buildHistory([advisory({ createdAt: created, closedAt: closed })], 7) as SeveritySeries;

    // Stated as the rule itself: open on bucket D exactly when raised on or
    // before D and not yet closed.
    result.dates.forEach((date, i) => {
      const at = Date.parse(`${ date }T00:00:00Z`);
      const open = at >= Date.parse(created) && at < Date.parse(closed) ? 1 : 0;

      expect(result.high[i]).toBe(open);
    });

    expect(result.high).toContain(1);
    expect(result.high[result.high.length - 1]).toBe(0);
  });

  it('keeps an open alert open through the last bucket', () => {
    const result = buildHistory([advisory({ closedAt: null })], 7) as SeveritySeries;

    expect(result.high[result.high.length - 1]).toBe(1);
  });

  it('treats an unreadable closedAt as still open rather than as closed today', () => {
    const result = buildHistory([advisory({ state: 'fixed', closedAt: 'not a date' })], 7) as SeveritySeries;

    expect(result.high[result.high.length - 1]).toBe(1);
  });

  it('lands the buckets on fixed multiples, not on the first alert\'s weekday', () => {
    // Two repos charted side by side have to share an x axis, so the shorter
    // series has to be a suffix of the longer one rather than offset from it.
    const a = buildHistory([advisory({ createdAt: '2025-01-15T00:00:00Z' })], 7) as SeveritySeries;
    const b = buildHistory([advisory({ createdAt: '2025-02-18T00:00:00Z' })], 7) as SeveritySeries;

    a.dates.forEach((date) => expect(Date.parse(`${ date }T00:00:00Z`) % WEEK_MS).toBe(0));
    expect(a.dates.length).toBeGreaterThan(b.dates.length);
    expect(a.dates.slice(-b.dates.length)).toEqual(b.dates);
  });

  it('opens on or before the earliest alert', () => {
    const result = buildHistory([
      advisory({ id: 'a', createdAt: '2025-03-01T00:00:00Z' }),
      advisory({ id: 'b', createdAt: '2025-01-15T00:00:00Z' }),
    ], 7) as SeveritySeries;

    expect(Date.parse(`${ result.dates[0] }T00:00:00Z`)).toBeLessThanOrEqual(Date.parse('2025-01-15T00:00:00Z'));
  });

  it('spaces the buckets by the size it was given', () => {
    const weekly = buildHistory([advisory()], 7) as SeveritySeries;
    const daily = buildHistory([advisory()], 1) as SeveritySeries;

    const gap = (s: SeveritySeries) => Date.parse(`${ s.dates[1] }T00:00:00Z`) - Date.parse(`${ s.dates[0] }T00:00:00Z`);

    expect(gap(weekly)).toBe(WEEK_MS);
    expect(gap(daily)).toBe(DAY_MS);
    expect(daily.dates.length).toBeGreaterThan(weekly.dates.length);
  });

  it('gives every severity its own band, all the same length as the axis', () => {
    const result = buildHistory([
      advisory({ id: 'a', severity: 'critical' }),
      advisory({ id: 'b', severity: 'unknown' }),
      advisory({ id: 'c', severity: 'critical' }),
    ], 7) as SeveritySeries;

    const last = result.dates.length - 1;

    expect(result.critical[last]).toBe(2);
    expect(result.unknown[last]).toBe(1);
    expect(result.high[last]).toBe(0);

    SEVERITIES.forEach((severity) => expect(result[severity]).toHaveLength(result.dates.length));
  });

  it('keeps the datable alerts when one of them has no date', () => {
    const result = buildHistory([
      advisory({ id: 'a' }),
      advisory({ id: 'b', createdAt: null }),
    ], 7) as SeveritySeries;

    expect(result.high[result.high.length - 1]).toBe(1);
  });

  it('rebuilds the history out of closed alerts, which is why they are fetched', () => {
    // The table never shows these; the chart is the only thing they are for.
    const result = buildHistory([
      advisory({
        id: 'a', state: 'fixed', createdAt: '2025-01-01T00:00:00Z', closedAt: '2025-02-01T00:00:00Z'
      }),
      advisory({
        id: 'b', state: 'dismissed', createdAt: '2025-01-01T00:00:00Z', closedAt: '2025-02-01T00:00:00Z'
      }),
    ], 7) as SeveritySeries;

    expect(Math.max(...result.high)).toBe(2);
    expect(result.high[result.high.length - 1]).toBe(0);
  });

  it('dates the buckets in UTC, so a bucket does not shift with the viewer', () => {
    const result = buildHistory([advisory()], 7) as SeveritySeries;

    result.dates.forEach((date) => expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/));
  });
});

describe('sumSeries', () => {
  it('has nothing to return when every series is empty', () => {
    expect(sumSeries([])).toBeNull();
    expect(sumSeries([series([], {})])).toBeNull();
  });

  it('adds matching buckets across every severity', () => {
    const result = sumSeries([
      series(['2025-01-02', '2025-01-09'], { high: [1, 2], critical: [0, 1] }),
      series(['2025-01-02', '2025-01-09'], { high: [3, 4], unknown: [5, 5] }),
    ]) as SeveritySeries;

    expect(result.high).toEqual([4, 6]);
    expect(result.critical).toEqual([0, 1]);
    expect(result.unknown).toEqual([5, 5]);
    expect(result.low).toEqual([0, 0]);
  });

  it('pads a shorter series at the front, because a repo that did not exist had no alerts', () => {
    const result = sumSeries([
      series(['2025-01-02', '2025-01-09', '2025-01-16'], { high: [1, 1, 1] }),
      series(['2025-01-16'], { high: [7] }),
    ]) as SeveritySeries;

    expect(result.dates).toEqual(['2025-01-02', '2025-01-09', '2025-01-16']);
    expect(result.high).toEqual([1, 1, 8]);
  });

  it('takes its axis from the longest series', () => {
    const result = sumSeries([
      series(['2025-01-16'], { high: [7] }),
      series(['2025-01-02', '2025-01-09', '2025-01-16'], { high: [1, 1, 1] }),
    ]) as SeveritySeries;

    expect(result.dates).toHaveLength(3);
    expect(result.high).toEqual([1, 1, 8]);
  });

  it('skips the empty ones rather than collapsing the axis to nothing', () => {
    const result = sumSeries([
      series([], {}),
      series(['2025-01-02'], { high: [2] }),
    ]) as SeveritySeries;

    expect(result.dates).toEqual(['2025-01-02']);
    expect(result.high).toEqual([2]);
  });

  it('leaves the inputs untouched', () => {
    const input = series(['2025-01-02'], { high: [2] });

    sumSeries([input, series(['2025-01-02'], { high: [3] })]);

    expect(input.high).toEqual([2]);
  });
});

describe('trimSeries', () => {
  const full = series(
    ['2025-01-02', '2025-01-09', '2025-01-16', '2025-01-23'],
    { high: [1, 2, 3, 4], critical: [0, 0, 1, 1] },
  );

  it('hands the whole series back when no window is asked for', () => {
    expect(trimSeries(full, 0, 7)).toBe(full);
  });

  it('keeps the last window\'s worth of buckets', () => {
    const result = trimSeries(full, 14, 7);

    expect(result.dates).toEqual(['2025-01-16', '2025-01-23']);
    expect(result.high).toEqual([3, 4]);
    expect(result.critical).toEqual([1, 1]);
  });

  it('rounds a partial bucket up rather than dropping it', () => {
    expect(trimSeries(full, 10, 7).dates).toEqual(['2025-01-16', '2025-01-23']);
  });

  it('keeps everything when the window is longer than the series', () => {
    expect(trimSeries(full, 3650, 7).dates).toEqual(full.dates);
    expect(trimSeries(full, 3650, 7).high).toEqual([1, 2, 3, 4]);
  });

  it('trims every band consistently with the axis', () => {
    const result = trimSeries(full, 14, 7);

    SEVERITIES.forEach((severity) => expect(result[severity]).toHaveLength(result.dates.length));
  });

  it('leaves the original alone', () => {
    trimSeries(full, 7, 7);

    expect(full.dates).toHaveLength(4);
    expect(full.high).toEqual([1, 2, 3, 4]);
  });
});
