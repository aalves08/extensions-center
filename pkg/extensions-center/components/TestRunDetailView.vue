<script setup lang="ts">
import { computed, onMounted, toRef } from 'vue';
import { useRoute } from 'vue-router';
import { useStore } from 'vuex';
import { Banner } from '@components/Banner';
import Loading from '@shell/components/Loading.vue';
import SortableTable from '@shell/components/SortableTable/index.vue';
import Tabbed from '@shell/components/Tabbed/index.vue';
import Tab from '@shell/components/Tabbed/Tab.vue';

import RunStatusBadge from './RunStatusBadge.vue';
import SectionHeader from './SectionHeader.vue';
import { BLANK_CLUSTER } from '../config/constants';
import { useTestRunDetail } from '../composables/useTestRuns';
import { formatDuration } from '../utils/runs';

/**
 * Detail view for a single run of either suite.
 *
 * Everything here comes from two GitHub calls made on mount; there is no stored
 * copy of a run, so the page is always showing what GitHub reports right now.
 */
const props = defineProps<{
  repo: string;
  titleKey: string;
  listRouteName: string;
}>();

type Done = (ok: boolean) => void;

const store = useStore();
const route = useRoute();

const runId = toRef(() => route.params.runId as string);
const detail = useTestRunDetail(store, props.repo, runId);

const listRoute = { name: props.listRouteName, params: { cluster: BLANK_CLUSTER } };

const title = computed(() => {
  const runNumber = detail.data.value?.runNumber ?? runId.value;

  return store.getters['i18n/t'](props.titleKey, { runNumber });
});

/** Overview rows, rendered as a plain label/value grid. */
const overview = computed(() => {
  const run = detail.data.value;

  if (!run) {
    return [];
  }

  const t = (key: string) => store.getters['i18n/t'](key);
  const na = t('extensionsCenter.common.na');

  return [
    { label: t('extensionsCenter.runs.detail.workflow'), value: run.workflowName || na },
    { label: t('extensionsCenter.runs.cols.runId'), value: String(run.id) },
    { label: t('extensionsCenter.runs.detail.attempt'), value: String(run.runAttempt) },
    { label: t('extensionsCenter.runs.cols.branch'), value: run.headBranch || na },
    { label: t('extensionsCenter.runs.cols.event'), value: run.event || na },
    { label: t('extensionsCenter.runs.cols.actor'), value: run.actor || na },
    { label: t('extensionsCenter.runs.detail.triggeringActor'), value: run.triggeringActor || na },
    { label: t('extensionsCenter.runs.cols.started'), value: new Date(run.createdAt).toLocaleString() },
    { label: t('extensionsCenter.runs.cols.duration'), value: formatDuration(run.durationMs) },
    { label: t('extensionsCenter.runs.cols.total'), value: String(run.counts.total) },
    { label: t('extensionsCenter.runs.cols.passed'), value: String(run.counts.passed) },
    { label: t('extensionsCenter.runs.cols.skipped'), value: String(run.counts.skipped) },
    { label: t('extensionsCenter.runs.cols.failed'), value: String(run.counts.failed) },
  ];
});

const jobHeaders = [
  {
    name: 'name', labelKey: 'extensionsCenter.runs.detail.jobName', value: 'name', sort: ['name']
  },
  {
    name: 'status', labelKey: 'extensionsCenter.runs.detail.jobStatus', value: 'status', sort: ['status']
  },
  {
    name: 'steps', labelKey: 'extensionsCenter.runs.detail.steps', value: 'steps.length', align: 'right', sort: false
  },
  {
    name: 'duration', labelKey: 'extensionsCenter.runs.detail.jobDuration', value: 'durationMs', align: 'right', sort: ['durationMs']
  },
  {
    name: 'link', labelKey: 'extensionsCenter.runs.cols.link', value: 'htmlUrl', align: 'center', sort: false
  },
];

async function refresh(done?: Done) {
  await detail.refresh();
  done?.(!detail.error.value);
}

onMounted(() => refresh());
</script>

