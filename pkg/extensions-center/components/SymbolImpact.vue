<script setup lang="ts">
import { computed, ref } from 'vue';
import { Banner } from '@components/Banner';
import { LabeledInput } from '@components/Form/LabeledInput';
import SortableTable from '@shell/components/SortableTable/index.vue';

import { TableHeader } from '../types/table';
import { filterSymbols, riskRank, SymbolIndex } from '../utils/symbolIndex';
import { useTranslation } from '../utils/i18n';

/**
 * "What breaks if we change this" — a shell symbol, and who imports it.
 *
 * The filter narrows a table that is always fully populated, rather than
 * gating results behind a submit. That is safe here in a way it is not in the
 * package search: an empty result means no symbol matched the text typed,
 * which is recoverable and obvious, and the count line above the table says
 * how much of the index is being hidden either way.
 *
 * Three forms of import name nothing: a whole-module import, a dynamic
 * `import()` and a re-export. An extension using one of them could be
 * touching any export in the module, and an empty search result is the single
 * most dangerous output this view can produce — so they are handled twice
 * over. Where a path has rows, the blind extensions ride along on every one
 * of them in the "cannot rule out" column; where a path has no rows at all,
 * it is listed in full in one of the two tables underneath, unfiltered.
 */

const t = useTranslation();

const props = defineProps<{ index: SymbolIndex }>();

const query = ref('');

const rows = computed(() => filterSymbols(props.index.rows, query.value).map((row) => ({
  ...row,
  riskOrder:    riskRank(row.risk),
  extCount:     row.exts.length,
  unclearCount: row.unclearExts.length,
})));

const blindRows = (list: SymbolIndex['namespaceOnly']) => list.map((p) => ({
  ...p,
  riskOrder: riskRank(p.risk),
  extCount:  p.exts.length,
}));

const headers = computed<TableHeader[]>(() => [
  {
    name: 'symbol', labelKey: 'extensionsCenter.importAnalysis.cols.symbol', value: 'symbol', sort: ['symbol']
  },
  {
    name: 'path', labelKey: 'extensionsCenter.importAnalysis.cols.path', value: 'rel', sort: ['rel']
  },
  {
    name: 'scope', labelKey: 'extensionsCenter.importAnalysis.cols.package', value: 'scope', sort: ['scope', 'rel']
  },
  {
    name: 'risk', labelKey: 'extensionsCenter.importAnalysis.cols.risk', value: 'riskOrder', sort: ['riskOrder', 'rel']
  },
  {
    name: 'usedBy', labelKey: 'extensionsCenter.importAnalysis.cols.usedBy', value: 'extCount', align: 'right', sort: ['extCount']
  },
  {
    name: 'maybe', labelKey: 'extensionsCenter.importAnalysis.cols.cantTell', value: 'unclearCount', align: 'right', sort: ['unclearCount']
  },
  {
    name: 'imports', labelKey: 'extensionsCenter.importAnalysis.cols.pathImports', value: 'imports', align: 'right', sort: ['imports']
  },
]);

const blindHeaders = computed<TableHeader[]>(() => [
  {
    name: 'path', labelKey: 'extensionsCenter.importAnalysis.cols.path', value: 'rel', sort: ['rel']
  },
  {
    name: 'scope', labelKey: 'extensionsCenter.importAnalysis.cols.package', value: 'scope', sort: ['scope', 'rel']
  },
  {
    name: 'risk', labelKey: 'extensionsCenter.importAnalysis.cols.risk', value: 'riskOrder', sort: ['riskOrder', 'rel']
  },
  {
    name: 'exts', labelKey: 'extensionsCenter.importAnalysis.cols.usedBy', value: 'extCount', align: 'right', sort: ['extCount']
  },
  {
    name: 'imports', labelKey: 'extensionsCenter.importAnalysis.cols.pathImports', value: 'imports', align: 'right', sort: ['imports']
  },
]);

/** The caveats panel. Enumerated so adding one cannot miss the template. */
const CAVEATS = ['notUsage', 'pathCounts', 'namespace', 'unrecorded', 'stale'];
</script>

