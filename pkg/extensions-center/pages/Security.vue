<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { useStore } from 'vuex';
import { Banner } from '@components/Banner';
import { Checkbox } from '@components/Form/Checkbox';
import AsyncButton from '@shell/components/AsyncButton.vue';
import Tabbed from '@shell/components/Tabbed/index.vue';
import Tab from '@shell/components/Tabbed/Tab.vue';

import AnalysisProgressBar from '../components/AnalysisProgressBar.vue';
import PackageSearch from '../components/PackageSearch.vue';
import ReachTable from '../components/ReachTable.vue';
import SecurityRepoPanel from '../components/SecurityRepoPanel.vue';
import SectionHeader from '../components/SectionHeader.vue';
import SeverityAmountBar from '../components/SeverityAmountBar.vue';
import ShellUpgradeTable from '../components/ShellUpgradeTable.vue';
import { SECURITY_OVERDUE_DAYS, SECURITY_STALE_HOURS } from '../config/constants';
import { useBundleAnalysis } from '../composables/useBundleAnalysis';
import { useInventory } from '../composables/useInventory';
import { useRepoSecurity } from '../composables/useRepoSecurity';
import { useShellUpgrade } from '../composables/useShellUpgrade';
import { RancherStore } from '../types/rancher';
import { RepoSecurity, SecurityTarget, SEVERITIES } from '../types/security';
import { buildReach } from '../utils/vulnReach';
import { useTranslation } from '../utils/i18n';

const t = useTranslation();

type Done = (ok: boolean) => void;

// Named explicitly because the filename on its own is a single word, which
// vue/multi-word-component-names rejects.
defineOptions({ name: 'SecurityOverview' });

const store = useStore() as unknown as RancherStore;
const route = useRoute();
const security = useRepoSecurity(store);

// Read-only here. The reach view consumes whatever Bundle Analysis last
// persisted and never triggers a rebuild of it: that is a multi-minute,
// hundred-megabyte job and it belongs behind its own page's explicit button,
// not behind opening a tab.
const bundles = useBundleAnalysis(store);

/** The one thing this page drives on shell's Tabbed: jumping to a named tab. */
interface TabbedApi {
  select: (name: string) => void;
}

/**
 * Tab id of the estate view.
 *
 * Reads as a URL hash like every other tab, and cannot collide with a target
 * id because `uniqueId` has already claimed the ones in use.
 */
const ROLLUP = 'all-repos';

/** Tab id of the cross-repo reach view. Same constraints as `ROLLUP`. */
const REACH = 'by-package';

/** Tab id of the shell-upgrade view. Same constraints as `ROLLUP`. */
const SHELL = 'shell-upgrade';

/** Tab id of the package search. Same constraints as `ROLLUP`. */
const SEARCH = 'find-package';

/** Tabs that are views over the estate rather than over one repository. */
const CROSS_REPO = [ROLLUP, REACH, SHELL, SEARCH];

const tabbed = ref<TabbedApi | null>(null);
const activeTab = ref(ROLLUP);

// Owned by the composable, not the page: it has to survive the page being
// unmounted, or returning to a loaded estate shows the "this costs a minute"
// prompt over a table that is already filled in.
const rollupLoaded = security.rollupLoaded;

/**
 * The tab the URL asked for, captured here in setup and nowhere later.
 *
 * It has to be read before Tabbed mounts. Tabbed only consults the hash while
 * it has no active tab, and at that moment the only tab that exists is the
 * estate one — the rest are behind a manifest fetch. So it fails to match,
 * falls back to `defaultTab`, and rewrites the hash to `#all-repos` on its way
 * past. Read this in `onMounted` and you are reading what Tabbed just wrote.
 */
const linkedTab = route.hash.slice(1);

const rollup = computed(() => security.rollup());
const severities = SEVERITIES;

/**
 * Vulnerable packages crossed against what the published bundles contain.
 *
 * Built from whatever repos are loaded rather than requiring all of them, so
 * the tab is useful after one repo and complete after the estate button. The
 * header says how many went into it, because a reach table over three repos
 * and one over sixteen look identical and mean very different things.
 */
const reach = computed(() => {
  const repos = Object.values(security.loaded.value) as RepoSecurity[];

  return buildReach(repos, bundles.doc.value);
});

