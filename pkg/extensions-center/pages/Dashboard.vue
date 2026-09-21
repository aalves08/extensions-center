<script setup lang="ts">
import { onMounted, computed } from 'vue';
import { useStore } from 'vuex';
import { Banner } from '@components/Banner';

import CategorySummaryPanel from '../components/CategorySummary.vue';
import DashboardPanel from '../components/DashboardPanel.vue';
import KnownReposTable from '../components/KnownReposTable.vue';
import LinksList from '../components/LinksList.vue';
import OfficialReposTable from '../components/OfficialReposTable.vue';
import RunsTable from '../components/RunsTable.vue';

import {
  ROUTES, BLANK_CLUSTER, DASHBOARD_ROW_LIMIT,
  WORKFLOW_TESTS_REPO, WORKFLOW_TESTS_FILE, COMPAT_TESTS_REPO, COMPAT_TESTS_FILE
} from '../config/constants';
import { EXTENSIONS_DOCS_URL } from '../config/links';
import { useExtensionConfig } from '../composables/useExtensionConfig';
import { useKnownRepos } from '../composables/useKnownRepos';
import { useOfficialRepos } from '../composables/useOfficialRepos';
import { useProxyEndpoint } from '../composables/useProxyEndpoint';
import { useTestRuns } from '../composables/useTestRuns';

type Done = (ok: boolean) => void;

defineOptions({ name: 'ExtensionsCenterDashboard' });

const store = useStore();

const { hasGithubToken, load: loadConfig } = useExtensionConfig(store);

const workflowRuns = useTestRuns(store, { repo: WORKFLOW_TESTS_REPO, workflowFile: WORKFLOW_TESTS_FILE }, DASHBOARD_ROW_LIMIT);
const compatRuns = useTestRuns(store, { repo: COMPAT_TESTS_REPO, workflowFile: COMPAT_TESTS_FILE }, DASHBOARD_ROW_LIMIT);
const officialRepos = useOfficialRepos(store);
const knownRepos = useKnownRepos(store);
const proxyEndpoint = useProxyEndpoint(store);

const settingsRoute = { name: ROUTES.SETTINGS, params: { cluster: BLANK_CLUSTER } };

const workflowTestsRoute = { name: ROUTES.WORKFLOW_TESTS, params: { cluster: BLANK_CLUSTER } };
const compatTestsRoute = { name: ROUTES.COMPAT_TESTS, params: { cluster: BLANK_CLUSTER } };
const knownReposRoute = { name: ROUTES.KNOWN_REPOS, params: { cluster: BLANK_CLUSTER } };

/** The dashboard tile shows the most popular community extensions only. */
const topCommunity = computed(() => knownRepos.community.value.slice(0, DASHBOARD_ROW_LIMIT));

const knownReposDescription = computed(() => {
  return store.getters['i18n/t']('extensionsCenter.knownRepos.description', { count: DASHBOARD_ROW_LIMIT });
});

/** Wraps a composable refresh so AsyncButton gets its success/failure callback. */
function wrap(source: { refresh: () => Promise<void>; error: { value: string | null } }) {
  return async(done?: Done) => {
    await source.refresh();
    done?.(!source.error.value);
  };
}

const refreshWorkflowRuns = wrap(workflowRuns);
const refreshCompatRuns = wrap(compatRuns);
const refreshOfficialRepos = wrap(officialRepos);

/**
 * The known-extensions tile refreshes differently from the other three.
 *
 * Theirs re-reads a page of GitHub data. This one re-runs a code search and two
 * calls per repo found, so it is wired to `rebuild` and nothing triggers it
 * except this button.
 */
const rebuildKnownRepos = wrap({ refresh: knownRepos.rebuild, error: knownRepos.error });

const knownReposRefreshHint = computed(() => store.getters['i18n/t']('extensionsCenter.knownRepos.refreshCost'));

async function refreshAll(done?: Done) {
  // Deliberately excludes the known-extensions rebuild. "Refresh all" is a
  // cheap catch-up on live data; the expensive table has its own button so the
  // cost is never something a user runs into sideways.
  const results = await Promise.allSettled([
    workflowRuns.refresh(), compatRuns.refresh(), officialRepos.refresh(),
  ]);

  done?.(results.every((r) => r.status === 'fulfilled'));
}

onMounted(async() => {
  // Credentials first: every other request wants the GitHub token, and loading
  // it once here keeps the refreshes below from racing for it.
  await loadConfig();

  // Register api.github.com with Rancher's proxy before anything tries to use
  // it. Code search cannot be called from a browser at all without this, and
  // getting it in place on entry means an admin never has to apply YAML by
  // hand. Failures here are reported, not thrown — the rest of the page works.
  await proxyEndpoint.ensure();

  // Reads the cached table out of the ConfigMap. No GitHub calls, no model.
  await Promise.allSettled([refreshAll(), knownRepos.load()]);
});
</script>

