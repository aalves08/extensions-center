import { Ref, ref } from 'vue';

import { NPM_PACKUMENT, SHELL_LOCKFILE, SHELL_PACKAGE, SHELL_UPGRADE_CONCURRENCY } from '../config/constants';
import { AnalysisTarget } from '../types/analysis';
import { RancherStore } from '../types/rancher';
import { Advisory, RepoSecurity, ShellChannel, ShellUpgrade } from '../types/security';
import { mapWithConcurrency } from '../utils/async';
import { buildRow, byPayoff, Packument, Shipped } from '../utils/shellUpgrade';
import { compareSemver } from '../utils/version';
import { parseYarnLock } from '../utils/yarnLock';
import { resolveTargets } from './useAnalysisTargets';
import { describeGitHubError, useGitHubApi } from './useGitHubApi';

/**
 * Fetching what the shell-upgrade tab needs: the registry metadata, and the
 * shell version frozen into each extension's released lockfile.
 *
 * The judgement about what a bump buys lives in `utils/shellUpgrade.ts`; this
 * only gathers the inputs.
 */

/**
 * Session caches.
 *
 * The packument is ~55KB on the wire and the lockfile reads are a tree plus a
 * file each, so neither is worth paying for twice. It also means the
 * pre-release toggle costs nothing: both channels and every version's
 * dependency list come out of the same document.
 */
let packument: Packument | null = null;
let targets: AnalysisTarget[] | null = null;
const shippedByRef = new Map<string, Shipped>();

export function useShellUpgrade(store: RancherStore) {
  const api = useGitHubApi(store);

  const data: Ref<ShellUpgrade | null> = ref(null);
  const loading = ref(false);

  const fetchPackument = async(): Promise<Packument> => {
    if (!packument) {
      const res = await fetch(NPM_PACKUMENT(SHELL_PACKAGE));

      if (!res.ok) {
        throw new Error(`npm returned ${ res.status } for ${ SHELL_PACKAGE }`);
      }

      packument = await res.json() as Packument;
    }

    return packument;
  };

  /**
   * The `@rancher/shell` version frozen into one extension release.
   *
   * The lockfile is chosen by which copy actually resolves shell rather than by
   * assuming the root: several of these repos carry lockfiles for their tests
   * or a mock server, and reading one of those would report a version the
   * extension never shipped. Shallowest first, so the usual case is one fetch.
   */
  const readShipped = async(target: AnalysisTarget): Promise<Shipped> => {
    let paths: string[];

    try {
      const tree = await api.getTree(target.repo, target.ref);

      paths = tree.tree
        .filter((entry) => entry.type === 'blob' && (entry.path === SHELL_LOCKFILE || entry.path.endsWith(`/${ SHELL_LOCKFILE }`)))
        .map((entry) => entry.path)
        .sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
    } catch {
      return { reason: 'unreadable' };
    }

    if (!paths.length) {
      return { reason: 'no-lockfile' };
    }

    for (const path of paths) {
      // Raw rather than the contents API: it costs nothing against the rate
      // limit. See `getRawText`.
      const text = await api.getRawText(target.repo, target.ref, path).catch(() => null);

      if (!text) {
        continue;
      }

      // One name can resolve to several versions — nested `node_modules` are
      // exactly that — so take the highest. Two copies of shell in one
      // extension does not occur today, and if it did, the newer one is what an
      // upgrade has to clear.
      const versions = parseYarnLock(text).get(SHELL_PACKAGE);

      if (versions?.length) {
        return { version: [...versions].sort(compareSemver).pop(), lockfile: path };
      }
    }

    return { reason: 'not-in-lockfile' };
  };

  const shippedShell = async(target: AnalysisTarget): Promise<Shipped> => {
    const key = `${ target.repo }@${ target.ref }`;
    const hit = shippedByRef.get(key);

    if (hit) {
      return hit;
    }

    const result = await readShipped(target);

    shippedByRef.set(key, result);

    return result;
  };

  /**
   * Every extension's distance from one of shell's two published channels.
   *
   * `repos` is whatever the Security page has loaded. An extension with no
   * findings read yet still gets a row, showing its shipped version and nothing
   * cleared — which is honest, since zero findings *read* is not zero findings,
   * and better than dropping the row and quietly shortening the estate.
   */
  const load = async(channel: ShellChannel, repos: RepoSecurity[]): Promise<ShellUpgrade> => {
    loading.value = true;

    try {
      // Both halves are held between calls, which is what makes the
      // pre-release toggle nearly free: switching channel re-reads the same
      // packument and the same lockfiles and only re-runs the diff.
      const [meta, extensions] = await Promise.all([
        fetchPackument(),
        targets || resolveTargets(store).then((resolved) => {
          targets = resolved;

          return resolved;
        }),
      ]);
      const target = meta['dist-tags'][channel];

      if (!target) {
        throw new Error(`${ SHELL_PACKAGE } has no "${ channel }" dist-tag`);
      }

      // By repo rather than by target id: a repo publishing two extensions
      // raises one set of alerts that both of them ship.
      const openByRepo = new Map<string, Advisory[]>();

      for (const repo of repos) {
        const open = repo.groups.flatMap((group) => group.advisories);

        openByRepo.set(repo.repo, [...(openByRepo.get(repo.repo) || []), ...open]);
      }

      const rows = await mapWithConcurrency(extensions, SHELL_UPGRADE_CONCURRENCY, async(extension) => {
        const shipped = await shippedShell(extension);

        return buildRow(extension, shipped, meta, target, openByRepo.get(extension.repo) || []);
      });

      data.value = {
        channel,
        target,
        rows:      rows.sort(byPayoff),
        fetchedAt: new Date().toISOString(),
      };
    } catch (e) {
      data.value = {
        channel,
        target:    '',
        rows:      [],
        fetchedAt: new Date().toISOString(),
        error:     describeGitHubError(e),
      };
    } finally {
      loading.value = false;
    }

    return data.value as ShellUpgrade;
  };

  /** Drops everything held, so a refresh re-reads the releases and the registry. */
  const invalidate = (): void => {
    shippedByRef.clear();
    packument = null;
    targets = null;
  };

  return {
    data, loading, load, invalidate
  };
}
