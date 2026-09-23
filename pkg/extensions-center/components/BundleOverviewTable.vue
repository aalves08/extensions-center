<script lang="ts">
import { defineComponent, PropType } from 'vue';
import SortableTable from '@shell/components/SortableTable/index.vue';

import { BundleCategory, ExtensionBundle } from '../types/analysis';
import { TableHeader } from '../types/table';
import { prettyBytes } from '../utils/bytes';

/**
 * Every extension's shipped bundle, one row each.
 *
 * The two right-hand columns are the ones that matter. `@rancher/shell` and
 * `@rancher/components` are provided by the host at runtime and must be
 * externalized — finding either inside a bundle means that extension is
 * shipping a second copy of code the host already loaded.
 */
export default defineComponent({
  name: 'BundleOverviewTable',

  components: { SortableTable },

  props: {
    rows: {
      type:     Array as PropType<ExtensionBundle[]>,
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
          name: 'name', labelKey: 'extensionsCenter.bundleAnalysis.cols.extension', value: 'name', sort: ['name']
        },
        {
          name: 'semver', labelKey: 'extensionsCenter.bundleAnalysis.cols.version', value: 'semver', sort: ['semver']
        },
        {
          name: 'chunkCount', labelKey: 'extensionsCenter.bundleAnalysis.cols.chunks', value: 'chunkCount', align: 'right', sort: ['chunkCount']
        },
        {
          name: 'totalBundleBytes', labelKey: 'extensionsCenter.bundleAnalysis.cols.bundleSize', value: 'totalBundleBytes', align: 'right', sort: ['totalBundleBytes']
        },
        {
          name: 'ownCode', labelKey: 'extensionsCenter.bundleAnalysis.cols.ownCode', align: 'right', sort: false
        },
        {
          name: 'externalLibs', labelKey: 'extensionsCenter.bundleAnalysis.cols.externalLibs', align: 'right', sort: false
        },
        {
          name: 'shellLeak', labelKey: 'extensionsCenter.bundleAnalysis.cols.shellLeak', align: 'center', sort: false
        },
        {
          name: 'componentsLeak', labelKey: 'extensionsCenter.bundleAnalysis.cols.componentsLeak', align: 'center', sort: false
        },
      ];
    },
  },

  methods: {
    prettyBytes,

    categoryBytes(row: ExtensionBundle, category: BundleCategory): number | null {
      if (!row.byCategory) {
        return null;
      }

      return row.byCategory.find((c) => c.category === category)?.bytes ?? 0;
    },
  },
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
    no-rows-key="extensionsCenter.bundleAnalysis.empty"
    default-sort-by="totalBundleBytes"
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

    <template #cell:totalBundleBytes="{ row }">
      <span v-if="row.pluginDir">{{ prettyBytes(row.totalBundleBytes) }}</span>
      <span
        v-else
        class="text-muted"
      >{{ t('extensionsCenter.bundleAnalysis.notPublished') }}</span>
    </template>

    <template #cell:ownCode="{ row }">
      <span v-if="categoryBytes(row, 'extension-code') !== null">
        {{ prettyBytes(categoryBytes(row, 'extension-code')) }}
      </span>
      <span
        v-else
        class="text-muted"
      >{{ t('extensionsCenter.common.na') }}</span>
    </template>

    <template #cell:externalLibs="{ row }">
      <span v-if="categoryBytes(row, 'external-lib') !== null">
        {{ prettyBytes(categoryBytes(row, 'external-lib')) }}
      </span>
      <span
        v-else
        class="text-muted"
      >{{ t('extensionsCenter.common.na') }}</span>
    </template>

    <template #cell:shellLeak="{ row }">
      <span
        v-if="!row.leaks"
        class="text-muted"
      >{{ t('extensionsCenter.common.na') }}</span>
      <span
        v-else-if="row.leaks.shellFiles"
        class="text-error"
      >
        {{ prettyBytes(categoryBytes(row, 'shell')) }}
      </span>
      <i
        v-else
        class="icon icon-checkmark text-success"
      />
    </template>

    <template #cell:componentsLeak="{ row }">
      <span
        v-if="!row.leaks"
        class="text-muted"
      >{{ t('extensionsCenter.common.na') }}</span>
      <span
        v-else-if="row.leaks.componentsFiles"
        class="text-error"
      >
        {{ prettyBytes(categoryBytes(row, 'components')) }}
      </span>
      <i
        v-else
        class="icon icon-checkmark text-success"
      />
    </template>
  </SortableTable>
</template>

<style lang="scss" scoped>
.icon-warning {
  margin-left: 4px;
}
</style>
