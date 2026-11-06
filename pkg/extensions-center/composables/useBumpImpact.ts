import { computed, ref, Ref } from 'vue';

import { DASHBOARD_REPO } from '../config/constants';
import { AnalysisTarget } from '../types/analysis';
import { RancherStore, errorMessage } from '../types/rancher';
import { PrFix } from '../types/security';
import {
  assessBumps, CurrentVersions, PackageImpact, parseBump, parsePrRef, staleExtensions
} from '../utils/bumpImpact';
import { resolveTargets } from './useAnalysisTargets';
import { useBundleAnalysis } from './useBundleAnalysis';
import { useDependabotPrs } from './useDependabotPrs';
import { describeGitHubError } from './useGitHubApi';
import { useImportAnalysis } from './useImportAnalysis';
import { useInventory } from './useInventory';
import { clearRepoLayoutCache } from './useRepoExtensions';

/**
 * The dependency-impact page's state: which bumps are being asked about, how
 * far they reach, and how much of the answer is still true.
 *
 * Reads three cached documents and writes none of them except through a
 * single-extension refresh. Opening the page costs three Kubernetes reads and
 * no GitHub traffic at all; everything beyond that is an explicit action.
 *
 * The freshness check is kept separate from `load` on purpose. It is the only
 * thing here that can turn a confident answer into "unknown", and a check that
 * ran silently on mount would make the same table mean different things
 * depending on whether the network happened to be quick — so it is a button,
 * and until it is pressed every row says it has not been checked.
 */
