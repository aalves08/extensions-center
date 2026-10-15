<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useStore } from 'vuex';
import { Banner } from '@components/Banner';
import { Checkbox } from '@components/Form/Checkbox';
import LabeledSelect from '@shell/components/form/LabeledSelect.vue';
import SortableTable from '@shell/components/SortableTable/index.vue';
import Tabbed from '@shell/components/Tabbed/index.vue';
import Tab from '@shell/components/Tabbed/Tab.vue';

import AnalysisProgressBar from '../components/AnalysisProgressBar.vue';
import ApiSurfaceTable from '../components/ApiSurfaceTable.vue';
import ExtensionImportDetailView from '../components/ExtensionImportDetail.vue';
import ImportPathsTable from '../components/ImportPathsTable.vue';
import ImportTotalsTable from '../components/ImportTotalsTable.vue';
import SectionHeader from '../components/SectionHeader.vue';
import { useImportAnalysis } from '../composables/useImportAnalysis';
import { buildApiSurface } from '../utils/apiSurface';
import { useTranslation } from '../utils/i18n';

const t = useTranslation();

type Done = (ok: boolean) => void;

/** The one thing this page drives on shell's Tabbed: jumping to a named tab. */
interface TabbedApi {
  select: (name: string) => void;
}

const store = useStore();
const analysis = useImportAnalysis(store);

const tabbed = ref<TabbedApi | null>(null);

/** Extension shown in the per-extension tab. Defaults to the heaviest. */
const selected = ref<string | null>(null);

const doc = computed(() => analysis.doc.value);

const lastRefreshed = computed(() => (doc.value ? new Date(doc.value.fetchedAt) : null));

const refreshHint = computed(() => store.getters['i18n/t']('extensionsCenter.importAnalysis.refreshCost'));

const extensionNames = computed(() => (doc.value?.totals || []).map((t) => t.name));

const currentName = computed(() => selected.value || extensionNames.value[0] || null);

const currentDetail = computed(() => (currentName.value ? doc.value?.detail?.[currentName.value] : null));

/**
 * Shell paths nothing in rancher/dashboard resolves to.
 *
 * Derived rather than stored: it is exactly the resolved-size failures, and
 * keeping a second list in the document would be one more thing to keep in
 * step. These are the interesting ones — an extension importing a path the
 * shell no longer has is either broken or relying on something private.
 */
const unresolved = computed(() => (doc.value?.shellPaths || []).filter((p) => p.bytes === null));

/**
 * The same shell paths, regrouped by what they are and how safe they are.
 *
 * Derived, not stored: every input has been in the saved document since the
 * first version of this page, including the named specifiers. So this view
 * costs no extra fetch and needs no rebuild to appear.
 */
const surface = computed(() => buildApiSurface(doc.value));

/** Only the paths with something wrong with them; the default view of the tab. */
const riskyPaths = computed(() => surface.value.paths.filter((p) => p.risk !== 'ok'));

const showAllPaths = ref(false);

const surfaceRows = computed(() => (showAllPaths.value ? surface.value.paths : riskyPaths.value));

const riskHeaders = computed(() => [
  {
    name: 'risk', labelKey: 'extensionsCenter.importAnalysis.cols.risk', value: 'risk', sort: false
  },
  {
    name: 'paths', labelKey: 'extensionsCenter.importAnalysis.cols.paths', value: 'paths', align: 'right', sort: ['paths']
  },
  {
    name: 'imports', labelKey: 'extensionsCenter.importAnalysis.cols.totalImports', value: 'imports', align: 'right', sort: ['imports']
  },
  {
    name: 'exts', labelKey: 'extensionsCenter.importAnalysis.cols.usedBy', value: 'exts', align: 'right', sort: ['exts']
  },
  {
    name: 'meaning', labelKey: 'extensionsCenter.importAnalysis.cols.meaning', sort: false
  },
]);

