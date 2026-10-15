/**
 * Every package each extension resolves, read out of its lockfile.
 *
 * The Security page's other views all start from an advisory: something has
 * been published against a package, and the question is where it lands. During
 * an incident the question runs the other way — a name is circulating, usually
 * hours before any advisory exists, and what is needed is whether it is in the
 * estate at all and at which version.
 *
 * A view built on advisories cannot answer that. It has no row for a package
 * nobody has filed against yet, so the search comes back empty and empty reads
 * as "not affected", which is the one wrong answer that costs something. Hence
 * a separate inventory: the complete resolved tree, independent of whether
 * anything is known to be wrong with any of it.
 *
 * Deliberately the whole lockfile rather than only what reaches a bundle.
 * Bundle analysis knows what survived into the published assets, which is the
 * right scope for "does this reach a user" and the wrong one for "is this in
 * our tree" — most npm supply-chain attacks run from a postinstall script and
 * never reach a browser at all.
 */

/** Which kind of ref the lockfile was read at. Mirrors `AnalysisTarget.source`. */
export type InventoryRefSource = 'release' | 'tag' | 'branch';

/** One extension's resolved dependency tree at one ref. */
export interface InventoryExtension {
  /** Chart name */
  name: string;
  /** `owner/name` */
  repo: string;
  /** The release tag, or the branch name when nothing tagged this extension */
  tag: string;
  semver: string;
  /**
   * Where the ref came from.
   *
   * `branch` is the honest admission that this is HEAD rather than anything
   * shipped — either nothing tagged the extension, or the tag resolved to
   * nothing readable. `harvester-ui-extension` is the standing example: its
   * GitHub release is named `harvester-1.9.0` while the git tag is `v1.9.0`,
   * so the release name is not a ref and the tree read at it fails.
   */
  source: InventoryRefSource;
  /** Repo-relative path of the lockfile read, so a row can show its own source */
  lockfile: string | null;
  /**
   * Resolved package name to every version the lockfile pinned it to.
   *
   * Several versions is normal rather than an error — that is what nested
   * `node_modules` are — and all of them are kept, because during an incident
   * the one that matters may not be the one a caller would have picked.
   */
  packages: Record<string, string[]>;
  /** Set when no lockfile could be read at all; `packages` is then empty */
  error?: string;
}

export interface InventoryDoc {
  /** Matches `INVENTORY_CACHE_VERSION`; anything else is discarded */
  version: number;
  fetchedAt: string;
  extensions: InventoryExtension[];
}