const reachRepos = computed(() => Object.keys(security.loaded.value).length);

// ─── Shell upgrade ───────────────────────────────────────────────────────────

const shell = useShellUpgrade(store);

/**
 * Whether the target is shell's `pre-release` tag rather than `latest`.
 *
 * Off by default, and a real choice rather than a display option: 3.0.13 to
 * 3.0.14-rc.4 moves another 26 dependencies, so an extension can sometimes
 * only clear a finding by taking the release candidate — which is a decision
 * about what to ship, not about what to look at.
 */
const preRelease = ref(false);

/**
 * Read the shipped shell versions, against whichever channel is selected.
 *
 * Cheap after the first call: the composable holds the registry document, the
 * resolved targets and every lockfile it has read, so toggling the channel
 * re-runs the diff rather than the fetches.
 */
function onPreRelease(value: boolean) {
  preRelease.value = value;
  loadShell();
}

async function loadShell(force = false) {
  if (force) {
    shell.invalidate();
  }

  await shell.load(preRelease.value ? 'pre-release' : 'latest', Object.values(security.loaded.value) as RepoSecurity[]);
}

// ─── Package search ──────────────────────────────────────────────────────────

const inventory = useInventory(store);

/**
 * Distinct package names across the whole inventory.
 *
 * Shown in the coverage line so the number the search is drawing on is stated
 * rather than implied — "not found" means something quite different against
 * 20,000 names than against 200.
 */
const inventoryPackages = computed(() => {
  const names = new Set<string>();

  for (const ext of inventory.doc.value?.extensions || []) {
    for (const pkg of Object.keys(ext.packages)) {
      names.add(pkg);
    }
  }

  return names.size;
});

const searchRepos = computed(() => Object.values(security.loaded.value) as RepoSecurity[]);

async function buildInventory(done?: Done) {
  await inventory.rebuild();
  done?.(true);
}

/**
 * "Last refreshed" for whatever is on screen.
 *
 * Per-tab rather than per-page: tabs are loaded one at a time and on demand, so
 * a single page-level timestamp would be wrong for every tab but the last one
 * opened.
 */
const lastRefreshed = computed(() => {
  // The shell tab is read from npm and from the release tags rather than from
  // the persisted security document, so it ages on its own clock.
  if (activeTab.value === SHELL) {
    return shell.data.value ? new Date(shell.data.value.fetchedAt) : null;
  }

  // The inventory is its own document in its own ConfigMap, read on its own
  // schedule, so it reports its own age too.
  if (activeTab.value === SEARCH) {
    return inventory.doc.value ? new Date(inventory.doc.value.fetchedAt) : null;
  }

  // The reach tab is a view over everything already loaded, so it is exactly
  // as current as the oldest of them — the same answer the estate gives.
  if (activeTab.value === ROLLUP || activeTab.value === REACH) {
    return rollupLoaded.value || activeTab.value === REACH ? security.lastRefreshed() : null;
  }

  return security.lastRefreshed([activeTab.value]);
});

const busy = computed(() => {
  return !!security.rollupProgress.value || !!security.loading.value[activeTab.value] ||
    (activeTab.value === SHELL && shell.loading.value) ||
    (activeTab.value === SEARCH && (inventory.loading.value || inventory.rebuilding.value));
});

/**
 * How much the page should say about the age of what is on screen.
 *
 * Nothing here triggers a re-read. The data is persisted between visits, so it
 * can be arbitrarily old, and the page's obligation is to say so rather than
 * to quietly spend minutes of someone's time fixing it. Two steps because they
 * are two different messages — see `SECURITY_STALE_HOURS`.
 */
const freshness = computed<'fresh' | 'stale' | 'overdue'>(() => {
  const at = lastRefreshed.value;

  if (!at) {
    return 'fresh';
  }

  const hours = (Date.now() - at.getTime()) / 3_600_000;

  if (hours >= SECURITY_OVERDUE_DAYS * 24) {
    return 'overdue';
  }

  return hours >= SECURITY_STALE_HOURS ? 'stale' : 'fresh';
});

