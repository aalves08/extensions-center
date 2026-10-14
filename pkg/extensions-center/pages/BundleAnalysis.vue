<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useStore } from 'vuex';
import { Banner } from '@components/Banner';
import LabeledSelect from '@shell/components/form/LabeledSelect.vue';
import SortableTable from '@shell/components/SortableTable/index.vue';
import Tabbed from '@shell/components/Tabbed/index.vue';
import Tab from '@shell/components/Tabbed/Tab.vue';

import AnalysisProgressBar from '../components/AnalysisProgressBar.vue';
import BundleExtensionDetail from '../components/BundleExtensionDetail.vue';
import BundleOverviewTable from '../components/BundleOverviewTable.vue';
import SectionHeader from '../components/SectionHeader.vue';
import { useBundleAnalysis } from '../composables/useBundleAnalysis';
import { BundleCause, SHELL_CAUSED } from '../utils/bundleCause';
import { prettyBytes } from '../utils/bytes';
import { useTranslation } from '../utils/i18n';

const t = useTranslation();

type Done = (ok: boolean) => void;

/** The one thing this page drives on shell's Tabbed: jumping to a named tab. */
interface TabbedApi {
  select: (name: string) => void;
}

const store = useStore();
const analysis = useBundleAnalysis(store);

const tabbed = ref<TabbedApi | null>(null);

/** Extension shown in the per-extension tab. Defaults to the largest bundle. */
const selected = ref<string | null>(null);

const doc = computed(() => analysis.doc.value);

const lastRefreshed = computed(() => (doc.value ? new Date(doc.value.fetchedAt) : null));

const refreshHint = computed(() => store.getters['i18n/t']('extensionsCenter.bundleAnalysis.refreshCost'));

const extensionNames = computed(() => (doc.value?.extensions || []).map((e) => e.name));

const currentName = computed(() => selected.value || extensionNames.value[0] || null);

const currentBundle = computed(() => (doc.value?.extensions || []).find((e) => e.name === currentName.value) || null);

/**
 * Extensions shipping code the host already provides.
 *
 * This is the headline finding of the whole page: `@rancher/shell` and
 * `@rancher/components` are supposed to be externalized, so any bytes of them
 * inside a bundle are a second copy loaded for nothing.
 */
const leaking = computed(() => (doc.value?.extensions || []).filter((e) => e.leaks && (e.leaks.shellFiles || e.leaks.componentsFiles || e.leaks.hostPkgs.length)));

const summary = computed(() => {
  const extensions = doc.value?.extensions || [];
  const published = extensions.filter((e) => e.pluginDir);
  const totalBytes = published.reduce((sum, e) => sum + e.totalBundleBytes, 0);

  // Disk-scaled before summing. Adding raw source bytes across bundles with
  // ratios from 0.30 to 0.66 produces a number that is not a size of anything.
  const shellCaused = published
    .filter((e) => e.ratio !== null)
    .reduce((sum, e) => sum + e.shellCausedBytes * (e.ratio || 0), 0);

  return {
    extensions:     extensions.length,
    published:      published.length,
    totalBytes,
    largest:        published.reduce((max, e) => Math.max(max, e.totalBundleBytes), 0),
    leaking:        leaking.value.length,
    shellCaused:    Math.round(shellCaused),
    shellCausedPct: totalBytes ? Math.round((shellCaused / totalBytes) * 100) : 0,
  };
});

/**
 * Cause totals across every analysed bundle.
 *
 * The estate answer to "what would fixing shell actually save". Per-extension
 * numbers are each too small to argue with; the sum is not.
 */
