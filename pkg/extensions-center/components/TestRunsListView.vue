<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useStore } from 'vuex';
import { Banner } from '@components/Banner';

import RunsTable from './RunsTable.vue';
import SectionHeader from './SectionHeader.vue';
import { useTestRuns } from '../composables/useTestRuns';

/**
 * The full, paginated list view behind both test-run dashboard tiles. The table
 * itself is shared with the tiles — this page adds the header, the error banner
 * and the paging.
 */
const props = defineProps<{
  title: string;
  description: string;
  emptyKey: string;
  repo: string;
  workflowFile: string;
  detailRouteName: string;
}>();

type Done = (ok: boolean) => void;

const PAGE_SIZE = 25;

const store = useStore();

const runs = useTestRuns(store, { repo: props.repo, workflowFile: props.workflowFile }, PAGE_SIZE);

const paginationResult = computed(() => ({
  count: runs.totalCount.value,
  pages: Math.max(1, Math.ceil(runs.totalCount.value / PAGE_SIZE)),
}));

async function refresh(done?: Done) {
  await runs.refresh();
  done?.(!runs.error.value);
}

function onPaginationChanged(event: { page: number }) {
  runs.setPage(event.page);
}

onMounted(() => refresh());
</script>

<template>
  <div class="test-runs-list">
    <SectionHeader
      :title="title"
      :description="description"
      :last-refreshed="runs.lastRefreshed.value"
      :loading="runs.loading.value"
      @refresh="refresh"
    />

    <Banner
      v-if="runs.error.value"
      color="error"
      :label="runs.error.value"
    />

    <RunsTable
      :runs="runs.data.value"
      :loading="runs.loading.value"
      :empty-key="emptyKey"
      :detail-route-name="detailRouteName"
      :rows-per-page="PAGE_SIZE"
      :pagination-result="paginationResult"
      @pagination-changed="onPaginationChanged"
    />
  </div>
</template>

<style lang="scss" scoped>
.test-runs-list {
  padding-bottom: 40px;
}
</style>