<template>
  <div class="run-detail">
    <router-link
      :to="listRoute"
      class="back"
    >
      <i class="icon icon-chevron-left" />
      {{ t('extensionsCenter.common.viewAll') }}
    </router-link>

    <SectionHeader
      :title="title"
      :last-refreshed="detail.lastRefreshed.value"
      :loading="detail.loading.value"
      @refresh="refresh"
    />

    <Banner
      v-if="detail.error.value"
      color="error"
      :label="detail.error.value"
    />

    <Loading
      v-if="detail.loading.value && !detail.data.value"
      mode="relative"
    />

    <template v-else-if="detail.data.value">
      <div class="summary">
        <RunStatusBadge :status="detail.data.value.status" />
        <a
          :href="detail.data.value.htmlUrl"
          target="_blank"
          rel="noopener noreferrer"
        >
          {{ t('extensionsCenter.common.openInGitHub') }}
          <i class="icon icon-external-link" />
        </a>
      </div>

      <Tabbed :side-tabs="false">
        <Tab
          name="overview"
          :label="t('extensionsCenter.runs.detail.overview')"
          :weight="10"
        >
          <dl class="overview">
            <template
              v-for="item in overview"
              :key="item.label"
            >
              <dt>{{ item.label }}</dt>
              <dd>{{ item.value }}</dd>
            </template>
          </dl>

          <div
            v-if="detail.data.value.headCommitMessage"
            class="commit"
          >
            <h4>{{ t('extensionsCenter.runs.detail.commit') }}</h4>
            <p>{{ detail.data.value.headCommitMessage }}</p>
            <a
              :href="detail.data.value.headCommitUrl"
              target="_blank"
              rel="noopener noreferrer"
            >
              {{ detail.data.value.headSha.slice(0, 12) }}
              <i class="icon icon-external-link" />
            </a>
          </div>
        </Tab>

        <Tab
          name="jobs"
          :label="t('extensionsCenter.runs.detail.jobs')"
          :weight="9"
        >
          <SortableTable
            :headers="jobHeaders"
            :rows="detail.data.value.jobs"
            key-field="id"
            :table-actions="false"
            :row-actions="false"
            :search="false"
            :paging="false"
            sub-expandable
            sub-expand-column
            :sub-rows="true"
            no-rows-key="extensionsCenter.runs.detail.noJobs"
            default-sort-by="name"
          >
            <template #cell:status="{ row }">
              <RunStatusBadge :status="row.status" />
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

            <template #sub-row="{ row, fullColspan, onRowMouseEnter, onRowMouseLeave }">
              <tr
                class="sub-row"
                @mouseenter="onRowMouseEnter"
                @mouseleave="onRowMouseLeave"
              >
                <!-- Empty cell under the expand arrow, so the steps line up
                     with the job name rather than the chevron. -->
                <td>&nbsp;</td>
                <td :colspan="fullColspan - 1">
                  <ul class="steps">
                    <li
                      v-for="step in row.steps"
                      :key="step.number"
                    >
                      <RunStatusBadge
                        compact
                        :status="step.status"
                      />
                      <span class="step-name">{{ step.name }}</span>
                      <span class="text-muted">{{ formatDuration(step.durationMs) }}</span>
                    </li>
                  </ul>
                  <span
                    v-if="!row.steps.length"
                    class="text-muted"
                  >{{ t('extensionsCenter.runs.detail.noSteps') }}</span>
                </td>
              </tr>
            </template>
          </SortableTable>
        </Tab>
      </Tabbed>
    </template>
  </div>
</template>

<style lang="scss" scoped>
.run-detail {
  padding-bottom: 40px;

  .back {
    display: inline-block;
    font-size: 13px;
    margin-bottom: 8px;
  }

  .summary {
    align-items: center;
    display: flex;
    gap: 16px;
    margin-bottom: 16px;
  }

  .overview {
    display: grid;
    gap: 8px 24px;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    margin: 0;

    dt {
      color: var(--input-label);
      font-size: 12px;
      margin: 0;
    }

    dd {
      margin: 0 0 8px;
    }
  }

  .commit {
    border-top: 1px solid var(--border);
    margin-top: 16px;
    padding-top: 16px;

    h4 {
      margin: 0 0 4px;
    }

    p {
      margin: 0 0 4px;
    }
  }

  .steps {
    list-style: none;
    margin: 0;
    padding: 8px 0;

    li {
      align-items: center;
      display: grid;
      gap: 12px;
      grid-template-columns: 16px 1fr auto;
      padding: 2px 0;
    }

    .step-name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }
}
</style>
