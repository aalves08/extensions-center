<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useStore } from 'vuex';
import { Banner } from '@components/Banner';

import CategorySummaryPanel from '../components/CategorySummary.vue';
import KnownReposTable from '../components/KnownReposTable.vue';
import SectionHeader from '../components/SectionHeader.vue';
import { DASHBOARD_ROW_LIMIT } from '../config/constants';
import { useKnownRepos } from '../composables/useKnownRepos';

type Done = (ok: boolean) => void;

const store = useStore();
const knownRepos = useKnownRepos(store);

/** Unlike the dashboard tile, this view lists official repos too. */
const description = computed(() => {
  return store.getters['i18n/t']('extensionsCenter.knownRepos.description', { count: DASHBOARD_ROW_LIMIT });
});

const refreshHint = computed(() => store.getters['i18n/t']('extensionsCenter.knownRepos.refreshCost'));

/** Same expensive rebuild as the dashboard tile, and the only thing that runs it. */
async function rebuild(done?: Done) {
  await knownRepos.rebuild();
  done?.(!knownRepos.error.value);
}

// Reads the saved table. Opening this page costs one Kubernetes call.
onMounted(() => knownRepos.load());
</script>

<template>
  <div class="known-repos">
    <SectionHeader
      :title="t('extensionsCenter.knownRepos.listTitle')"
      :description="description"
      :last-refreshed="knownRepos.lastRefreshed.value"
      :loading="knownRepos.loading.value"
      :refresh-hint="refreshHint"
      @refresh="rebuild"
    />

    <Banner
      v-if="knownRepos.error.value"
      color="error"
      :label="knownRepos.error.value"
    />

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

    <div class="layout">
      <KnownReposTable
        paging
        :rows="knownRepos.data.value"
        :loading="knownRepos.loading.value"
      />

      <aside>
        <h3>{{ t('extensionsCenter.knownRepos.summary.title') }}</h3>
        <CategorySummaryPanel :summary="knownRepos.summary.value" />
      </aside>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.known-repos {
  padding-bottom: 40px;

  .layout {
    display: grid;
    gap: 24px;
    grid-template-columns: minmax(0, 1fr) 280px;
  }

  aside {
    background: var(--box-bg);
    border: 1px solid var(--border);
    border-radius: var(--border-radius);
    height: fit-content;
    padding: 16px;

    h3 {
      margin: 0 0 12px;
    }
  }
}

@media (max-width: 1100px) {
  .known-repos .layout {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
