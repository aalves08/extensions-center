import { INVENTORY_SUGGESTION_LIMIT } from '../config/constants';
import { BundleAnalysisDoc, BundleCause, ExtensionBundle } from '../types/analysis';
import { InventoryDoc, InventoryExtension, InventoryRefSource } from '../types/inventory';
import { Advisory, RepoSecurity } from '../types/security';
import { matchVersions, RangeVerdict } from './semverRange';

/**
 * Looking one package up across the estate.
 *
 * The incident question, which runs opposite to everything else on the Security
 * page: a name is circulating, and what is needed is where it is, at what
 * version, and whether it reaches anybody. See `types/inventory.ts` for why
 * that cannot be answered from the advisory-driven views.
 *
 * Nothing here fetches. The inventory, the bundles and the advisories are each
 * loaded by their own code, and this is the pure join over the three.
 */

/** Names the bundle analyser invents, which can never be a real package. */
const SYNTHETIC = new Set(['webpack-runtime', 'externalized']);

export interface InventoryQuery {
  /** Exact package name, as it appears in a lockfile */
  name: string;
  /** A semver range, or null when the query named no version at all */
  range: string | null;
}

/** One extension's answer to the query. */
export interface InventoryHit {
  ext: string;
  repo: string;
  tag: string;
  semver: string;
  source: InventoryRefSource;
  lockfile: string | null;
  /** Every version this extension's lockfile resolved the package to */
  versions: string[];
  /**
   * Whether those versions fall inside the queried range.
   *
   * Null when the query named no version, which is a different thing from
   * `unknown` — there was no question to answer rather than a question that
   * could not be answered.
   */
  verdict: RangeVerdict | null;
  /** True when the package is also inside this extension's published bundle */
  shipped: boolean;
  /** Source bytes it contributes to that bundle, scaled to disk where known */
  shippedBytes: number | null;
  cause: BundleCause | null;
  /** Advisories already open against this package in this extension's repo */
  advisories: Advisory[];
}

export interface InventoryResult {
  query: InventoryQuery;
  hits: InventoryHit[];
  /** Extensions searched, so "3 of 14" can be said rather than just "3" */
  searched: number;
  /**
   * Extensions whose lockfile could not be read.
   *
   * Surfaced rather than ignored: a hit could be hiding in any of them, and
   * "not found" has to be qualified by how much was actually looked at.
   */
  unreadable: string[];
  /** Other package names containing the query, offered when it finds nothing */
  suggestions: string[];
}

/**
 * Split a typed query into a name and an optional range.
 *
 * The separator is the *last* `@`, because a scoped name opens with one. So
 * `lodash@<4.17.21`, `@scope/pkg@^1.0.0` and a bare `chalk` all parse, and
 * anything the advisory feeds print can be pasted in whole.
 */
export function parseQuery(raw: string): InventoryQuery | null {
  const cleaned = (raw || '').trim().replace(/^"|"$/g, '');

  if (!cleaned) {
    return null;
  }

  const at = cleaned.lastIndexOf('@');

  // `at <= 0` is a bare name, or a scoped name with no version after it.
  if (at <= 0) {
    return { name: cleaned, range: null };
  }

  const range = cleaned.slice(at + 1).trim();

  return { name: cleaned.slice(0, at), range: range || null };
}

/** Packages in one bundle, keyed by name, synthetic and own-code entries dropped. */
function bundleIndex(bundle: ExtensionBundle) {
  const index = new Map<string, NonNullable<ExtensionBundle['byPackage']>[number]>();

  for (const entry of bundle.byPackage || []) {
    if (SYNTHETIC.has(entry.pkg) || entry.cause === 'extension-code') {
      continue;
    }

    index.set(entry.pkg, entry);
  }

  return index;
}

