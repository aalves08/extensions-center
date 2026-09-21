import { PackageJson } from '../types/github';

/**
 * Minimal semver helpers.
 *
 * The extension only ever compares and sorts version strings that come from npm
 * or from the ui-plugin-charts manifest, so a full semver dependency would be
 * more than this needs.
 */

const PARTS = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-.]+))?/;

/** Negative when `a` sorts before `b`, positive when after, 0 when equal. */
export function compareSemver(a: string, b: string): number {
  const pa = PARTS.exec(a);
  const pb = PARTS.exec(b);

  // Anything unparseable sorts last but keeps a stable order among itself.
  if (!pa && !pb) {
    return a.localeCompare(b);
  }
  if (!pa) {
    return 1;
  }
  if (!pb) {
    return -1;
  }

  for (let i = 1; i <= 3; i++) {
    const diff = Number(pa[i]) - Number(pb[i]);

    if (diff !== 0) {
      return diff;
    }
  }

  const prereleaseA = pa[4];
  const prereleaseB = pb[4];

  // A release outranks a prerelease of the same version.
  if (!prereleaseA && prereleaseB) {
    return 1;
  }
  if (prereleaseA && !prereleaseB) {
    return -1;
  }
  if (!prereleaseA && !prereleaseB) {
    return 0;
  }

  return String(prereleaseA).localeCompare(String(prereleaseB));
}

/** Highest version in the list, or null when the list is empty. */
export function latestVersion(versions: string[]): string | null {
  if (!versions?.length) {
    return null;
  }

  return [...versions].sort(compareSemver).pop() || null;
}

/** True for `1.2.3-rc.1` and anything else carrying a prerelease suffix. */
export function isPrerelease(version: string): boolean {
  return !!PARTS.exec(version)?.[4];
}

/**
 * Highest released version, ignoring prereleases entirely.
 *
 * `latestVersion` only ranks a prerelease below its own release, so a repo
 * whose newest publish is `3.0.2-rc.996` still reports that as its latest.
 * Comparing what a team has shipped against what the official charts carry only
 * makes sense between finished releases, hence this second entry point.
 */
export function latestStableVersion(versions: string[]): string | null {
  return latestVersion((versions || []).filter((v) => !isPrerelease(v)));
}

/**
 * Pull a dependency's version range out of a parsed package.json, checking every
 * section an extension might realistically declare it in.
 */
export function dependencyVersion(pkg: PackageJson | null, name: string): string | null {
  if (!pkg) {
    return null;
  }

  const sections: (keyof PackageJson)[] = ['dependencies', 'devDependencies', 'peerDependencies', 'resolutions'];

  for (const section of sections) {
    const value = pkg[section]?.[name];

    if (value) {
      return String(value);
    }
  }

  return null;
}
