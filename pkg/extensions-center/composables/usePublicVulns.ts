import { GITHUB_API, OSV_API, OSV_BATCH_SIZE, SECURITY_CONCURRENCY } from '../config/constants';
import { Advisory, RepoSecurity } from '../types/security';
import { mapWithConcurrency } from '../utils/async';
import { countGroups, groupByPackage, normaliseSeverity } from '../utils/severity';
import { OsvVuln, useOsvCache } from './useOsvCache';

/** One resolved dependency out of the SBOM. */
interface ResolvedPackage {
  name: string;
  version: string;
  /** OSV ecosystem name, not the purl type */
  ecosystem: string;
}

interface SpdxPackage {
  name?: string;
  versionInfo?: string;
  externalRefs?: { referenceType?: string; referenceLocator?: string }[];
}

/**
 * purl type to OSV ecosystem.
 *
 * OSV is strict about these — `npm` is `npm` but `golang` is `Go` and `cargo`
 * is `crates.io` — and an unrecognised ecosystem silently returns no
 * vulnerabilities rather than an error, which would read as "this repo is
 * clean". Anything not in this map is skipped and counted as unresolved.
 */
const ECOSYSTEMS: Record<string, string> = {
  npm:           'npm',
  golang:        'Go',
  pypi:          'PyPI',
  maven:         'Maven',
  cargo:         'crates.io',
  gem:           'RubyGems',
  nuget:         'NuGet',
  composer:      'Packagist',
  githubactions: 'GitHub Actions',
  hex:           'Hex',
  pub:           'Pub',
};

/**
 * Vulnerabilities for a repo whose Dependabot alerts we cannot read.
 *
 * Two public sources, neither needing a credential:
 *
 * 1. GitHub's dependency-graph SBOM, which is readable on any public repo
 *    without a token at all and costs exactly one request.
 * 2. OSV.dev, which answers CORS preflights for any origin, so it is called
 *    straight from the browser rather than through Rancher's proxy.
 *
 * What this cannot produce is a history. An SBOM describes the tree as it
 * stands right now and carries no lifecycle, so `history` is always null here
 * and the chart says why instead of drawing a flat line. It also cannot see
 * dismissals or Dependabot's deduplication, which is why these counts run
 * higher and are never summed with Dependabot ones.
 */
export function usePublicVulns() {
  const osv = useOsvCache();

  const load = async(id: string, repo: string, label: string, onProgress?: (done: number, total: number) => void): Promise<RepoSecurity> => {
    const { packages, unresolved } = await readSbom(repo);

    const ids = await queryOsv(packages);
    const advisories = await describe(ids, osv, onProgress);
    const groups = groupByPackage(advisories);
    const totals = countGroups(groups);

    return {
      id,
      repo,
      label,
      source:    'public',
      groups,
      ...totals,
      history:   null,
      unresolved,
      fetchedAt: new Date().toISOString(),
    };
  };

  return { load };
}

/**
 * The repo's resolved dependency tree.
 *
 * Unauthenticated on purpose: the endpoint is public on public repos, and
 * sending an Authorization header would make this a non-simple request and
 * add a CORS preflight for no gain. The repos this path runs for are exactly
 * the ones our token has no standing on anyway.
 */