export function useBumpImpact(store: RancherStore) {
  const inventory = useInventory(store);
  const imports = useImportAnalysis(store);
  const bundles = useBundleAnalysis(store);
  const prs = useDependabotPrs(store);

  const bumps: Ref<PrFix[]> = ref([]);
  const loading = ref(false);
  const reading = ref(false);
  const checking = ref(false);
  /** Name of the extension currently being re-analysed, so its row can say so */
  const refreshing: Ref<string | null> = ref(null);
  const error: Ref<string | null> = ref(null);
  /** Set when what was typed could not be read, which is not a failure worth a red banner */
  const inputError: Ref<string | null> = ref(null);

  /**
   * Latest released version per extension, once a check has run.
   *
   * Null rather than an empty object before then: "no extension is behind" and
   * "nobody has looked" are different claims, and only the second one is true
   * on arrival.
   */
  const current: Ref<CurrentVersions | null> = ref(null);
  const checkedAt: Ref<Date | null> = ref(null);

  /** Targets from the last check, reused so a refresh does not resolve them twice. */
  const targets: Ref<AnalysisTarget[]> = ref([]);

  const impacts = computed<PackageImpact[]>(() => assessBumps(
    bumps.value,
    {
      inventory: inventory.doc.value,
      imports:   imports.doc.value,
      bundles:   bundles.doc.value,
    },
    current.value,
  ));

  const stale = computed(() => staleExtensions(impacts.value));

  /**
   * Documents that have never been built, by name.
   *
   * Surfaced rather than silently treated as "found nothing": a missing
   * inventory makes every row `unknown`, and without saying which document is
   * absent the page looks broken instead of unbuilt.
   */
  const missingDocs = computed(() => {
    return [
      inventory.doc.value ? null : 'inventory',
      imports.doc.value ? null : 'imports',
      bundles.doc.value ? null : 'bundles',
    ].filter((name): name is string => !!name);
  });

  /** Read all three cached documents. Three Kubernetes calls, no GitHub traffic. */
  const load = async(): Promise<void> => {
    loading.value = true;
    error.value = null;

    try {
      await Promise.all([inventory.load(), imports.load(), bundles.load()]);
    } finally {
      loading.value = false;
    }
  };

  /** Read the bumps out of a pull request, replacing whatever was being asked about. */
  const loadPr = async(raw: string): Promise<void> => {
    const ref_ = parsePrRef(raw, DASHBOARD_REPO);

    inputError.value = null;

    if (!ref_) {
      inputError.value = store.getters['i18n/t']('extensionsCenter.bumpImpact.errors.badPr');

      return;
    }

    reading.value = true;
    error.value = null;

    try {
      const found = await prs.loadPull(ref_.repo, ref_.number);

      bumps.value = found;

      if (!found.length) {
        // A PR with no `updated-dependencies` trailers is not an error — most
        // pull requests are not Dependabot's — but silently showing an empty
        // table would read as "this PR affects nothing".
        inputError.value = store.getters['i18n/t']('extensionsCenter.bumpImpact.errors.noBumps', { number: ref_.number });
      }
    } catch (e) {
      error.value = describeGitHubError(e);
    } finally {
      reading.value = false;
    }
  };

  /** Add one hand-typed `name@version`, for a bump that has no PR yet. */
  const addBump = (raw: string): void => {
    const parsed = parseBump(raw);

    inputError.value = null;

    if (!parsed) {
      inputError.value = store.getters['i18n/t']('extensionsCenter.bumpImpact.errors.badBump');

      return;
    }

    bumps.value = [...bumps.value, parsed];
  };

  const clearBumps = (): void => {
    bumps.value = [];
    inputError.value = null;
  };

  /**
   * Resolve every official extension's current released version.
   *
   * One manifest read plus releases, tags and a layout listing per repo —
   * seconds, against the minutes a full re-analysis costs. That gap is the
   * whole argument for checking versions rather than trusting the 14-day TTL:
   * the TTL calls an extension stale when it has not released in a fortnight,
   * and calls it current when it released yesterday.
   */
  const checkFreshness = async(): Promise<void> => {
    checking.value = true;
    error.value = null;

    try {
      // A sibling added since the last check should be found, same as both
      // full rebuilds do before resolving.
      clearRepoLayoutCache();

      const resolved = await resolveTargets(store);

      targets.value = resolved;
      current.value = Object.fromEntries(resolved.map((t) => [t.name, t.semver]));
      checkedAt.value = new Date();
    } catch (e) {
      error.value = describeGitHubError(e);
    } finally {
      checking.value = false;
    }
  };

  /**
   * Re-analyse one extension across all three documents.
   *
   * All three, not the two cheap ones, because they only mean anything read at
   * the same version — that is why `resolveTargets` is shared between them in
   * the first place. Refreshing the lockfile and the imports while leaving the
   * bundle at the old release would produce a row whose halves describe
   * different versions of the same extension, which is worse than a row that
   * honestly says it is out of date.
   *
   * Ordered cheapest first so a failure in the expensive bundle pass still
   * leaves the other two current, and the row still improves.
   */
  const refreshExtension = async(name: string): Promise<void> => {
    refreshing.value = name;
    error.value = null;

    try {
      if (!targets.value.length) {
        targets.value = await resolveTargets(store);
      }

      const target = targets.value.find((t) => t.name === name);

      if (!target) {
        // The extension has disappeared from the manifest and the repos since
        // it was analysed. Nothing to re-read it at, and saying so beats
        // leaving the button spinning.
        error.value = store.getters['i18n/t']('extensionsCenter.bumpImpact.errors.noTarget', { name });

        return;
      }

      await inventory.refreshOne(target);
      await imports.refreshOne(target);
      await bundles.refreshOne(target);

      // The check that found this row stale is still the right answer for
      // every other row, so it is kept rather than re-run.
      current.value = { ...(current.value || {}), [name]: target.semver };
    } catch (e) {
      error.value = errorMessage(e);
    } finally {
      refreshing.value = null;
    }
  };

  return {
    bumps,
    impacts,
    stale,
    missingDocs,
    current,
    checkedAt,
    loading,
    reading,
    checking,
    refreshing,
    error,
    inputError,
    /** Progress of the bundle half of a single-extension refresh */
    progress: bundles.progress,
    load,
    loadPr,
    addBump,
    clearBumps,
    checkFreshness,
    refreshExtension,
  };
}
