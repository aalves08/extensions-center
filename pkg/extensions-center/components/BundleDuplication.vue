<script setup lang="ts">
import { computed, ref } from 'vue';
import { Banner } from '@components/Banner';
import LabeledSelect from '@shell/components/form/LabeledSelect.vue';
import SortableTable from '@shell/components/SortableTable/index.vue';

import { BundleAnalysisDoc } from '../types/analysis';
import { TableHeader } from '../types/table';
import { buildDuplicationReport } from '../utils/bundleDuplication';
import { prettyBytes } from '../utils/bytes';
import { useTranslation } from '../utils/i18n';

/**
 * The same package shipped by several extensions, and what that costs.
 *
 * The evidence behind "shell should externalize X". Every number on this
 * screen is an estimate built from source maps, so each one is shown with the
 * thing that limits it rather than alone: the saving column says which
 * arithmetic produced it, the version column says whether one shared copy is
 * even possible, and the unmeasured banner says how many extensions are
 * missing from the totals.
 *
 * The threshold is a control rather than a constant. Two carriers is already
 * a second copy and is the honest floor; a reader arguing for a change wants
 * to raise the bar themselves, not discover that someone else already did.
 */

const t = useTranslation();

const props = defineProps<{ doc: BundleAnalysisDoc | null }>();

const minCarriers = ref(2);

const thresholds = computed(() => [2, 3, 5, 8].map((value) => ({
  value,
  label: t('extensionsCenter.bundleAnalysis.duplication.threshold', { count: value }),
})));

const report = computed(() => buildDuplicationReport(props.doc, minCarriers.value));

const rows = computed(() => report.value.packages.map((pkg) => ({
  ...pkg,
  versionLabel: pkg.versions.join(', '),
  causeLabel:   pkg.causes.map((c) => t(`extensionsCenter.bundleAnalysis.cause.${ c }`)).join(', '),
})));

const headers = computed<TableHeader[]>(() => [
  {
    name: 'pkg', labelKey: 'extensionsCenter.bundleAnalysis.cols.package', value: 'pkg', sort: ['pkg']
  },
  {
    name: 'exts', labelKey: 'extensionsCenter.bundleAnalysis.duplication.cols.carriedBy', value: 'extCount', align: 'right', sort: ['extCount']
  },
  {
    name: 'versions', labelKey: 'extensionsCenter.bundleAnalysis.cols.resolved', value: 'versionLabel', sort: ['versionLabel']
  },
  {
    name: 'cause', labelKey: 'extensionsCenter.bundleAnalysis.cols.cause', value: 'causeLabel', sort: ['causeLabel']
  },
  {
    name: 'shipped', labelKey: 'extensionsCenter.bundleAnalysis.duplication.cols.allCopies', value: 'shippedBytes', align: 'right', sort: ['shippedBytes']
  },
  {
    name: 'saving', labelKey: 'extensionsCenter.bundleAnalysis.duplication.cols.saving', value: 'saving', align: 'right', sort: ['saving']
  },
]);
</script>