const exposureHeaders = computed(() => [
  {
    name: 'name', labelKey: 'extensionsCenter.importAnalysis.cols.extension', value: 'name', sort: ['name']
  },
  {
    name: 'risky', labelKey: 'extensionsCenter.importAnalysis.cols.riskyPaths', value: 'risky', align: 'right', sort: ['risky']
  },
  {
    name: 'paths', labelKey: 'extensionsCenter.importAnalysis.cols.paths', value: 'paths', align: 'right', sort: ['paths']
  },
  {
    name: 'imports', labelKey: 'extensionsCenter.importAnalysis.cols.totalImports', value: 'imports', align: 'right', sort: ['imports']
  },
  {
    name: 'specifiers', labelKey: 'extensionsCenter.importAnalysis.cols.symbols', value: 'specifiers', align: 'right', sort: ['specifiers']
  },
]);

/** Totals across every extension, for the summary strip. */
const summary = computed(() => {
  const totals = doc.value?.totals || [];

  return {
    extensions: totals.length,
    files:      totals.reduce((sum, t) => sum + t.fileCount, 0),
    shell:      totals.reduce((sum, t) => sum + t.shell, 0),
    shellPaths: doc.value?.shellPaths?.length || 0,
    components: totals.reduce((sum, t) => sum + t.components, 0),
    external:   doc.value?.externalPkgs?.length || 0,
    symbols:    surface.value.totals.distinctSpecifiers,
    risky:      surface.value.totals.riskyPaths,
  };
});

