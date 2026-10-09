<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { useStore } from 'vuex';
import { Banner } from '@components/Banner';
import AsyncButton from '@shell/components/AsyncButton.vue';
import Tabbed from '@shell/components/Tabbed/index.vue';
import Tab from '@shell/components/Tabbed/Tab.vue';

import AnalysisProgressBar from '../components/AnalysisProgressBar.vue';
import SecurityRepoPanel from '../components/SecurityRepoPanel.vue';
import SectionHeader from '../components/SectionHeader.vue';
import { useRepoSecurity } from '../composables/useRepoSecurity';
import { RancherStore } from '../types/rancher';
import { SecurityTarget, SEVERITIES } from '../types/security';

type Done = (ok: boolean) => void;

// Named explicitly because the filename on its own is a single word, which
// vue/multi-word-component-names rejects.
defineOptions({ name: 'SecurityOverview' });

const store = useStore() as unknown as RancherStore;
const route = useRoute();
const security = useRepoSecurity(store);

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

const tabbed = ref<TabbedApi | null>(null);
const activeTab = ref(ROLLUP);
const rollupLoaded = ref(false);

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
 * "Last refreshed" for whatever is on screen.
 *
 * Per-tab rather than per-page: tabs are loaded one at a time and on demand, so
 * a single page-level timestamp would be wrong for every tab but the last one
 * opened.
 */
const lastRefreshed = computed(() => {
  if (activeTab.value === ROLLUP) {
    return rollupLoaded.value ? security.lastRefreshed() : null;
  }

  return security.lastRefreshed([activeTab.value]);
});

const busy = computed(() => {
  return !!security.rollupProgress.value || !!security.loading.value[activeTab.value];
});

/**
 * Load a repo when its tab is first opened.
 *
 * Lazily, because a tab costs a paginated alert pull or an SBOM plus a few
 * dozen OSV calls. Opening the page should not pay for sixteen of those.
 */
async function onTabChange(e: { selectedName: string }) {
  activeTab.value = e.selectedName;

  if (e.selectedName === ROLLUP) {
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

  await security.loadTargets();
  await security.loadAll(force);

  done?.(true);
}

async function refresh(done?: Done) {
  await security.loadTargets();

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
  await security.loadTargets();

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
                <th
                  v-for="severity in severities"
                  :key="severity"
                  class="num"
                >
                  {{ t(`extensionsCenter.security.severity.${ severity }`) }}
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
                <td
                  v-for="severity in severities"
                  :key="severity"
                  class="num"
                >
                  {{ repo.error ? '—' : repo.counts[severity] }}
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

    &.sev-critical { border-bottom-color: var(--error); }
    &.sev-high { border-bottom-color: var(--warning); }
    &.sev-medium { border-bottom-color: var(--info); }
    &.sev-low { border-bottom-color: var(--muted); }
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

    .repo-id {
      font-size: 11px;
      margin-left: 8px;
    }
  }
}
</style>