<template>
  <div class="bundle-duplication">
    <p class="text-muted hint">
      {{ t('extensionsCenter.bundleAnalysis.duplication.description') }}
    </p>

    <!--
      Said before any total is read, not after. Every figure below is summed
      over the extensions whose source maps were readable, so the count of the
      ones that were not is part of the number rather than a footnote to it.
    -->
    <Banner
      v-if="report.unmeasured.length"
      color="warning"
      :label="t('extensionsCenter.bundleAnalysis.duplication.unmeasured', {
        count: report.unmeasured.length,
        measured: report.measured,
        extensions: report.unmeasured.join(', '),
      })"
    />

    <Banner
      v-if="report.unscaled.length"
      color="warning"
      :label="t('extensionsCenter.bundleAnalysis.duplication.unscaled', { extensions: report.unscaled.join(', ') })"
    />

    <div class="summary">
      <div class="stat">
        <span class="value">{{ report.totals.packages }}</span>
        <span class="label text-muted">{{ t('extensionsCenter.bundleAnalysis.duplication.summary.packages') }}</span>
      </div>
      <div class="stat">
        <span class="value">{{ prettyBytes(report.totals.shippedBytes) }}</span>
        <span class="label text-muted">{{ t('extensionsCenter.bundleAnalysis.duplication.summary.shipped') }}</span>
      </div>
      <div
        class="stat"
        :class="{ bad: report.totals.saving > 0 }"
      >
        <span class="value">{{ prettyBytes(report.totals.saving) }}</span>
        <span class="label text-muted">{{ t('extensionsCenter.bundleAnalysis.duplication.summary.saving') }}</span>
      </div>
      <div class="stat">
        <span class="value">{{ prettyBytes(report.totals.shellCausedSaving) }}</span>
        <span class="label text-muted">{{ t('extensionsCenter.bundleAnalysis.duplication.summary.shellCaused') }}</span>
      </div>
      <div class="stat">
        <span class="value">{{ report.totals.versionSplits }}</span>
        <span class="label text-muted">{{ t('extensionsCenter.bundleAnalysis.duplication.summary.versionSplits') }}</span>
      </div>
    </div>

    <LabeledSelect
      :value="minCarriers"
      :options="thresholds"
      :label="t('extensionsCenter.bundleAnalysis.duplication.thresholdLabel')"
      class="threshold"
      @update:value="minCarriers = $event"
    />

    <SortableTable
      :headers="headers"
      :rows="rows"
      key-field="pkg"
      :table-actions="false"
      :row-actions="false"
      :search="false"
      :paging="true"
      :rows-per-page="20"
      :sub-rows="true"
      :sub-expandable="true"
      :sub-expand-column="true"
      :sub-rows-description="false"
      no-rows-key="extensionsCenter.bundleAnalysis.duplication.none"
      default-sort-by="saving"
      :descending="true"
    >
      <template #cell:pkg="{ row }">
        <code>{{ row.pkg }}</code>
        <span
          v-if="row.hostProvided"
          v-clean-tooltip="t('extensionsCenter.bundleAnalysis.duplication.hostProvidedHint')"
          class="tag"
        >{{ t('extensionsCenter.bundleAnalysis.duplication.hostProvided') }}</span>
      </template>

      <!--
        Three states, not two. No version is not the same as one version: the
        lockfile may simply have been unreadable, and reporting that as
        agreement would turn a gap in the evidence into a green light.
      -->
      <template #cell:versions="{ row }">
        <code v-if="row.versions.length === 1">{{ row.versionLabel }}</code>
        <span
          v-else-if="row.versionSplit"
          v-clean-tooltip="t('extensionsCenter.bundleAnalysis.duplication.splitHint')"
          class="split"
        >{{ row.versionLabel }}</span>
        <span
          v-else
          v-clean-tooltip="t('extensionsCenter.bundleAnalysis.duplication.noVersionHint')"
          class="text-muted"
        >{{ t('extensionsCenter.common.na') }}</span>
      </template>

      <template #cell:cause="{ row }">
        <span :class="{ 'shell-caused': row.shellCaused }">{{ row.causeLabel }}</span>
      </template>

      <template #cell:shipped="{ row }">
        {{ prettyBytes(row.shippedBytes) }}
      </template>

      <!--
        The arithmetic is on the number rather than in a legend, because the
        two kinds of saving differ by the largest copy and a reader comparing
        two rows has no way to tell which they are looking at otherwise.
      -->
      <template #cell:saving="{ row }">
        <span v-clean-tooltip="t(`extensionsCenter.bundleAnalysis.duplication.savingKind.${ row.savingKind }`)">
          {{ prettyBytes(row.saving) }}
        </span>
      </template>

      <template #sub-row="{ row, fullColspan }">
        <tr class="sub-row">
          <td :colspan="fullColspan">
            <div class="detail">
              <p class="text-muted">
                {{ t(`extensionsCenter.bundleAnalysis.duplication.savingKind.${ row.savingKind }`) }}
              </p>

              <table class="carriers">
                <thead>
                  <tr>
                    <th>{{ t('extensionsCenter.bundleAnalysis.cols.extension') }}</th>
                    <th class="num">
                      {{ t('extensionsCenter.bundleAnalysis.cols.shippedSize') }}
                    </th>
                    <th class="num">
                      {{ t('extensionsCenter.bundleAnalysis.cols.files') }}
                    </th>
                    <th>{{ t('extensionsCenter.bundleAnalysis.cols.resolved') }}</th>
                    <th>{{ t('extensionsCenter.bundleAnalysis.cols.cause') }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="carrier in row.carriers"
                    :key="carrier.ext"
                  >
                    <td>{{ carrier.ext }}</td>
                    <td class="num">
                      {{ prettyBytes(carrier.shippedBytes) }}
                    </td>
                    <td class="num">
                      {{ carrier.files }}
                    </td>
                    <td>
                      <code v-if="carrier.versions.length">{{ carrier.versions.join(', ') }}</code>
                      <span
                        v-else
                        class="text-muted"
                      >{{ t('extensionsCenter.common.na') }}</span>
                    </td>
                    <td class="text-muted">
                      {{ t(`extensionsCenter.bundleAnalysis.cause.${ carrier.cause }`) }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </td>
        </tr>
      </template>
    </SortableTable>

    <p class="text-muted method">
      {{ t('extensionsCenter.bundleAnalysis.duplication.method') }}
    </p>
  </div>
</template>

<style lang="scss" scoped>
@import '../styles/severity';

code {
  font-size: 12px;
}

.hint,
.method {
  font-size: 12px;
}

.hint {
  margin: 0 0 12px;
}

.method {
  margin: 16px 0 0;
}

.summary {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  margin-bottom: 16px;
}

.stat {
  background: var(--box-bg);
  border: 1px solid var(--border);
  border-radius: var(--border-radius);
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 12px 16px;

  &.bad .value {
    color: var(--error);
  }

  .value {
    font-size: 22px;
    font-weight: 600;
  }

  .label {
    font-size: 12px;
  }
}

.threshold {
  margin-bottom: 16px;
  max-width: 320px;
}

.tag {
  background: var(--box-bg);
  border: 1px solid var(--border);
  border-radius: var(--border-radius);
  font-size: 11px;
  margin-left: 6px;
  padding: 0 6px;
  white-space: nowrap;
}

// Weight, not colour — the same rule the cause table follows, so the two read
// as one convention rather than two scales.
.shell-caused {
  font-weight: 600;
}

.split {
  color: $medium-color;
  font-size: 12px;
}

.detail {
  padding: 8px 0 8px 32px;

  p {
    font-size: 12px;
    margin: 0 0 8px;
  }
}

.carriers {
  font-size: 12px;

  th,
  td {
    padding: 2px 16px 2px 0;
    text-align: left;
  }

  th {
    color: var(--muted);
    font-weight: normal;
  }

  .num {
    text-align: right;
  }
}
</style>