<template>
  <div class="symbol-impact">
    <p class="text-muted hint">
      {{ t('extensionsCenter.importAnalysis.symbols.description') }}
    </p>

    <LabeledInput
      v-model:value="query"
      class="filter"
      :label="t('extensionsCenter.importAnalysis.symbols.filterLabel')"
      :placeholder="t('extensionsCenter.importAnalysis.symbols.filterPlaceholder')"
    />

    <p class="text-muted count">
      {{ t('extensionsCenter.importAnalysis.symbols.showing', {
        shown: rows.length,
        total: index.totals.rows,
        symbols: index.totals.symbols,
        extensions: index.totals.extensions,
      }) }}
    </p>

    <SortableTable
      :headers="headers"
      :rows="rows"
      key-field="key"
      :table-actions="false"
      :row-actions="false"
      :search="false"
      :paging="true"
      :rows-per-page="20"
      :sub-rows="true"
      :sub-expandable="true"
      :sub-expand-column="true"
      :sub-rows-description="false"
      no-rows-key="extensionsCenter.importAnalysis.symbols.noMatch"
      default-sort-by="usedBy"
      :descending="true"
    >
      <template #cell:symbol="{ row }">
        <code
          v-if="row.kind === 'named'"
          class="symbol"
        >{{ row.symbol }}</code>
        <span
          v-else
          v-clean-tooltip="t('extensionsCenter.importAnalysis.symbols.defaultHint')"
          class="text-muted"
        >{{ t('extensionsCenter.importAnalysis.symbols.defaultExport') }}</span>
      </template>

      <template #cell:path="{ row }">
        <code>{{ row.rel }}</code>
      </template>

      <template #cell:scope="{ row }">
        <span class="text-muted">{{ t(`extensionsCenter.importAnalysis.scope.${ row.scope }`) }}</span>
      </template>

      <!--
        Components paths get no risk verdict rather than a reassuring one. The
        risk rules are written about shell's own tree and say nothing true
        about a published package with its own release process.
      -->
      <template #cell:risk="{ row }">
        <span
          v-if="row.risk"
          class="risk"
          :class="`risk-${ row.risk }`"
        >{{ t(`extensionsCenter.importAnalysis.risk.${ row.risk }`) }}</span>
        <span
          v-else
          v-clean-tooltip="t('extensionsCenter.importAnalysis.symbols.noRiskHint')"
          class="text-muted"
        >{{ t('extensionsCenter.common.na') }}</span>
      </template>

      <template #cell:usedBy="{ row }">
        <span v-clean-tooltip="row.exts.join(', ')">{{ row.extCount }}</span>
      </template>

      <!--
        The column that stops the one beside it being read as a complete list.
        An extension that reached this path without naming anything might use
        this symbol and might not, and nothing stored can tell them apart — so
        it is counted separately and never folded into the used-by count.
      -->
      <template #cell:maybe="{ row }">
        <span
          v-if="row.unclearCount"
          v-clean-tooltip="t('extensionsCenter.importAnalysis.symbols.cantTellHint', { extensions: row.unclearExts.join(', ') })"
          class="maybe"
        >{{ row.unclearCount }}</span>
        <span
          v-else
          class="text-muted"
        >0</span>
      </template>

      <template #sub-row="{ row, fullColspan }">
        <tr class="sub-row">
          <td :colspan="fullColspan">
            <div class="detail">
              <div class="field">
                <span class="field-label text-muted">{{ t('extensionsCenter.importAnalysis.detail.usedBy') }}</span>
                <span>{{ row.exts.join(', ') }}</span>
              </div>

              <div
                v-if="row.unclearExts.length"
                class="field"
              >
                <span class="field-label text-muted">{{ t('extensionsCenter.importAnalysis.symbols.cantTellLabel') }}</span>
                <span>{{ row.unclearExts.join(', ') }}</span>
              </div>

              <div class="field">
                <span class="field-label text-muted">{{ t('extensionsCenter.importAnalysis.cols.path') }}</span>
                <code>{{ row.path }}</code>
              </div>

              <p
                v-if="row.risk"
                class="note text-muted"
              >
                {{ t(`extensionsCenter.importAnalysis.riskNote.${ row.risk }`) }}
              </p>
            </div>
          </td>
        </tr>
      </template>
    </SortableTable>

    <!--
      Both lists are shown whole and unfiltered, on purpose. They are the paths
      a symbol search cannot see into, so hiding them behind the same filter
      that produced an empty result would hide them exactly when they matter.
    -->
    <template v-if="index.namespaceOnly.length">
      <h4 class="rollup-title">
        {{ t('extensionsCenter.importAnalysis.symbols.namespaceTitle') }}
      </h4>
      <p class="text-muted hint">
        {{ t('extensionsCenter.importAnalysis.symbols.namespaceDescription') }}
      </p>

      <SortableTable
        :headers="blindHeaders"
        :rows="blindRows(index.namespaceOnly)"
        key-field="path"
        :table-actions="false"
        :row-actions="false"
        :search="false"
        :paging="false"
        no-rows-key="extensionsCenter.importAnalysis.empty"
        default-sort-by="exts"
        :descending="true"
        class="blind-table"
      >
        <template #cell:path="{ row }">
          <code>{{ row.rel }}</code>
        </template>

        <template #cell:scope="{ row }">
          <span class="text-muted">{{ t(`extensionsCenter.importAnalysis.scope.${ row.scope }`) }}</span>
        </template>

        <template #cell:risk="{ row }">
          <span
            v-if="row.risk"
            class="risk"
            :class="`risk-${ row.risk }`"
          >{{ t(`extensionsCenter.importAnalysis.risk.${ row.risk }`) }}</span>
          <span
            v-else
            class="text-muted"
          >{{ t('extensionsCenter.common.na') }}</span>
        </template>

        <template #cell:exts="{ row }">
          <span v-clean-tooltip="row.exts.join(', ')">{{ row.extCount }}</span>
        </template>
      </SortableTable>
    </template>

    <template v-if="index.unrecorded.length">
      <h4 class="rollup-title">
        {{ t('extensionsCenter.importAnalysis.symbols.unrecordedTitle') }}
      </h4>
      <p class="text-muted hint">
        {{ t('extensionsCenter.importAnalysis.symbols.unrecordedDescription') }}
      </p>

      <SortableTable
        :headers="blindHeaders"
        :rows="blindRows(index.unrecorded)"
        key-field="path"
        :table-actions="false"
        :row-actions="false"
        :search="false"
        :paging="false"
        no-rows-key="extensionsCenter.importAnalysis.empty"
        default-sort-by="exts"
        :descending="true"
        class="blind-table"
      >
        <template #cell:path="{ row }">
          <code>{{ row.rel }}</code>
        </template>

        <template #cell:scope="{ row }">
          <span class="text-muted">{{ t(`extensionsCenter.importAnalysis.scope.${ row.scope }`) }}</span>
        </template>

        <template #cell:risk="{ row }">
          <span
            v-if="row.risk"
            class="risk"
            :class="`risk-${ row.risk }`"
          >{{ t(`extensionsCenter.importAnalysis.risk.${ row.risk }`) }}</span>
          <span
            v-else
            class="text-muted"
          >{{ t('extensionsCenter.common.na') }}</span>
        </template>

        <template #cell:exts="{ row }">
          <span v-clean-tooltip="row.exts.join(', ')">{{ row.extCount }}</span>
        </template>
      </SortableTable>
    </template>

    <Banner
      v-if="!index.totals.rows"
      color="info"
      :label="t('extensionsCenter.importAnalysis.symbols.noSpecifiers')"
    />

    <!--
      Always visible, never behind an expander. Every line here is a reason the
      extension list on a row is a lower bound, and a reader who takes the list
      as complete is the failure this view exists to avoid.
    -->
    <div class="caveats">
      <h4>{{ t('extensionsCenter.importAnalysis.symbols.caveatsTitle') }}</h4>
      <ul>
        <li
          v-for="key in CAVEATS"
          :key="key"
        >
          {{ t(`extensionsCenter.importAnalysis.symbols.caveat.${ key }`) }}
        </li>
      </ul>
    </div>
  </div>