const causeRollup = computed(() => {
  const totals = new Map<BundleCause, { cause: BundleCause; bytes: number; packages: number; exts: number }>();

  for (const ext of doc.value?.extensions || []) {
    if (!ext.byCause || ext.ratio === null) {
      continue;
    }

    for (const row of ext.byCause) {
      const total = totals.get(row.cause) || {
        cause: row.cause, bytes: 0, packages: 0, exts: 0
      };

      total.bytes += row.bytes * ext.ratio;
      // Packages are summed across extensions rather than deduplicated: the
      // question this table answers is how much work there is in total, and
      // the same polyfill in ten bundles is ten copies being downloaded.
      total.packages += row.packages;
      total.exts++;
      totals.set(row.cause, total);
    }
  }

  return [...totals.values()]
    .map((t) => ({
      ...t, bytes: Math.round(t.bytes), shellCaused: SHELL_CAUSED.has(t.cause)
    }))
    .sort((a, b) => b.bytes - a.bytes);
});

const causeHeaders = computed(() => [
  {
    name: 'cause', labelKey: 'extensionsCenter.bundleAnalysis.cols.cause', value: 'cause', sort: ['cause']
  },
  {
    name: 'bytes', labelKey: 'extensionsCenter.bundleAnalysis.cols.shippedSize', value: 'bytes', align: 'right', sort: ['bytes']
  },
  {
    name: 'exts', labelKey: 'extensionsCenter.bundleAnalysis.cols.extension', value: 'exts', align: 'right', sort: ['exts']
  },
  {
    name: 'packages', labelKey: 'extensionsCenter.bundleAnalysis.cols.packages', value: 'packages', align: 'right', sort: ['packages']
  },
  {
    name: 'fix', labelKey: 'extensionsCenter.bundleAnalysis.cols.fix', sort: false
  },
]);

/**
 * Follow an extension name from the overview or leaks table into its breakdown.
 *
 * Setting the selection alone is invisible — the picker it feeds lives on a tab
 * the user is not looking at — so this switches tabs too. `Tabbed.select` also
 * updates the route hash, which makes the resulting view linkable.
 *
 * It matters most from the leaks tab: that table says an extension is shipping
 * a second copy of the shell, and the obvious next question is which packages,
 * which is exactly what the detail tab answers.
 */
function showDetail(name: string) {
  selected.value = name;
  tabbed.value?.select('detail');
}

async function rebuild(done?: Done) {
  await analysis.rebuild();
  done?.(!analysis.error.value);
}

// Reads the saved analysis. Opening this page costs one Kubernetes call.
onMounted(() => analysis.load());
</script>

