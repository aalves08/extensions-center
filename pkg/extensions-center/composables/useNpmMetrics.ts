import { ref, Ref } from 'vue';

import { NPM_DOWNLOADS_API, NPM_REGISTRY_API, TRACKED_PACKAGES } from '../config/constants';
import { DownloadPoint, PackageMetrics } from '../types/npm';

export type MetricsRange = 'last-month' | 'last-quarter' | 'last-year';

/** npm's download API takes either a named period or an explicit `from:to` pair. */
function rangePeriod(range: MetricsRange): string {
  if (range === 'last-quarter') {
    const end = new Date();
    const start = new Date(end.getTime() - (89 * 24 * 60 * 60 * 1000));
    const iso = (d: Date) => d.toISOString().slice(0, 10);

    return `${ iso(start) }:${ iso(end) }`;
  }

  return range;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });

  if (!res.ok) {
    throw new Error(`npm request failed (${ res.status }) for ${ url }`);
  }

  return res.json() as Promise<T>;
}

/** The parts of the npm registry document we read. */
interface RegistryDoc {
  'dist-tags'?: { latest?: string };
  time?: Record<string, string>;
  versions?: Record<string, unknown>;
}

interface DownloadsPoint {
  downloads?: number;
}

interface DownloadsRange {
  downloads?: DownloadPoint[];
}

async function fetchPackage(name: string, range: MetricsRange): Promise<PackageMetrics> {
  const encoded = encodeURIComponent(name);

  const [registry, week, month, daily] = await Promise.all([
    getJson<RegistryDoc>(`${ NPM_REGISTRY_API }/${ encoded }`),
    getJson<DownloadsPoint>(`${ NPM_DOWNLOADS_API }/downloads/point/last-week/${ encoded }`),
    getJson<DownloadsPoint>(`${ NPM_DOWNLOADS_API }/downloads/point/last-month/${ encoded }`),
    getJson<DownloadsRange>(`${ NPM_DOWNLOADS_API }/downloads/range/${ rangePeriod(range) }/${ encoded }`),
  ]);

  const latest = registry?.['dist-tags']?.latest || null;

  return {
    name,
    npmUrl:             `https://www.npmjs.com/package/${ name }`,
    latestVersion:      latest,
    latestPublishedAt:  latest ? registry?.time?.[latest] || null : null,
    totalVersions:      Object.keys(registry?.versions || {}).length,
    downloadsLastWeek:  week?.downloads || 0,
    downloadsLastMonth: month?.downloads || 0,
    daily:              daily?.downloads || [],
  };
}

/**
 * Download and release stats for the packages extensions build against.
 *
 * Both npm endpoints are public, CORS-enabled and unauthenticated, so unlike
 * everything else here this works with no credentials configured.
 */
export function useNpmMetrics(packages: readonly string[] = TRACKED_PACKAGES) {
  const data: Ref<PackageMetrics[]> = ref([]);
  const range: Ref<MetricsRange> = ref('last-month');
  const loading = ref(false);
  const error: Ref<string | null> = ref(null);
  const lastRefreshed: Ref<Date | null> = ref(null);

  const refresh = async(): Promise<void> => {
    loading.value = true;
    error.value = null;

    try {
      data.value = await Promise.all(packages.map((p) => fetchPackage(p, range.value)));
      lastRefreshed.value = new Date();
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
      data.value = [];
    } finally {
      loading.value = false;
    }
  };

  const setRange = async(next: MetricsRange): Promise<void> => {
    range.value = next;
    await refresh();
  };

  return {
    data, range, loading, error, lastRefreshed, refresh, setRange
  };
}