/**
 * Load a repo when its tab is first opened.
 *
 * Lazily, because a tab costs a paginated alert pull or an SBOM plus a few
 * dozen OSV calls. Opening the page should not pay for sixteen of those.
 */
async function onTabChange(e: { selectedName: string }) {
  activeTab.value = e.selectedName;

  // Loaded on first open rather than behind a button, unlike the estate: this
  // is one registry document and a lockfile per extension, seconds rather
  // than the minute the estate costs. Re-opening it reuses what it holds.
  if (e.selectedName === SHELL) {
    if (!shell.data.value) {
      await loadShell();
    }

    return;
  }

  // One ConfigMap read, and only the first time. Building it is a separate,
  // explicit press: reading fourteen lockfiles is not something opening a tab
  // should start on someone's behalf.
  if (e.selectedName === SEARCH) {
    if (!inventory.doc.value && !inventory.needsBuild.value) {
      await inventory.load();
    }

    return;
  }

  if (CROSS_REPO.includes(e.selectedName)) {
    return;
  }

  const target = security.targets.value.find((t) => t.id === e.selectedName);

  if (target) {
    await security.loadRepo(target);
  }
}

/**
 * Open a target's tab from the estate table.
 *
 * Tabbed owns which tab is showing, so selecting it there is what actually
 * moves the view; `onTabChange` then fires and does the loading.
 */
function openRepo(id: string) {
  tabbed.value?.select(id);
}

/**
 * The estate view, which needs every repo and so is never automatic.
 *
 * Doubles as this tab's refresh, which is why the header has no refresh button
 * while it is showing: the first press fills the view and reuses whatever
 * individual tabs have already paid for, and every press after that forces a
 * re-read.
 */
async function loadRollup(done?: Done) {
  const force = rollupLoaded.value;

  rollupLoaded.value = true;

  await security.loadTargets(force);
  await security.loadAll(force);

  done?.(true);
}

async function refresh(done?: Done) {
  if (activeTab.value === SHELL) {
    await loadShell(true);
    done?.(true);

    return;
  }

  if (activeTab.value === SEARCH) {
    await inventory.rebuild();
    done?.(true);

    return;
  }

  await security.loadTargets(true);

  const target = security.targets.value.find((t) => t.id === activeTab.value);

  if (target) {
    await security.loadRepo(target, true);
  }

  done?.(true);
}

function tabLabel(target: SecurityTarget): string {
  const loaded = security.loaded.value[target.id];

  if (!loaded || loaded.error) {
    return target.label;
  }

  return `${ target.label } (${ loaded.openTotal })`;
}

onMounted(async() => {
  // One ConfigMap read, no GitHub traffic. Unconditional because the reach tab
  // has to be able to say "bundle analysis has never been run" as distinct
  // from "nothing vulnerable ships", and those look identical until this
  // returns.
  bundles.load();

  await security.loadTargets();

  // After the targets, never before: the stored results are matched against
  // the tab strip, so it has to exist first. One more ConfigMap read, and on a
  // cluster where the estate has been run it is the difference between a
  // filled page and a minutes-long prompt.
  await security.restore();

  if (!linkedTab || linkedTab === activeTab.value || !security.targets.value.some((t) => t.id === linkedTab)) {
    return;
  }

  // The linked tab exists in the data now, but not yet as a component: Tab
  // registers itself with Tabbed from its own `mounted`, so the v-for has to
  // render first. Re-applying the link is the whole point of `linkedTab` —
  // see the comment on it for why Tabbed does not do this itself.
  await nextTick();
  tabbed.value?.select(linkedTab);
});
</script>

