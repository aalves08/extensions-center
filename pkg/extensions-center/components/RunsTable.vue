<script setup lang="ts">
import { computed } from 'vue';
import SortableTable from '@shell/components/SortableTable/index.vue';

import RunStatusBadge from './RunStatusBadge.vue';
import { BLANK_CLUSTER } from '../config/constants';
import { TableHeader } from '../types/table';
import { PaginationResult, TestRun } from '../types/tests';
import { formatDuration } from '../utils/runs';

/**
 * The run table shared by the dashboard tiles and the full list views.
 *
 * Both render exactly the same columns — the dashboard tile is just the same
 * table without paging — so there is one place to change when a column moves.
 *
 * GitHub pages runs server-side, so when `paginationResult` is supplied the
 * table runs in external pagination mode: changing page re-fetches rather than
 * slicing a preloaded array, which matters because each page costs one request
 * per run to resolve its jobs.
 */
const props = withDefaults(defineProps<{
  runs: TestRun[];
  loading?: boolean;
  emptyKey: string;
  detailRouteName: string;
  /** Drops the wider columns so the table fits a half-width dashboard tile */
  compact?: boolean;
  rowsPerPage?: number;
  paginationResult?: PaginationResult | null;
}>(), {
  loading:          false,
  compact:          false,
  rowsPerPage:      undefined,
  paginationResult: null,
});

const emit = defineEmits<{(e: 'pagination-changed', event: { page: number }): void }>();

/**
 * Sorting is off across the board: the rows on screen are one server-side page
 * of GitHub's own newest-first ordering, so sorting them locally would only
 * reorder the slice and misrepresent the whole.
 *
 * Which is exactly why this has to be said out loud. With every column
 * unsortable, SortableTable falls back to `['nameSort', 'id']` ascending — runs
 * have no `nameSort`, so the dashboard tile was ordering by run id oldest-first
 * and putting the latest run at the bottom. The full list view escaped it only
 * because external pagination skips local sorting entirely. One mandatory sort
 * makes both paths agree instead of disagreeing by accident.
 */
const MANDATORY_SORT = ['createdAt:desc'];

/** Columns the dashboard tiles drop — they need the width more than the detail. */
const WIDE_COLUMNS = ['started', 'duration'];

const allHeaders: TableHeader[] = [
  {
    name: 'runId', labelKey: 'extensionsCenter.runs.cols.runId', value: 'id', sort: false
  },
  {
    name: 'status', labelKey: 'extensionsCenter.runs.cols.overallStatus', value: 'status', sort: false
  },
  {
    name: 'total', labelKey: 'extensionsCenter.runs.cols.total', value: 'counts.total', align: 'right', sort: false
  },
  {
    name: 'passed', labelKey: 'extensionsCenter.runs.cols.passed', value: 'counts.passed', align: 'right', sort: false
  },
  {
    name: 'skipped', labelKey: 'extensionsCenter.runs.cols.skipped', value: 'counts.skipped', align: 'right', sort: false
  },
  {
    name: 'failed', labelKey: 'extensionsCenter.runs.cols.failed', value: 'counts.failed', align: 'right', sort: false
  },
  {
    name: 'branch', labelKey: 'extensionsCenter.runs.cols.branch', value: 'headBranch', sort: false
  },
  {
    name: 'started', labelKey: 'extensionsCenter.runs.cols.started', value: 'createdAt', sort: false
  },
  {
    name: 'duration', labelKey: 'extensionsCenter.runs.cols.duration', value: 'durationMs', align: 'right', sort: false
  },
  {
    name: 'link', labelKey: 'extensionsCenter.runs.cols.link', value: 'htmlUrl', align: 'center', sort: false
  },
];

const headers = computed(() => {
  return props.compact ? allHeaders.filter((h) => !WIDE_COLUMNS.includes(h.name)) : allHeaders;
});

const paging = computed(() => !!props.paginationResult);

function detailRoute(runId: number) {
  return {
    name:   props.detailRouteName,
    params: { cluster: BLANK_CLUSTER, runId: String(runId) },
  };
}

function started(value: string): string {
  return new Date(value).toLocaleString();
}

function onPaginationChanged(event: { page: number }) {
  emit('pagination-changed', event);
}
</script>

<template>
  <SortableTable
    :headers="headers"
    :rows="runs"
    :loading="loading"
    :mandatory-sort="MANDATORY_SORT"
    key-field="id"
    :table-actions="false"
    :row-actions="false"
    :search="false"
    :paging="paging"
    :rows-per-page="rowsPerPage"
    :external-pagination-enabled="paging"
    :external-pagination-result="paginationResult"
    :no-rows-key="emptyKey"
    @pagination-changed="onPaginationChanged"
  >
    <template #cell:runId="{ row }">
      <router-link :to="detailRoute(row.id)">
        {{ row.id }}
      </router-link>
      <span class="text-muted run-number">#{{ row.runNumber }}</span>
    </template>

    <template #cell:status="{ row }">
      <RunStatusBadge :status="row.status" />
    </template>

    <template #cell:started="{ row }">
      {{ started(row.createdAt) }}
    </template>

    <template #cell:duration="{ row }">
      {{ formatDuration(row.durationMs) }}
    </template>

    <template #cell:link="{ row }">
      <a
        v-clean-tooltip="t('extensionsCenter.common.openInGitHub')"
        :href="row.htmlUrl"
        target="_blank"
        rel="noopener noreferrer"
      >
        <i class="icon icon-external-link" />
      </a>
    </template>
  </SortableTable>
</template>

<style lang="scss" scoped>
.run-number {
  font-size: 12px;
  margin-left: 6px;
}
</style>