/** Open advisories on one package, per repo that raised them. */
function advisoriesByRepo(pkg: string, repos: RepoSecurity[]): Map<string, Advisory[]> {
  const out = new Map<string, Advisory[]>();

  for (const repo of repos) {
    if (repo.error) {
      continue;
    }

    for (const group of repo.groups) {
      if (group.name !== pkg) {
        continue;
      }

      const existing = out.get(repo.repo) || [];

      // Two targets can be slices of one monorepo, so the same GHSA can arrive
      // twice against the same repo.
      for (const advisory of group.advisories) {
        if (!existing.some((a) => a.ghsa === advisory.ghsa)) {
          existing.push(advisory);
        }
      }

      out.set(repo.repo, existing);
    }
  }

  return out;
}

/** Up to `INVENTORY_SUGGESTION_LIMIT` other names containing the query. */
function suggest(name: string, extensions: InventoryExtension[]): string[] {
  const needle = name.toLowerCase();

  if (needle.length < 3) {
    return [];
  }

  const found = new Set<string>();

  for (const ext of extensions) {
    for (const pkg of Object.keys(ext.packages)) {
      if (pkg !== name && pkg.toLowerCase().includes(needle)) {
        found.add(pkg);
      }
    }
  }

  return [...found].sort((a, b) => a.length - b.length || a.localeCompare(b)).slice(0, INVENTORY_SUGGESTION_LIMIT);
}

export function searchInventory(
  query: InventoryQuery,
  inventory: InventoryDoc | null,
  bundles: BundleAnalysisDoc | null,
  repos: RepoSecurity[],
): InventoryResult {
  const extensions = inventory?.extensions || [];
  const empty: InventoryResult = {
    query, hits: [], searched: extensions.length, unreadable: [], suggestions: [],
  };

  if (!extensions.length) {
    return empty;
  }

  // Keyed by extension name, which is what the inventory and the bundle
  // document agree on — two extensions out of one repo have one repo name
  // between them but their own bundles.
  const byExt = new Map<string, ReturnType<typeof bundleIndex>>();

  for (const bundle of bundles?.extensions || []) {
    byExt.set(bundle.name, bundleIndex(bundle));
  }

  const ratios = new Map((bundles?.extensions || []).map((b) => [b.name, b.ratio]));
  const advisories = advisoriesByRepo(query.name, repos);

  const hits: InventoryHit[] = [];
  const unreadable: string[] = [];

  for (const ext of extensions) {
    if (ext.error) {
      unreadable.push(ext.name);
      continue;
    }

    const versions = ext.packages[query.name];

    if (!versions?.length) {
      continue;
    }

    const entry = byExt.get(ext.name)?.get(query.name) || null;
    const ratio = ratios.get(ext.name) ?? null;

    hits.push({
      ext:          ext.name,
      repo:         ext.repo,
      tag:          ext.tag,
      semver:       ext.semver,
      source:       ext.source,
      lockfile:     ext.lockfile,
      versions,
      verdict:      query.range ? matchVersions(versions, query.range) : null,
      shipped:      !!entry,
      shippedBytes: entry && ratio !== null ? Math.round(entry.bytes * ratio) : null,
      cause:        entry?.cause || null,
      advisories:   advisories.get(ext.repo) || [],
    });
  }

  // Confirmed in range first, then anything that ships. During an incident the
  // ordering question is "who do I call", and that is the extension whose
  // resolved version is the bad one and whose users already downloaded it.
  const rank = (hit: InventoryHit) => {
    if (hit.verdict === 'hit') {
      return 0;
    }

    if (hit.verdict === 'partial') {
      return 1;
    }

    return hit.shipped ? 2 : 3;
  };

  hits.sort((a, b) => rank(a) - rank(b) || a.ext.localeCompare(b.ext));

  return {
    query,
    hits,
    searched:    extensions.length,
    unreadable,
    // Only when the exact name found nothing: a successful search should not
    // be followed by a list of things it could have been instead.
    suggestions: hits.length ? [] : suggest(query.name, extensions),
  };
}
