/**
 * Open pull requests against the official extensions manifest.
 *
 * Their own types rather than a slice of the GitHub payloads in `github.ts`,
 * because what the dashboard shows is not a pull request — it is what a pull
 * request would do to the manifest, which is computed here and sent nowhere
 * else.
 */

/** What a PR does to one extension in the manifest. */
export type ManifestChangeKind =
  /** The extension is not in the manifest yet */
  | 'added'
  /** The extension is being taken out entirely */
  | 'dropped'
  /** Versions appended to an extension already listed */
  | 'newVersion'
  /** Versions taken off an extension that stays listed */
  | 'removedVersion';

export interface ManifestChange {
  kind: ManifestChangeKind;
  /** Manifest key, which is the chart name — `kubewarden`, `observability`… */
  extension: string;
  /** The versions this change concerns. Never empty except for an empty entry. */
  versions: string[];
}

export interface ManifestPr {
  number: number;
  title: string;
  url: string;
  author: string;
  draft: boolean;
  /**
   * Empty when the PR edits the file without changing the extension set — a
   * reformat, a key reorder. The banner still shows, because somebody is
   * editing the manifest and that is the thing worth knowing.
   */
  changes: ManifestChange[];
}
