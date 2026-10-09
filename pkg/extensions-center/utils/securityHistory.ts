import { Advisory, SeveritySeries, SEVERITIES } from '../types/security';

const DAY_MS = 86_400_000;

/** `YYYY-MM-DD` for a timestamp, in UTC so a bucket does not shift with the viewer. */
function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Open alerts over time, reconstructed from the alerts' own lifecycles.
 *
 * There is no stored time series anywhere and no scheduled job writing one.
 * Every alert carries the date it was created and, if it is closed, the date
 * that happened — so an alert was open on date D exactly when it was created
 * on or before D and not yet closed. Walking the bucket dates against that
 * rebuilds years of history out of the single pull the table already needed.
 *
 * This is why the alert fetch does not filter to `state=open`: the closed
 * alerts, useless to the table, are the entire history.
 *
 * Returns null when there is nothing to draw, so the caller can say why the
 * chart is empty rather than rendering an axis with no line on it.
 */
export function buildHistory(advisories: Advisory[], bucketDays: number): SeveritySeries | null {
  const dated = advisories.filter((a) => a.createdAt && Number.isFinite(Date.parse(a.createdAt)));

  if (!dated.length) {
    return null;
  }

  const bucketMs = bucketDays * DAY_MS;
  const earliest = Math.min(...dated.map((a) => Date.parse(a.createdAt as string)));

  // Buckets land on fixed multiples of the bucket size rather than on the
  // first alert's weekday, so two repos charted side by side share an x axis.
  const start = Math.floor(earliest / bucketMs) * bucketMs;
  const end = Date.now();

  const series: SeveritySeries = {
    dates: [], critical: [], high: [], medium: [], low: [],
  };

  // Pre-parsed, because the inner loop runs once per alert per bucket and a
  // seven-year weekly series over a thousand alerts is 360k iterations —
  // re-parsing two date strings each time is the difference between
  // instant and visibly slow.
  const parsed = dated.map((a) => ({
    severity: a.severity,
    from:     Date.parse(a.createdAt as string),
    until:    a.closedAt && Number.isFinite(Date.parse(a.closedAt)) ? Date.parse(a.closedAt) : Infinity,
  }));

  for (let at = start; at <= end; at += bucketMs) {
    series.dates.push(isoDay(at));

    const counts = {
      critical: 0, high: 0, medium: 0, low: 0,
    };

    for (const alert of parsed) {
      if (alert.from <= at && alert.until > at) {
        counts[alert.severity]++;
      }
    }

    for (const severity of SEVERITIES) {
      series[severity].push(counts[severity]);
    }
  }

  return series;
}

/** Sum several repos' series onto one axis, for the estate-wide chart. */
export function sumSeries(all: SeveritySeries[]): SeveritySeries | null {
  const usable = all.filter((s) => s.dates.length);

  if (!usable.length) {
    return null;
  }

  // Repos start at different dates, so the longest series defines the axis and
  // the shorter ones are padded at the *front* with zeros — a repo that did not
  // exist yet had no open alerts, which is the honest reading.
  const longest = usable.reduce((a, b) => (a.dates.length >= b.dates.length ? a : b));

  const out: SeveritySeries = {
    dates:    [...longest.dates],
    critical: new Array(longest.dates.length).fill(0),
    high:     new Array(longest.dates.length).fill(0),
    medium:   new Array(longest.dates.length).fill(0),
    low:      new Array(longest.dates.length).fill(0),
  };

  for (const series of usable) {
    const offset = out.dates.length - series.dates.length;

    for (const severity of SEVERITIES) {
      series[severity].forEach((value, i) => {
        out[severity][offset + i] += value;
      });
    }
  }

  return out;
}

/** The last `days` worth of buckets, or the whole series when `days` is 0. */
export function trimSeries(series: SeveritySeries, days: number, bucketDays: number): SeveritySeries {
  if (!days) {
    return series;
  }

  const keep = Math.min(series.dates.length, Math.ceil(days / bucketDays));
  const from = series.dates.length - keep;

  return {
    dates:    series.dates.slice(from),
    critical: series.critical.slice(from),
    high:     series.high.slice(from),
    medium:   series.medium.slice(from),
    low:      series.low.slice(from),
  };
}
