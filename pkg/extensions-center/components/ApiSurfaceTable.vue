<script lang="ts">
import { defineComponent, PropType } from 'vue';
import SortableTable from '@shell/components/SortableTable/index.vue';

import { TableHeader } from '../types/table';
import { ApiRisk, ApiSurfacePath, RISK_ORDER } from '../utils/apiSurface';
import { prettyBytes } from '../utils/bytes';
import { i18nMixin } from '../utils/i18n';

/**
 * Shell import paths ranked by how exposed they are to shell changing.
 *
 * Options API to match the other tables in this area. The sub-row carries the
 * symbol list, which is the part that makes a row actionable: "`utils/string`
 * is risky" is not a task, "`utils/string` is imported for `escapeHtml` and
 * `ucFirst` by four extensions" is.
 */

const RISK_RANK: Record<ApiRisk, number> = RISK_ORDER.reduce((acc, risk, i) => {
  acc[risk] = i;

  return acc;
}, {} as Record<ApiRisk, number>);

export default defineComponent({
  name: 'ApiSurfaceTable',

  mixins: [i18nMixin],

  components: { SortableTable },

  props: {
    rows: {
      type:     Array as PropType<ApiSurfacePath[]>,
      required: true,
    },
  },

  computed: {
    headers(): TableHeader[] {
      return [
        {
          name: 'rel', labelKey: 'extensionsCenter.importAnalysis.cols.shellPath', value: 'rel', sort: ['rel']
        },
        {
          name: 'risk', labelKey: 'extensionsCenter.importAnalysis.cols.risk', value: 'riskOrder', sort: ['riskOrder', 'rel']
        },
        {
          name: 'area', labelKey: 'extensionsCenter.importAnalysis.cols.area', value: 'area', sort: ['area', 'rel']
        },
        {
          name: 'usedBy', labelKey: 'extensionsCenter.importAnalysis.cols.usedBy', value: 'extCount', align: 'right', sort: ['extCount']
        },
        {
          name: 'total', labelKey: 'extensionsCenter.importAnalysis.cols.totalImports', value: 'total', align: 'right', sort: ['total']
        },
        {
          name: 'symbols', labelKey: 'extensionsCenter.importAnalysis.cols.symbols', value: 'symbolCount', align: 'right', sort: ['symbolCount']
        },
        {
          name: 'bytes', labelKey: 'extensionsCenter.importAnalysis.cols.sourceSize', value: 'bytesSort', align: 'right', sort: ['bytesSort']
        },
      ];
    },

    tableRows() {
      return this.rows.map((row) => ({
        ...row,
        riskOrder:   RISK_RANK[row.risk],
        extCount:    row.exts.length,
        symbolCount: row.specifiers.length,
        // Unresolved sorts below zero rather than to it, so "we could not find
        // this file" does not read as "this file is empty".
        bytesSort:   row.bytes ?? -1,
      }));
    },
  },

  methods: { prettyBytes },
});
</script>

<template>
  <SortableTable
    :headers="headers"
    :rows="tableRows"
    key-field="path"
    :table-actions="false"
    :row-actions="false"
    :paging="true"
    :rows-per-page="20"
    :sub-rows="true"
    :sub-expandable="true"
    :sub-expand-column="true"
    :sub-rows-description="false"
    no-rows-key="extensionsCenter.importAnalysis.empty"
    default-sort-by="risk"
  >
    <template #cell:rel="{ row }">
      <code>{{ row.rel }}</code>
    </template>

    <!-- The word, not just the colour: `ok` and `file-suffix` are too close in
         consequence for a swatch to separate them. -->
    <template #cell:risk="{ row }">
      <span
        class="risk"
        :class="`risk-${ row.risk }`"
      >{{ t(`extensionsCenter.importAnalysis.risk.${ row.risk }`) }}</span>
    </template>

    <template #cell:area="{ row }">
      <span class="text-muted">{{ t(`extensionsCenter.importAnalysis.area.${ row.area }`) }}</span>
    </template>

    <template #cell:usedBy="{ row }">
      <span v-clean-tooltip="row.exts.join(', ')">{{ row.extCount }}</span>
    </template>

    <template #cell:bytes="{ row }">
      <span
        v-if="row.bytes === null"
        v-clean-tooltip="t('extensionsCenter.importAnalysis.unresolvedHint')"
        class="text-muted"
      >{{ t('extensionsCenter.common.na') }}</span>
      <span v-else>{{ prettyBytes(row.bytes) }}</span>
    </template>

    <template #sub-row="{ row, fullColspan }">
      <tr class="sub-row">
        <td :colspan="fullColspan">
          <div class="detail">
            <p class="note text-muted">
              {{ t(`extensionsCenter.importAnalysis.riskNote.${ row.risk }`) }}
            </p>

            <div class="field">
              <span class="field-label text-muted">{{ t('extensionsCenter.importAnalysis.detail.symbols') }}</span>
              <span
                v-if="!row.specifiers.length"
                class="text-muted"
              >
                {{ t('extensionsCenter.importAnalysis.detail.noSymbols') }}
              </span>
              <span
                v-else
                class="symbols"
              >
                <code
                  v-for="spec in row.specifiers"
                  :key="spec"
                >{{ spec }}</code>
              </span>
            </div>

            <div class="field">
              <span class="field-label text-muted">{{ t('extensionsCenter.importAnalysis.detail.usedBy') }}</span>
              <span>{{ row.exts.join(', ') }}</span>
            </div>
          </div>
        </td>
      </tr>
    </template>
  </SortableTable>
</template>

<style lang="scss" scoped>
@import '../styles/severity';

code {
  font-size: 12px;
}

// Risk is not severity, but it is the same kind of scale and the page already
// teaches this palette on the security screens, so reusing it costs the reader
// nothing to learn. `ok` stays unstyled rather than going green — most of the
// surface is fine, and a wall of green badges would drown the four that matter.
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

.detail {
  padding: 8px 0 8px 32px;
}

.note {
  font-size: 12px;
  margin: 0 0 8px;
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
  flex: 0 0 90px;
}

.symbols {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 8px;
}
</style>