<template>
  <div class="bundle-analysis">
    <SectionHeader
      :title="t('extensionsCenter.bundleAnalysis.title')"
      :description="t('extensionsCenter.bundleAnalysis.description')"
      :last-refreshed="lastRefreshed"
      :loading="analysis.loading.value || analysis.rebuilding.value"
      :refresh-hint="refreshHint"
      @refresh="rebuild"
    />

    <AnalysisProgressBar :progress="analysis.progress.value" />

    <Banner
      v-if="analysis.error.value"
      color="error"
      :label="analysis.error.value"
    />

    <Banner
      v-if="analysis.needsBuild.value"
      color="info"
      :label="t('extensionsCenter.bundleAnalysis.notBuilt')"
    />

    <Banner
      v-else-if="analysis.stale.value"
      color="info"
      :label="t('extensionsCenter.analysis.stale')"
    />

    <template v-if="doc">
      <div class="summary">
        <div class="stat">
          <span class="value">{{ summary.published }} / {{ summary.extensions }}</span>
          <span class="label text-muted">{{ t('extensionsCenter.bundleAnalysis.summary.published') }}</span>
        </div>
        <div class="stat">
          <span class="value">{{ prettyBytes(summary.totalBytes) }}</span>
          <span class="label text-muted">{{ t('extensionsCenter.bundleAnalysis.summary.totalBytes') }}</span>
        </div>
        <div class="stat">
          <span class="value">{{ prettyBytes(summary.largest) }}</span>
          <span class="label text-muted">{{ t('extensionsCenter.bundleAnalysis.summary.largest') }}</span>
        </div>
        <div
          class="stat"
          :class="{ bad: summary.leaking > 0 }"
        >
          <span class="value">{{ summary.leaking }}</span>
          <span class="label text-muted">{{ t('extensionsCenter.bundleAnalysis.summary.leaking') }}</span>
        </div>
        <div class="stat">
          <span class="value">
            {{ prettyBytes(summary.shellCaused) }}
            <span class="pct text-muted">{{ summary.shellCausedPct }}%</span>
          </span>
          <span class="label text-muted">{{ t('extensionsCenter.bundleAnalysis.summary.shellCaused') }}</span>
        </div>
      </div>

      <p class="text-muted source-note">
        {{ t('extensionsCenter.bundleAnalysis.sourceNote') }}
      </p>

      <Tabbed
        ref="tabbed"
        :side-tabs="false"
      >
        <Tab
          name="overview"
          :label="t('extensionsCenter.bundleAnalysis.tabs.overview')"
          :weight="30"
        >
          <BundleOverviewTable
            :rows="doc.extensions"
            @select="showDetail"
          />
        </Tab>

        <Tab
          name="cause"
          :label="t('extensionsCenter.bundleAnalysis.tabs.cause')"
          :weight="25"
        >
          <p class="text-muted hint">
            {{ t('extensionsCenter.bundleAnalysis.causeDescription') }}
          </p>

          <SortableTable
            :headers="causeHeaders"
            :rows="causeRollup"
            key-field="cause"
            :table-actions="false"
            :row-actions="false"
            :search="false"
            :paging="false"
            no-rows-key="extensionsCenter.bundleAnalysis.empty"
            default-sort-by="bytes"
            :descending="true"
          >
            <template #cell:cause="{ row }">
              <span :class="{ 'shell-caused': row.shellCaused }">
                {{ t(`extensionsCenter.bundleAnalysis.cause.${ row.cause }`) }}
              </span>
            </template>

            <template #cell:bytes="{ row }">
              {{ prettyBytes(row.bytes) }}
            </template>

            <template #cell:fix="{ row }">
              <span class="text-muted fix">
                {{ t(`extensionsCenter.bundleAnalysis.causeFix.${ row.cause }`) }}
              </span>
            </template>
          </SortableTable>
        </Tab>

        <Tab
          name="leaks"
          :label="t('extensionsCenter.bundleAnalysis.tabs.leaks')"
          :weight="20"
        >
          <p class="text-muted hint">
            {{ t('extensionsCenter.bundleAnalysis.leaksDescription') }}
          </p>

          <Banner
            v-if="!leaking.length"
            color="success"
            :label="t('extensionsCenter.bundleAnalysis.noLeaks')"
          />

          <BundleOverviewTable
            v-else
            :rows="leaking"
            @select="showDetail"
          />
        </Tab>

        <Tab
          name="detail"
          :label="t('extensionsCenter.bundleAnalysis.tabs.perExtension')"
          :weight="10"
        >
          <LabeledSelect
            v-if="extensionNames.length"
            :value="currentName"
            :options="extensionNames"
            :label="t('extensionsCenter.bundleAnalysis.selectExtension')"
            class="picker"
            @update:value="selected = $event"
          />

          <BundleExtensionDetail
            v-if="currentBundle"
            :bundle="currentBundle"
          />
        </Tab>
      </Tabbed>
    </template>
  </div>
</template>

<style lang="scss" scoped>
.bundle-analysis {
  padding-bottom: 40px;

  .summary {
    display: grid;
    gap: 12px;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    margin-bottom: 12px;
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

    .pct {
      font-size: 13px;
      font-weight: normal;
    }
  }

  // Weight, not colour — see the same rule in BundleExtensionDetail.
  .shell-caused {
    font-weight: 600;
  }

  .fix {
    font-size: 12px;
  }

  .source-note,
  .hint {
    font-size: 12px;
  }

  .source-note {
    margin: 0 0 16px;
  }

  .hint {
    margin: 0 0 12px;
  }

  .picker {
    margin-bottom: 24px;
    max-width: 320px;
  }
}
</style>
