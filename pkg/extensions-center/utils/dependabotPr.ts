/**
 * Reading what a Dependabot pull request actually bumps.
 *
 * Every other field on the PR is ambiguous, and all three of the obvious ones
 * were checked against live PRs on `rancher/dashboard` before settling here:
 *
 * - The **title** names one package even when the PR bumps several. #18965 is
 *   titled "Bump jest and associated dependencies to 30.5.1" and carries three
 *   commits, none of whose trailers say `jest`. This is the exact failure the
 *   header of `types/security.ts` already warns about.
 * - The **branch** strips the scope's `@`, which makes the directory/package
 *   split unrecoverable: `dependabot/npm_and_yarn/shell/types/semver-7.8.0` is
 *   either `@types/semver` in `/shell` or `semver` in `/shell/types`, and
 *   nothing in the name says which.
 * - The **body** carries no machine-readable form of it at all.
 *
 * What is authoritative is the `updated-dependencies:` trailer Dependabot
 * writes into each commit message — the same source `dependabot/fetch-metadata`
 * reads:
 *
 * ```
 * ---
 * updated-dependencies:
 * - dependency-name: handlebars
 *   dependency-version: 4.7.10
 *   dependency-type: indirect
 * ...
 * ```
 *
 * One commit per package, so a multi-package PR has to be read commit by
 * commit rather than once.
 */

/** One package a commit moves, and the version it moves to. */
export interface UpdatedDependency {
  name: string;
  version: string;
}

/** Opens the block. Everything before it is prose. */
const BLOCK_START = 'updated-dependencies:';

/**
 * Closes it.
 *
 * `...` is YAML's end-of-document marker and is what Dependabot emits; a blank
 * line does not end the block, so it cannot be used as the terminator.
 */
const BLOCK_END = '...';

const NAME = /^-\s+dependency-name:\s*(\S+)\s*$/;
const VERSION = /^\s+dependency-version:\s*(\S+)\s*$/;

/**
 * Dependabot quotes a scoped name and leaves a bare one alone — verified
 * across the open PRs on `rancher/dashboard`, which carry both
 * `- dependency-name: "@types/semver"` and `- dependency-name: handlebars`.
 *
 * The quotes have to come off here. Everything downstream joins this against
 * `Advisory.packageName`, which is `@types/semver`, so leaving them on would
 * silently never match a scoped package — and a scoped package is exactly the
 * kind this repo has most of.
 */
function unquote(name: string): string {
  return name.replace(/^["']|["']$/g, '');
}

/**
 * Every package/version pair in one commit message.
 *
 * Scanned line by line rather than parsed as YAML: the shape is fixed and
 * emitted by a bot, and a parser would be a dependency for one known grammar.
 *
 * An entry with a name but no version is dropped. Older Dependabot wrote
 * `dependency-version` only for some update types, and a name on its own
 * cannot be compared against a patched version — which is the only thing a
 * caller wants this for.
 */
export function parseUpdatedDependencies(commitMessage: string): UpdatedDependency[] {
  const lines = (commitMessage || '').split('\n');
  const start = lines.findIndex((line) => line.trim() === BLOCK_START);

  if (start === -1) {
    return [];
  }

  const out: UpdatedDependency[] = [];
  let name: string | null = null;

  for (const line of lines.slice(start + 1)) {
    if (line.trim() === BLOCK_END) {
      break;
    }

    const named = NAME.exec(line);

    if (named) {
      // A new entry begins, so whatever came before it never found a version.
      name = unquote(named[1]);
      continue;
    }

    const versioned = VERSION.exec(line);

    if (versioned && name) {
      out.push({ name, version: versioned[1] });
      name = null;
    }
  }

  return out;
}