<template>
  <div class="extensions-center">
    <header class="page-header">
      <h1>{{ t('extensionsCenter.dashboard.title') }}</h1>
      <p class="text-muted">
        {{ t('extensionsCenter.dashboard.subtitle') }}
      </p>
    </header>

    <Banner
      v-if="!hasGithubToken"
      color="warning"
      class="config-banner"
    >
      <div class="banner-content">
        <div>
          <strong>{{ t('extensionsCenter.dashboard.configMissing.title') }}</strong>
          <p>{{ t('extensionsCenter.dashboard.configMissing.message') }}</p>
        </div>
        <router-link
          :to="settingsRoute"
          class="btn role-secondary"
        >
          {{ t('extensionsCenter.dashboard.configMissing.action') }}
        </router-link>
      </div>
    </Banner>

    <Banner
      v-if="proxyEndpoint.state.value === 'forbidden'"
      color="warning"
      :label="t('extensionsCenter.dashboard.proxyForbidden')"
    />
    <Banner
      v-else-if="proxyEndpoint.state.value === 'error'"
      color="warning"
      :label="t('extensionsCenter.dashboard.proxyError', { message: proxyEndpoint.error.value })"
    />

    <!-- Row 1: the two test suites, side by side -->
    <div class="grid grid-2">
      <DashboardPanel
        :title="t('extensionsCenter.workflowTests.title')"
        :view-all-to="workflowTestsRoute"
        :last-refreshed="workflowRuns.lastRefreshed.value"
        :loading="workflowRuns.loading.value"
        :error="workflowRuns.error.value"
        @refresh="refreshWorkflowRuns"
      >
        <RunsTable
          compact
          :runs="workflowRuns.data.value"
          :loading="workflowRuns.loading.value"
          empty-key="extensionsCenter.workflowTests.empty"
          :detail-route-name="ROUTES.WORKFLOW_TEST_DETAIL"
        />
      </DashboardPanel>

      <DashboardPanel
        :title="t('extensionsCenter.compatTests.title')"
        :view-all-to="compatTestsRoute"
        :last-refreshed="compatRuns.lastRefreshed.value"
        :loading="compatRuns.loading.value"
        :error="compatRuns.error.value"
        @refresh="refreshCompatRuns"
      >
        <RunsTable
          compact
          :runs="compatRuns.data.value"
          :loading="compatRuns.loading.value"
          empty-key="extensionsCenter.compatTests.empty"
          :detail-route-name="ROUTES.COMPAT_TEST_DETAIL"
        />
      </DashboardPanel>
    </div>

    <!-- Row 2: where extensions come from -->
    <div class="grid grid-2">
      <DashboardPanel
        :title="t('extensionsCenter.officialRepos.title')"
        :last-refreshed="officialRepos.lastRefreshed.value"
        :loading="officialRepos.loading.value"
        :error="officialRepos.error.value"
        @refresh="refreshOfficialRepos"
      >
        <OfficialReposTable
          :rows="officialRepos.data.value"
          :loading="officialRepos.loading.value"
        />
      </DashboardPanel>

      <DashboardPanel
        :title="t('extensionsCenter.knownRepos.title')"
        :view-all-to="knownReposRoute"
        :last-refreshed="knownRepos.lastRefreshed.value"
        :loading="knownRepos.loading.value"
        :error="knownRepos.error.value"
        :refresh-hint="knownReposRefreshHint"
        @refresh="rebuildKnownRepos"
      >
        <Banner
          v-if="knownRepos.needsBuild.value"
          color="info"
          :label="t('extensionsCenter.knownRepos.notBuilt')"
        />
        <Banner
          v-else-if="knownRepos.stale.value"
          color="info"
          :label="t('extensionsCenter.knownRepos.stale')"
        />
        <KnownReposTable
          compact
          :rows="topCommunity"
          :loading="knownRepos.loading.value"
        />
      </DashboardPanel>
    </div>

    <!-- Row 3: context around the tables above -->
    <div class="grid grid-3">
      <DashboardPanel
        static
        :title="t('extensionsCenter.knownRepos.summary.title')"
      >
        <CategorySummaryPanel
          :summary="knownRepos.summary.value"
          :description="knownReposDescription"
        />
      </DashboardPanel>

      <DashboardPanel
        static
        :title="t('extensionsCenter.links.title')"
      >
        <LinksList />
      </DashboardPanel>

      <DashboardPanel
        static
        :title="t('extensionsCenter.actions.title')"
      >
        <div class="actions">
          <!-- <button
            type="button"
            class="btn role-primary"
            :disabled="knownRepos.loading.value"
            @click="refreshAll()"
          >
            <i class="icon icon-refresh" />
            {{ t('extensionsCenter.actions.refreshAll') }}
          </button> -->

          <router-link
            :to="settingsRoute"
            class="btn role-secondary"
          >
            {{ t('extensionsCenter.actions.openSettings') }}
          </router-link>

          <a
            :href="EXTENSIONS_DOCS_URL"
            target="_blank"
            rel="noopener noreferrer"
            class="btn role-secondary"
          >
            {{ t('extensionsCenter.actions.openDocs') }}
            <i class="icon icon-external-link" />
          </a>
        </div>
      </DashboardPanel>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.extensions-center {
  display: flex;
  flex-direction: column;
  gap: 20px;
  // Only the bottom is ours. The shell puts $space-m around every `.outlet`,
  // and the shorthand would have wiped that out on the other three sides —
  // which is what left this view flush against the edges.
  padding-bottom: 40px;

  .page-header {
    h1 {
      margin: 0;
    }

    p {
      margin: 4px 0 0;
    }
  }

  .config-banner {
    margin: 0;

    .banner-content {
      align-items: center;
      display: flex;
      gap: 16px;
      justify-content: space-between;
      width: 100%;

      p {
        margin: 4px 0 0;
      }
    }
  }

  .grid {
    display: grid;
    gap: 20px;

    &.grid-2 {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    &.grid-3 {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }

  .actions {
    align-items: flex-start;
    display: flex;
    flex-direction: column;
    gap: 8px;

    .btn {
      width: 100%;
    }
  }
}

// Stack the grids rather than squeezing tables on narrow viewports.
@media (max-width: 1100px) {
  .extensions-center .grid.grid-2,
  .extensions-center .grid.grid-3 {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