/**
 * Follow an extension name from the totals table into its own breakdown.
 *
 * Setting the selection alone is invisible — the picker it feeds lives on a tab
 * the user is not looking at — so this switches tabs too. `Tabbed.select` also
 * updates the route hash, which makes the resulting view linkable.
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
  <div class="import-analysis">
    <SectionHeader
      :title="t('extensionsCenter.importAnalysis.title')"
      :description="t('extensionsCenter.importAnalysis.description')"
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
      :label="t('extensionsCenter.importAnalysis.notBuilt')"
    />

    <Banner
      v-else-if="analysis.stale.value"
      color="info"
      :label="t('extensionsCenter.analysis.stale')"
    />

    <template v-if="doc">
      <div class="summary">
        <div
          v-for="item in [
            { key: 'extensions', value: summary.extensions },
            { key: 'files', value: summary.files },
            { key: 'shellImports', value: summary.shell },
            { key: 'shellPaths', value: summary.shellPaths },
            { key: 'componentsImports', value: summary.components },
            { key: 'externalPkgs', value: summary.external },
            { key: 'symbols', value: summary.symbols },
            { key: 'riskyPaths', value: summary.risky, bad: summary.risky > 0 },
          ]"
          :key="item.key"
          class="stat"
          :class="{ bad: item.bad }"
        >
          <span class="value">{{ item.value }}</span>
          <span class="label text-muted">{{ t(`extensionsCenter.importAnalysis.summary.${ item.key }`) }}</span>
        </div>
      </div>

      <p class="text-muted source-note">
        {{ t('extensionsCenter.importAnalysis.sourceNote', { ref: doc.dashboardRef }) }}
      </p>

      <Tabbed
        ref="tabbed"
        :side-tabs="false"
      >
        <Tab
          name="totals"
          :label="t('extensionsCenter.importAnalysis.tabs.totals')"
          :weight="60"
        >
          <ImportTotalsTable
            :rows="doc.totals"
            @select="showDetail"
          />
        </Tab>

        <Tab
          name="surface"
          :label="t('extensionsCenter.importAnalysis.tabs.surface')"
          :weight="55"
        >
          <p class="text-muted hint">
            {{ t('extensionsCenter.importAnalysis.surfaceDescription') }}
          </p>

          <SortableTable
            :headers="riskHeaders"
            :rows="surface.byRisk"
            key-field="risk"
            :table-actions="false"
            :row-actions="false"
            :search="false"
            :paging="false"
            no-rows-key="extensionsCenter.importAnalysis.empty"
            class="risk-rollup"
          >
            <template #cell:risk="{ row }">
              <span
                class="risk"
                :class="`risk-${ row.risk }`"
              >{{ t(`extensionsCenter.importAnalysis.risk.${ row.risk }`) }}</span>
            </template>

            <template #cell:meaning="{ row }">
              <span class="text-muted meaning">
                {{ t(`extensionsCenter.importAnalysis.riskNote.${ row.risk }`) }}
              </span>
            </template>
          </SortableTable>

          <h4 class="rollup-title">
            {{ t('extensionsCenter.importAnalysis.exposureTitle') }}
          </h4>

          <SortableTable
            :headers="exposureHeaders"
            :rows="surface.byExtension"
            key-field="name"
            :table-actions="false"
            :row-actions="false"
            :search="false"
            :paging="false"
            no-rows-key="extensionsCenter.importAnalysis.empty"
            default-sort-by="risky"
            :descending="true"
            class="risk-rollup"
          >
            <template #cell:risky="{ row }">
              <span :class="{ 'risk-private': row.risky > 0 }">{{ row.risky }}</span>
            </template>
          </SortableTable>

          <Banner
            v-if="!riskyPaths.length"
            color="success"
            :label="t('extensionsCenter.importAnalysis.noRisky')"
          />

          <h4 class="rollup-title">
            {{ t('extensionsCenter.importAnalysis.pathsTitle') }}
          </h4>

          <div class="surface-toggle">
            <Checkbox
              v-model:value="showAllPaths"
              :label="t('extensionsCenter.importAnalysis.showAllPaths', { count: surface.totals.shellPaths })"
            />
          </div>

          <ApiSurfaceTable :rows="surfaceRows" />
        </Tab>

        <Tab
          name="shell"
          :label="t('extensionsCenter.importAnalysis.tabs.shell')"
          :weight="50"
        >
          <ImportPathsTable
            :rows="doc.shellPaths"
            :detail="doc.detail"
            path-label-key="extensionsCenter.importAnalysis.cols.shellPath"
            @select="showDetail"
          />
        </Tab>

        <Tab
          name="components"
          :label="t('extensionsCenter.importAnalysis.tabs.components')"
          :weight="40"
        >
          <ImportPathsTable
            :rows="doc.componentsPaths"
            :detail="doc.detail"
            path-label-key="extensionsCenter.importAnalysis.cols.componentsPath"
            @select="showDetail"
          />
        </Tab>

        <Tab
          name="external"
          :label="t('extensionsCenter.importAnalysis.tabs.external')"
          :weight="30"
        >
          <ImportPathsTable
            :rows="doc.externalPkgs"
            :detail="doc.detail"
            path-label-key="extensionsCenter.importAnalysis.cols.package"
            :show-bytes="false"
            @select="showDetail"
          />
        </Tab>

        <Tab
          name="unresolved"
          :label="t('extensionsCenter.importAnalysis.tabs.unresolved')"
          :weight="20"
        >
          <p class="text-muted hint">
            {{ t('extensionsCenter.importAnalysis.unresolvedDescription') }}
          </p>
          <ImportPathsTable
            :rows="unresolved"
            :detail="doc.detail"
            path-label-key="extensionsCenter.importAnalysis.cols.shellPath"
            :show-bytes="false"
            @select="showDetail"
          />
        </Tab>

        <Tab
          name="detail"
          :label="t('extensionsCenter.importAnalysis.tabs.perExtension')"
          :weight="10"
        >
          <LabeledSelect
            v-if="extensionNames.length"
            :value="currentName"
            :options="extensionNames"
            :label="t('extensionsCenter.importAnalysis.selectExtension')"
            class="picker"
            @update:value="selected = $event"
          />

          <ExtensionImportDetailView
            v-if="currentName && currentDetail"
            :ext-name="currentName"
            :detail="currentDetail"
          />
        </Tab>
      </Tabbed>
    </template>
  </div>
</template>

<style lang="scss" scoped>
@import '../styles/severity';

.import-analysis {
  padding-bottom: 40px;

  .summary {
    display: grid;
    gap: 12px;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
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

  // Same scale as ApiSurfaceTable — the rollup and the rows below it have to
  // read as one thing, so the two colour maps are deliberately identical.
  .risk {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
  }

  .risk-private {
    color: $critical-color;
  }

  .risk-internal {
    color: $high-color;
  }

  .risk-file-suffix {
    color: $medium-color;
  }

  .risk-ok {
    color: var(--muted);
    font-weight: normal;
  }

  .risk-rollup {
    margin-bottom: 24px;
  }

  .rollup-title {
    margin: 0 0 8px;
  }

  .meaning {
    font-size: 12px;
  }

  .surface-toggle {
    margin-bottom: 12px;
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