</template>

<style lang="scss" scoped>
@import '../styles/severity';

code {
  font-size: 12px;
}

.symbol {
  font-weight: 600;
}

// Same scale as ApiSurfaceTable and the rollup above it: one palette for one
// question, so a reader does not have to learn two.
.risk {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  white-space: nowrap;
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

// Not red: an unanswerable row is not a finding, it is a hole in the evidence.
// Red would rank it alongside the private-path rows, which are a real problem.
.maybe {
  color: $medium-color;
  font-weight: 600;
}

.filter {
  margin-bottom: 8px;
  max-width: 520px;
}

.hint,
.count {
  font-size: 12px;
}

.hint {
  margin: 0 0 12px;
}

.count {
  margin: 0 0 12px;
}

.rollup-title {
  margin: 24px 0 8px;
}

.blind-table {
  margin-bottom: 8px;
}

.detail {
  padding: 8px 0 8px 32px;
}

.field {
  display: flex;
  font-size: 12px;
  gap: 8px;

  + .field {
    margin-top: 6px;
  }
}

.field-label {
  flex: 0 0 110px;
}

.note {
  font-size: 12px;
  margin: 8px 0 0;
}

.caveats {
  background: var(--box-bg);
  border: 1px solid var(--border);
  border-radius: var(--border-radius);
  margin-top: 24px;
  padding: 12px 16px;

  h4 {
    margin: 0 0 8px;
  }

  ul {
    color: var(--muted);
    font-size: 12px;
    margin: 0;
    padding-left: 18px;
  }

  li + li {
    margin-top: 4px;
  }
}
</style>
