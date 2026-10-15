/**
 * Turning a list of vulnerabilities into a list of decisions.
 *
 * The Security page could already say what was vulnerable; it could not say
 * what to do about it, and the two are much further apart than the severity
 * column suggests. Measured against `rancher/dashboard`'s 18 open alerts: 12
 * have no published fix at all, 5 have a fix sitting in an unreviewed
 * Dependabot PR, and 1 is fixable but only reaches Cypress. So the real answer
 * is "review five PRs", and a table sorted by severity cannot express that.
 *
 * Two separate judgements, deliberately not collapsed into one:
 *
 * - `TriageStatus` — what the next action is. Every row has exactly one.
 * - `Exposure` — whether anyone outside the build is affected. A heuristic,
 *   and treated as one: it annotates, it never reranks and never hides.
 */

import {
  Advisory, Exposure, PrFix, RepoSecurity, TriageStatus
} from '../types/security';
import { compareSemver } from './version';

/**
 * Most work remaining first, which is also the column's sort order.
 *
 * `fix-ready` outranks `in-review` because it is the one with nothing moving:
 * an in-review finding already has someone's output attached and needs a
 * reviewer, while a fix-ready one needs a PR that nobody has raised.
 */
export const TRIAGE_ORDER: readonly TriageStatus[] = ['fix-ready', 'in-review', 'no-fix'];

/**
 * Path segments whose contents are not shipped to a user's browser.
 *
 * A heuristic, and the reason `Exposure` is kept out of `TriageStatus`: being
 * wrong here means understating a real exposure, so nothing downstream is
 * allowed to hide a row on the strength of it. Seven of `rancher/dashboard`'s
 * 18 open alerts are in `cypress/yarn.lock` or `docusaurus/yarn.lock`, which is
 * why it is worth saying at all.
 */
export const NON_SHIPPED_PATH_SEGMENTS: ReadonlySet<string> = new Set([
  'cypress', 'docusaurus', 'e2e', 'test', 'tests', '__tests__', 'docs', 'storybook', 'scripts',
]);

/**
 * An advisory before the three derived fields are attached.
 *
 * Everything here judges a finding on its facts, so the functions take this
 * rather than a whole `Advisory` — which also lets them run while one is still
 * being built, and makes it impossible to derive a field from a field that was
 * itself derived.
 */
export type AdvisoryFacts = Omit<Advisory, 'triage' | 'exposure' | 'prFix'>;

/** How a package is installed, which decides the shape of the fix. */
type PackageManager = 'yarn' | 'npm' | 'pnpm';

/** A fix a reader can copy, and where it goes. */
export interface Remediation {
  /** The text to copy */
  command: string;
  /** `command` runs in a shell; `manifest` is an edit to `file` */
  kind: 'command' | 'manifest';
  /** The file to edit, for `manifest`. Null for a shell command. */
  file: string | null;
}

/**
 * The open Dependabot PR that would close this advisory, if there is one.
 *
 * Matched on name and version rather than on the PR being a *security* update:
 * `handlebars` 4.7.10 landed on `rancher/dashboard` as a routine version bump
 * and happens to clear three open advisories, two of them critical. Whether
 * Dependabot labelled it a security PR says nothing about whether it fixes one.
 *
 * `>=` rather than `===` because a PR that overshoots the patched version still
 * closes the advisory.
 */
export function matchingPr(advisory: AdvisoryFacts, prs: readonly PrFix[]): PrFix | null {
  const patched = advisory.patchedVersion;

  if (!patched) {
    return null;
  }

  return prs.find((pr) => pr.name === advisory.packageName && compareSemver(pr.version, patched) >= 0) || null;
}

/** What has to happen next for one advisory. */
export function triageAdvisory(advisory: AdvisoryFacts, prs: readonly PrFix[]): TriageStatus {
  if (!advisory.patchedVersion) {
    return 'no-fix';
  }

  return matchingPr(advisory, prs) ? 'in-review' : 'fix-ready';
}

/**
 * An advisory with its three derived fields filled in.
 *
 * The only place they are set, so they cannot disagree. Called twice per
 * finding by design: once as it is built, with no PRs known, and again by
 * `useRepoSecurity` once the repo's open PRs are in. Re-running it on a whole
 * `Advisory` is safe — it reads only the facts and overwrites the derivations.
 *
 * The first pass is not a placeholder. With an empty PR list the answer is
 * `no-fix` or `fix-ready`, both of which are correct statements about the
 * finding; what the second pass adds is that someone has already acted.
 */
export function withTriage(advisory: AdvisoryFacts, prs: readonly PrFix[]): Advisory {
  return {
    ...advisory,
    triage:   triageAdvisory(advisory, prs),
    exposure: exposureOf(advisory),
    prFix:    matchingPr(advisory, prs),
  };
}

/**
 * The status of a group of advisories: whichever leaves the most to do.
 *
 * A package with one fix-ready advisory and three no-fix ones is still work,
 * and rolling it up to `no-fix` would bury the one row that can be acted on.
 */
export function worstTriage(statuses: readonly TriageStatus[]): TriageStatus {
  return TRIAGE_ORDER.find((status) => statuses.includes(status)) || 'no-fix';
}

/** A zeroed tally, so every status is a number rather than a possible `undefined`. */
export function emptyTriageCounts(): Record<TriageStatus, number> {
  return {
    'fix-ready': 0, 'in-review': 0, 'no-fix': 0
  };
}

