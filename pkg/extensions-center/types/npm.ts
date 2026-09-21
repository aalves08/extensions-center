/** Data models for the npm metrics page. */

/** One bucket from the npm downloads range endpoint */
export interface DownloadPoint {
  /** `YYYY-MM-DD` */
  day: string;
  downloads: number;
}

/** Download + release stats for a single npm package */
export interface PackageMetrics {
  /** Package name, e.g. `@rancher/shell` — also the row id */
  name: string;
  npmUrl: string;
  latestVersion: string | null;
  latestPublishedAt: string | null;
  totalVersions: number;
  downloadsLastWeek: number;
  downloadsLastMonth: number;
  /** Daily downloads over the selected range, oldest first */
  daily: DownloadPoint[];
}