<template>
  <div class="security">
    <SectionHeader
      :title="t('extensionsCenter.security.title')"
      :description="t('extensionsCenter.security.description')"
      :last-refreshed="lastRefreshed"
      :loading="busy"
      :hide-refresh="activeTab === 'all-repos'"
      @refresh="refresh"
    />

    <Banner
      v-if="security.targetsError.value"
      color="warning"
      :label="t('extensionsCenter.security.manifestFailed', { message: security.targetsError.value })"
    />

    <!--
      Age, stated rather than acted on. The exact timestamp is already in the
      header directly above, so these name the threshold crossed instead of
      repeating it as a relative time.
    -->
    <Banner
      v-if="freshness === 'overdue'"
      color="warning"
      :label="t('extensionsCenter.security.cache.overdue', { days: SECURITY_OVERDUE_DAYS })"
    />
    <Banner
      v-else-if="freshness === 'stale'"
      color="info"
      :label="t('extensionsCenter.security.cache.stale')"
    />

    <Banner
      v-if="security.cacheError.value"
      color="warning"
      :label="t('extensionsCenter.security.cache.writeFailed', { message: security.cacheError.value })"
    />

    <Tabbed
      ref="tabbed"
      :side-tabs="true"
      :use-hash="true"
      default-tab="all-repos"
      @changed="onTabChange"
    >
      <Tab
        name="all-repos"
        :label="t('extensionsCenter.security.allRepos')"
        :weight="100"
      >
        <AnalysisProgressBar
          :progress="security.rollupProgress.value"
          title-key="extensionsCenter.security.loading"
        />

        <!--
          This button is the whole of this tab's refresh, which is why the
          page header hides its own while the tab is showing.
        -->
        <div class="rollup-load">
          <p
            v-if="!rollupLoaded"
            class="text-muted"
          >
            {{ t('extensionsCenter.security.rollup.explain', { count: security.targets.value.length }) }}
          </p>
          <AsyncButton
            mode="refresh"
            :action-label="t('extensionsCenter.security.rollup.load')"
            :waiting-label="t('extensionsCenter.security.rollup.loading')"
            :disabled="!security.targets.value.length || !!security.rollupProgress.value"
            @click="loadRollup"
          />
        </div>

        <template v-if="rollupLoaded && !security.rollupProgress.value">
          <!--
            Two totals, never one. Public-data counts run higher than
            Dependabot ones because nothing is dismissed and nothing is
            deduplicated, so adding them would produce a headline number that
            overstates exactly the repos we can see least well.
          -->
          <div class="estate">
            <section
              v-for="group in [
                { key: 'dependabot', value: rollup.dependabot },
                { key: 'publicData', value: rollup.publicData },
              ]"
              :key="group.key"
              class="estate-group"
            >
              <h4>
                {{ t(`extensionsCenter.security.rollup.${ group.key }`) }}
                <span class="text-muted">{{ t('extensionsCenter.security.rollup.repoCount', { count: group.value.repos }) }}</span>
              </h4>
              <div class="estate-counts">
                <span
                  v-for="severity in severities"
                  :key="severity"
                  class="estate-count"
                  :class="`sev-${ severity }`"
                >
                  <strong>{{ group.value.counts[severity] }}</strong>
                  {{ t(`extensionsCenter.security.severity.${ severity }`) }}
                </span>
              </div>
            </section>
          </div>

          <Banner
            v-if="rollup.failed.length"
            color="warning"
            :label="t('extensionsCenter.security.rollup.failed', { repos: rollup.failed.join(', ') })"
          />

          <table class="estate-table">
            <thead>
              <tr>
                <th>{{ t('extensionsCenter.security.cols.repo') }}</th>
                <th>{{ t('extensionsCenter.security.cols.source') }}</th>
                <th class="bar-col">
                  {{ t('extensionsCenter.security.cols.vulnerabilities') }}
                </th>
                <th class="num">
                  {{ t('extensionsCenter.security.cols.total') }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="repo in rollup.byRepo"
                :key="repo.id"
              >
                <td>
                  <a
                    href="#"
                    @click.prevent="openRepo(repo.id)"
                  >{{ repo.label }}</a>
                  <span class="text-muted repo-id">{{ repo.repo }}</span>
                </td>
                <td>{{ t(`extensionsCenter.security.source.${ repo.source }`) }}</td>
                <td class="bar-col">
                  <SeverityAmountBar
                    v-if="!repo.error"
                    :counts="repo.counts"
                  />
                  <span
                    v-else
                    class="text-muted"
                  >{{ t('extensionsCenter.common.na') }}</span>
                </td>
                <td class="num">
                  {{ repo.error ? '—' : repo.openTotal }}
                </td>
              </tr>
            </tbody>
          </table>
        </template>
      </Tab>

      <Tab
        name="by-package"
        :label="t('extensionsCenter.security.reach.tab')"
        :weight="99"
      >
        <p class="text-muted reach-intro">
          {{ t('extensionsCenter.security.reach.explain') }}
        </p>

        <!--
          Two different empty states, deliberately. "No bundle analysis" is a
          missing input and has an action; "no repos loaded" is a missing
          input the user supplies from the previous tab. Collapsing them into
          one "nothing to show" would send people looking in the wrong place.
        -->
        <Banner
          v-if="!bundles.doc.value"
          color="info"
          :label="t('extensionsCenter.security.reach.noBundles')"
        />
        <Banner
          v-else-if="!reachRepos"
          color="info"
          :label="t('extensionsCenter.security.reach.noRepos')"
        />

        <template v-else>
          <div class="reach-summary">
            <span>{{ t('extensionsCenter.security.reach.scope', { repos: reachRepos, bundles: reach.bundlesJoined }) }}</span>
            <span class="reach-stat confirmed">
              <strong>{{ reach.confirmed }}</strong>
              {{ t('extensionsCenter.security.reach.stats.confirmed') }}
            </span>
            <span class="reach-stat unconfirmed">
              <strong>{{ reach.unconfirmed }}</strong>
              {{ t('extensionsCenter.security.reach.stats.unconfirmed') }}
            </span>
            <span class="reach-stat">
              <strong>{{ reach.notShipped }}</strong>
              {{ t('extensionsCenter.security.reach.stats.notShipped') }}
            </span>
          </div>

          <ReachTable :rows="reach.rows" />
        </template>
      </Tab>

      <Tab
        name="shell-upgrade"
        :label="t('extensionsCenter.security.shellUpgrade.tab')"
        :weight="98"
      >
        <p class="text-muted shell-intro">
          {{ t('extensionsCenter.security.shellUpgrade.explain') }}
        </p>

        <Banner
          v-if="shell.data.value && shell.data.value.error"
          color="error"
          :label="shell.data.value.error"
        />

        <template v-else>
          <div class="shell-controls">
            <span
              v-if="shell.data.value"
              class="shell-target"
            >
              {{ t('extensionsCenter.security.shellUpgrade.target', { version: shell.data.value.target }) }}
            </span>

            <!--
              A checkbox rather than a second tab: it changes which version the
              same question is asked about, and the answer is directly
              comparable either way.
            -->
            <Checkbox
              :value="preRelease"
              :label="t('extensionsCenter.security.shellUpgrade.includePrereleases')"
              :disabled="shell.loading.value"
              @update:value="onPreRelease"
            />
          </div>

          <!--
            Said once, above the table, because it qualifies every number in
            the cleared column rather than any single row.
          -->
          <Banner
            color="info"
            :label="t('extensionsCenter.security.shellUpgrade.floor')"
          />

          <Banner
            v-if="!reachRepos"
            color="info"
            :label="t('extensionsCenter.security.shellUpgrade.noRepos')"
          />

          <ShellUpgradeTable
            :rows="shell.data.value ? shell.data.value.rows : []"
            :target="shell.data.value ? shell.data.value.target : ''"
            :loading="shell.loading.value"
          />
        </template>
      </Tab>

      <Tab
        name="find-package"
        :label="t('extensionsCenter.security.search.tab')"
        :weight="97"
      >
        <p class="text-muted search-intro">
          {{ t('extensionsCenter.security.search.explain') }}
        </p>

        <AnalysisProgressBar :progress="inventory.progress.value" />

        <Banner
          v-if="inventory.error.value"
          color="warning"
          :label="inventory.error.value"
        />

        <!--
          Building is a press rather than a side effect of opening the tab.
          Fourteen lockfiles is seconds, not minutes, but it is still work
          nobody asked for, and the empty state has to be able to say why the
          box is disabled.
        -->
        <div
          v-if="!inventory.doc.value"
          class="inventory-build"
        >
          <p
            v-if="!inventory.rebuilding.value"
            class="text-muted"
          >
            {{ t('extensionsCenter.security.search.needsBuild') }}
          </p>
          <AsyncButton
            mode="refresh"
            :action-label="t('extensionsCenter.security.search.build')"
            :waiting-label="t('extensionsCenter.security.search.building')"
            :disabled="inventory.rebuilding.value"
            @click="buildInventory"
          />
        </div>

        <template v-else>
          <p class="text-muted coverage">
            {{ t('extensionsCenter.security.search.coverage', {
              count: inventory.doc.value.extensions.length,
              packages: inventoryPackages,
            }) }}
          </p>

          <!--
            Its own staleness note, separate from the page-level one: the
            inventory ages independently of the advisories, and an empty
            result from an old inventory is the specific thing worth warning
            about here.
          -->
          <Banner
            v-if="inventory.stale.value"
            color="info"
            :label="t('extensionsCenter.security.search.stale')"
          />
        </template>

        <PackageSearch
          :inventory="inventory.doc.value"
          :bundles="bundles.doc.value"
          :repos="searchRepos"
        />
      </Tab>

      <Tab
        v-for="(target, i) in security.targets.value"
        :key="target.id"
        :name="target.id"
        :label="tabLabel(target)"
        :weight="90 - i"
      >
        <SecurityRepoPanel
          :data="security.loaded.value[target.id] || null"
          :loading="!!security.loading.value[target.id]"
        />
      </Tab>
    </Tabbed>
  </div>
</template>

<style lang="scss" scoped>
@import '../styles/severity';

.security {
  // The tab body starts hard against the tab strip, so the button needs its
  // own breathing room rather than borrowing the paragraph's.
  .rollup-load {
    margin: 16px 0 24px;

    p {
      margin: 0 0 12px;
      max-width: 70ch;
    }
  }

  .reach-intro,
  .shell-intro,
  .search-intro {
    margin: 16px 0;
    max-width: 90ch;
  }

  .inventory-build {
    margin-bottom: 24px;

    p {
      margin: 0 0 12px;
      max-width: 70ch;
    }
  }

  .coverage {
    font-size: 12px;
    margin: 0 0 12px;
  }

  .shell-controls {
    align-items: center;
    display: flex;
    flex-wrap: wrap;
    gap: 24px;
    margin-bottom: 12px;
  }

  .shell-target {
    font-size: 12px;
  }

  .reach-summary {
    align-items: baseline;
    display: flex;
    flex-wrap: wrap;
    font-size: 12px;
    gap: 20px;
    margin-bottom: 12px;
  }

  .reach-stat {
    align-items: baseline;
    display: flex;
    gap: 4px;

    strong {
      font-size: 18px;
    }

    // Same 3px rule as the estate tiles, for the same reason: the number is
    // the message and the colour only sorts it.
    border-bottom: 3px solid var(--border);

    &.confirmed {
      border-bottom-color: $critical-color;
    }

    &.unconfirmed {
      border-bottom-color: $na-color;
    }
  }

  .estate {
    display: flex;
    flex-wrap: wrap;
    gap: 24px;
    margin-bottom: 16px;
  }

  .estate-group {
    flex: 1 1 280px;

    h4 {
      margin: 0 0 8px;

      .text-muted {
        font-size: 12px;
        font-weight: normal;
        margin-left: 6px;
      }
    }
  }

  .estate-counts {
    display: flex;
    flex-wrap: wrap;
    gap: 16px;
  }

  .estate-count {
    align-items: baseline;
    display: flex;
    font-size: 12px;
    gap: 4px;

    strong {
      font-size: 18px;
    }

    // A 3px underline rather than coloured text: severity is already named in
    // the label beside it, so colour is reinforcement, not the message.
    border-bottom: 3px solid var(--border);

    @include severity-accent('sev-', border-bottom-color);
  }

  .estate-table {
    border-collapse: collapse;
    width: 100%;

    th,
    td {
      border-bottom: 1px solid var(--border);
      padding: 6px 8px;
      text-align: left;
    }

    th {
      color: var(--muted);
      font-size: 12px;
      font-weight: 600;
    }

    .num {
      text-align: right;
    }

    // Wide enough that five segments each stay legible with a four-digit count
    // in them, and fixed so the strips line up down the column — which is the
    // only reason the bar beats five columns of numbers.
    .bar-col {
      min-width: 260px;
      width: 30%;
    }

    .repo-id {
      font-size: 11px;
      margin-left: 8px;
    }
  }
}
</style>