/**
 * A repo's findings, re-judged against its open pull requests.
 *
 * Run after both halves have arrived, because the alerts and the PRs are
 * fetched together and neither can wait for the other. Pure, and returns a new
 * object, so it can be applied to a restored document as easily as to a fresh
 * fetch.
 *
 * The match is per package across the whole repo, not per lockfile: the commit
 * trailer names the package and the version but not the directory, so a PR
 * bumping `handlebars` in `/shell` also marks the `cypress/yarn.lock` finding
 * as in review. The PR title is shown next to the status — Dependabot writes
 * "… in /shell" into it — so a reader can see which directory moved, rather
 * than having to take the badge's word for it.
 */
export function applyPrs(repo: RepoSecurity, prs: readonly PrFix[]): RepoSecurity {
  const triageCounts = emptyTriageCounts();

  const groups = repo.groups.map((group) => {
    const advisories = group.advisories.map((advisory) => {
      const triaged = withTriage(advisory, prs);

      triageCounts[triaged.triage]++;

      return triaged;
    });

    return {
      ...group,
      advisories,
      triage: worstTriage(advisories.map((a) => a.triage)),
    };
  });

  return {
    ...repo, groups, triageCounts
  };
}

/**
 * Whether this advisory reaches anyone outside the build.
 *
 * `unknown` is the honest answer for a public-data row: an SBOM carries no
 * scope and no manifest path, so there is nothing to judge it on, and grading
 * it `shipped` would invent a fact.
 */
export function exposureOf(advisory: AdvisoryFacts): Exposure {
  if (advisory.scope === 'development') {
    return 'tooling';
  }

  if (!advisory.manifest) {
    return advisory.scope === 'runtime' ? 'shipped' : 'unknown';
  }

  return nonShippedSegment(advisory.manifest) ? 'tooling' : 'shipped';
}

/**
 * The path segment that marked a manifest as tooling, for the UI to quote.
 *
 * Returned rather than kept private because a bare "not shipped" badge is an
 * assertion the reader cannot check. Naming `cypress` lets them disagree.
 */
export function nonShippedSegment(manifest: string | null): string | null {
  if (!manifest) {
    return null;
  }

  // The filename is dropped: a lockfile called `test` would not mean anything,
  // and `docs/yarn.lock` should match on `docs` rather than on `yarn.lock`.
  const segments = manifest.split('/').slice(0, -1);

  return segments.find((segment) => NON_SHIPPED_PATH_SEGMENTS.has(segment.toLowerCase())) || null;
}

/**
 * Which package manager owns a manifest.
 *
 * Read off the lockfile name rather than assumed. A bare `package.json` — the
 * manifest Dependabot files *direct* dependency alerts against — names no
 * manager, and there it falls back to yarn: every repository this page reads
 * resolves through a `yarn.lock` (verified across `rancher/dashboard` and the
 * six published extension repos), and the Rancher extension toolchain builds
 * with yarn. It is the one assumption in this file, and it is confined to the
 * `package.json` case.
 */
function packageManagerFor(manifest: string): PackageManager {
  const file = manifest.split('/').pop() || '';

  if (file === 'package-lock.json' || file === 'npm-shrinkwrap.json') {
    return 'npm';
  }

  if (file === 'pnpm-lock.yaml') {
    return 'pnpm';
  }

  return 'yarn';
}

/** The `package.json` that sits beside a manifest, which is what gets edited. */
function manifestPackageJson(manifest: string): string {
  const dir = manifest.split('/').slice(0, -1).join('/');

  return dir ? `${ dir }/package.json` : 'package.json';
}

/**
 * How to clear one advisory, or null when nothing honest can be said.
 *
 * Null for any ecosystem but npm. Go, PyPI and Maven rows arrive from OSV with
 * no manifest and no lockfile, and a plausible-looking command for the wrong
 * toolchain is worse than no button at all.
 *
 * The direct/transitive split is the point of this function rather than a
 * detail of it: all 18 of `rancher/dashboard`'s open alerts are transitive, and
 * `yarn upgrade` does not move a transitive dependency. Printing one would be
 * advice that quietly fails.
 */
export function remediationCommand(advisory: AdvisoryFacts): Remediation | null {
  const version = advisory.patchedVersion;

  if (!version || advisory.ecosystem.toLowerCase() !== 'npm' || !advisory.manifest) {
    return null;
  }

  const manager = packageManagerFor(advisory.manifest);
  const name = advisory.packageName;

  if (advisory.relationship === 'direct') {
    const command = manager === 'npm' ? `npm install ${ name }@^${ version }` : `${ manager } upgrade ${ name }@^${ version }`;

    return {
      command, kind: 'command', file: null
    };
  }

  // Transitive, or a relationship the feed did not state — in which case the
  // override is still correct, just heavier than it needed to be.
  const field = {
    yarn: 'resolutions', npm: 'overrides', pnpm: 'pnpm.overrides'
  }[manager];
  const body = `"${ name }": "^${ version }"`;
  const command = manager === 'pnpm' ? `"pnpm": { "overrides": { ${ body } } }` : `"${ field }": { ${ body } }`;

  return {
    command, kind: 'manifest', file: manifestPackageJson(advisory.manifest)
  };
}
