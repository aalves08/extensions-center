<script lang="ts">
import { defineComponent, PropType } from 'vue';
import SortableTable from '@shell/components/SortableTable/index.vue';

import { ExtensionImportTotals } from '../types/analysis';
import { TableHeader } from '../types/table';
import { prettyBytes } from '../utils/bytes';

/**
 * Per-extension import totals — the "who leans on the shell hardest" table.
 *
 * Sorted by shell bytes by default rather than by import count: an extension
 * with forty imports of small utilities depends on far less of the shell than
 * one with ten imports that each drag in a large component.
 */
export default defineComponent({
  name: 'ImportTotalsTable',

  components: { SortableTable },

  props: {
    rows: {
      type:     Array as PropType<ExtensionImportTotals[]>,
      required: true,
    },

    loading: {
      type:    Boolean,
      default: false,
    },
  },

  emits: ['select'],

  computed: {
    headers(): TableHeader[] {
      return [
        {
          name: 'name', labelKey: 'extensionsCenter.importAnalysis.cols.extension', value: 'name', sort: ['name']
        },
        {
          name: 'semver', labelKey: 'extensionsCenter.importAnalysis.cols.version', value: 'semver', sort: ['semver']
        },
        {
          name: 'fileCount', labelKey: 'extensionsCenter.importAnalysis.cols.files', value: 'fileCount', align: 'right', sort: ['fileCount']
        },
        {
          name: 'shell', labelKey: 'extensionsCenter.importAnalysis.cols.shellImports', value: 'shell', align: 'right', sort: ['shell']
        },
        {
          name: 'uniqueShellPaths', labelKey: 'extensionsCenter.importAnalysis.cols.uniquePaths', value: 'uniqueShellPaths', align: 'right', sort: ['uniqueShellPaths']
        },
        {
          name: 'shellBytes', labelKey: 'extensionsCenter.importAnalysis.cols.shellBytes', value: 'shellBytes', align: 'right', sort: ['shellBytes']
        },
        {
          name: 'components', labelKey: 'extensionsCenter.importAnalysis.cols.componentsImports', value: 'components', align: 'right', sort: ['components']
        },
        {
          name: 'componentsBytes', labelKey: 'extensionsCenter.importAnalysis.cols.componentsBytes', value: 'componentsBytes', align: 'right', sort: ['componentsBytes']
        },
        {
          name: 'external', labelKey: 'extensionsCenter.importAnalysis.cols.external', value: 'external', align: 'right', sort: ['external']
        },
        {
          name: 'internal', labelKey: 'extensionsCenter.importAnalysis.cols.internal', value: 'internal', align: 'right', sort: ['internal']
        },
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
    :loading="loading"
    key-field="name"
    :table-actions="false"
    :row-actions="false"
    :search="false"
    :paging="false"
    no-rows-key="extensionsCenter.importAnalysis.empty"
    default-sort-by="shellBytes"
    :descending="true"
  >
    <template #cell:name="{ row }">
      <a
        href="#"
        @click.prevent="$emit('select', row.name)"
      >{{ row.name }}</a>
      <i
        v-if="row.error"
        v-clean-tooltip="row.error"
        class="icon icon-warning text-warning"
      />
    </template>

    <template #cell:shellBytes="{ row }">
      {{ prettyBytes(row.shellBytes) }}
    </template>

    <template #cell:componentsBytes="{ row }">
      {{ prettyBytes(row.componentsBytes) }}
    </template>
  </SortableTable>
</template>

<style lang="scss" scoped>
.icon-warning {
  margin-left: 4px;
}
</style>
