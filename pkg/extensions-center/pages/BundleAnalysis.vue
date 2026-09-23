<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useStore } from 'vuex';
import { Banner } from '@components/Banner';
import LabeledSelect from '@shell/components/form/LabeledSelect.vue';
import Tabbed from '@shell/components/Tabbed/index.vue';
import Tab from '@shell/components/Tabbed/Tab.vue';

import AnalysisProgressBar from '../components/AnalysisProgressBar.vue';
import BundleExtensionDetail from '../components/BundleExtensionDetail.vue';
import BundleOverviewTable from '../components/BundleOverviewTable.vue';
import SectionHeader from '../components/SectionHeader.vue';
import { useBundleAnalysis } from '../composables/useBundleAnalysis';
import { prettyBytes } from '../utils/bytes';

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

  return {
    extensions: extensions.length,
    published:  published.length,
    totalBytes: published.reduce((sum, e) => sum + e.totalBundleBytes, 0),
    largest:    published.reduce((max, e) => Math.max(max, e.totalBundleBytes), 0),
    leaking:    leaking.value.length,
  };
});

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
