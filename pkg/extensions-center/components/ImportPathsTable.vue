<script lang="ts">
import { defineComponent, PropType } from 'vue';
import SortableTable from '@shell/components/SortableTable/index.vue';

import { AggregateImportPath } from '../types/analysis';
import { TableHeader } from '../types/table';
import { prettyBytes } from '../utils/bytes';

/**
 * Import paths aggregated across every extension.
 *
 * One component serves the shell, components, external-package and unresolved
 * tables: they differ only in whether a size column makes sense and in the
 * label above them, so `showBytes` and the caller's heading cover the lot.
 */
export default defineComponent({
  name: 'ImportPathsTable',

  components: { SortableTable },

  props: {
    rows: {
      type:     Array as PropType<AggregateImportPath[]>,
      required: true,
    },

    /** Header for the path column — "Shell path", "Package", and so on */
    pathLabelKey: {
      type:     String,
      required: true,
    },

    /** Off for external packages, whose source is not in rancher/dashboard */
    showBytes: {
      type:    Boolean,
      default: true,
    },

    paging: {
      type:    Boolean,
      default: true,
    },
  },

  computed: {
    headers(): TableHeader[] {
      const bytes: TableHeader = {
        name: 'bytes', labelKey: 'extensionsCenter.importAnalysis.cols.sourceSize', value: 'bytes', align: 'right', sort: ['bytes']
      };

      return [
        {
          name: 'path', labelKey: this.pathLabelKey, value: 'path', sort: ['path']
        },
        {
          name: 'usedBy', labelKey: 'extensionsCenter.importAnalysis.cols.usedBy', value: 'exts.length', align: 'right', sort: ['exts.length']
        },
        {
          name: 'total', labelKey: 'extensionsCenter.importAnalysis.cols.totalImports', value: 'total', align: 'right', sort: ['total']
        },
        ...(this.showBytes ? [bytes] : []),
      ];
    },
  },

  methods: { prettyBytes },
});
</script>

<template>
  <SortableTable
    :headers="headers"
    :rows="rows"
    key-field="path"
    :table-actions="false"
    :row-actions="false"
    :search="paging"
    :paging="paging"
    :rows-per-page="20"
    no-rows-key="extensionsCenter.importAnalysis.empty"
    default-sort-by="usedBy"
    :descending="true"
  >
    <template #cell:path="{ row }">
      <code>{{ row.path }}</code>
    </template>

    <template #cell:usedBy="{ row }">
      <span v-clean-tooltip="row.exts.join(', ')">{{ row.exts.length }}</span>
    </template>

    <template #cell:bytes="{ row }">
      <span
        v-if="row.bytes === null"
        v-clean-tooltip="t('extensionsCenter.importAnalysis.unresolvedHint')"
        class="text-muted"
      >{{ t('extensionsCenter.common.na') }}</span>
      <span v-else>{{ prettyBytes(row.bytes) }}</span>
    </template>
  </SortableTable>
</template>

<style lang="scss" scoped>
code {
  font-size: 12px;
}
</style>