async function readSbom(repo: string): Promise<{ packages: ResolvedPackage[]; unresolved: number }> {
  const res = await fetch(`${ GITHUB_API }/repos/${ repo }/dependency-graph/sbom`, {
    headers: {
      Accept:                 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (!res.ok) {
    throw new Error(`Could not read the public dependency graph for ${ repo } (${ res.status }).`);
  }

  const body = await res.json() as { sbom?: { packages?: SpdxPackage[] } };
  const packages: ResolvedPackage[] = [];
  let unresolved = 0;

  for (const entry of body.sbom?.packages || []) {
    const version = entry.versionInfo || '';
    const purl = (entry.externalRefs || []).find((r) => r.referenceType === 'purl')?.referenceLocator;

    // The dependency graph reports a *declared range* (`^7.0.3`) for anything
    // it could not resolve against a lockfile. OSV needs an exact version, and
    // picking one for it would be inventing data — so these are counted and
    // reported in the UI rather than guessed at.
    if (!version || !purl || /[\^~><|* ]/.test(version)) {
      unresolved++;
      continue;
    }

    const type = purl.match(/^pkg:([^/]+)\//)?.[1];
    const ecosystem = type ? ECOSYSTEMS[type] : undefined;

    if (!ecosystem || !entry.name) {
      unresolved++;
      continue;
    }

    packages.push({
      name: entry.name, version, ecosystem
    });
  }

  return { packages, unresolved };
}

/** Advisory ids affecting any of these exact package versions. */
async function queryOsv(packages: ResolvedPackage[]): Promise<Map<string, ResolvedPackage[]>> {
  const chunks: ResolvedPackage[][] = [];

  for (let i = 0; i < packages.length; i += OSV_BATCH_SIZE) {
    chunks.push(packages.slice(i, i + OSV_BATCH_SIZE));
  }

  const byId = new Map<string, ResolvedPackage[]>();

  const results = await mapWithConcurrency(chunks, SECURITY_CONCURRENCY, async(chunk) => {
    const res = await fetch(`${ OSV_API }/v1/querybatch`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        queries: chunk.map((p) => ({
          package: { name: p.name, ecosystem: p.ecosystem },
          version: p.version,
        })),
      }),
    });

    if (!res.ok) {
      throw new Error(`OSV rejected a batch query (${ res.status }).`);
    }

    const body = await res.json() as { results?: { vulns?: { id: string }[] }[] };

    return { chunk, results: body.results || [] };
  });

  for (const { chunk, results: batch } of results) {
    batch.forEach((entry, i) => {
      const pkg = chunk[i];

      for (const vuln of entry.vulns || []) {
        const existing = byId.get(vuln.id);

        if (existing) {
          existing.push(pkg);
        } else {
          byId.set(vuln.id, [pkg]);
        }
      }
    });
  }

  return byId;
}

/** Turn advisory ids into rows, one per (advisory, affected package) pair. */
async function describe(
  byId: Map<string, ResolvedPackage[]>,
  osv: ReturnType<typeof useOsvCache>,
  onProgress?: (done: number, total: number) => void
): Promise<Advisory[]> {
  const ids = [...byId.keys()];
  const total = ids.length;
  let done = 0;

  const records = await mapWithConcurrency(ids, SECURITY_CONCURRENCY, async(id) => {
    const vuln = await osv.get(id);

    onProgress?.(++done, total);

    return { id, vuln };
  });

  const out: Advisory[] = [];

  for (const { id, vuln } of records) {
    for (const pkg of byId.get(id) || []) {
      out.push({
        id:              `${ id }@${ pkg.ecosystem }/${ pkg.name }`,
        packageName:     pkg.name,
        ecosystem:       pkg.ecosystem,
        ghsa:            id,
        cve:             (vuln?.aliases || []).find((a) => a.startsWith('CVE-')) || null,
        summary:         vuln?.summary || vuln?.details?.split('\n')[0] || '',
        severity:        normaliseSeverity(vuln?.database_specific?.severity),
        // An SBOM says what is installed, not which lockfile asked for it, and
        // carries no runtime/development split either. Null rather than a
        // guess, and the UI hides those columns for this source.
        manifest:        null,
        vulnerableRange: null,
        patchedVersion:  firstFixed(vuln, pkg),
        scope:           null,
        relationship:    null,
        // OSV only knows about advisories that currently apply to the resolved
        // version, so everything it returns is by definition open.
        state:           'open',
        createdAt:       null,
        closedAt:        null,
        url:             `https://osv.dev/vulnerability/${ id }`,
      });
    }
  }

  return out;
}

/** The version that closes this advisory for this package, per OSV's ranges. */
function firstFixed(vuln: OsvVuln | null, pkg: ResolvedPackage): string | null {
  const affected = (vuln?.affected || []).find((a) => {
    return a.package?.name === pkg.name && a.package?.ecosystem === pkg.ecosystem;
  });

  for (const range of affected?.ranges || []) {
    for (const event of range.events || []) {
      if (event.fixed) {
        return event.fixed;
      }
    }
  }

  return null;
}
