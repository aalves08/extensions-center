<script lang="ts">
import { defineComponent, PropType } from 'vue';
import SortableTable from '@shell/components/SortableTable/index.vue';

import { ExtensionImportDetail, ExtensionImportPath } from '../types/analysis';
import { TableHeader } from '../types/table';
import { prettyBytes } from '../utils/bytes';

/**
 * One extension's imports, broken out by where they point.
 *
 * The specifier column is the reason this view exists. Knowing that six
 * extensions import `@rancher/shell/config/types` is a start, but the useful
 * question is which names they take out of it — that is the set a narrower
 * public API would still have to export.
 */
export default defineComponent({
  name: 'ExtensionImportDetailView',

  components: { SortableTable },

  props: {
    extName: {
      type:     String,
      required: true,
    },

    detail: {
      type:     Object as PropType<ExtensionImportDetail>,
      required: true,
    },
  },

  computed: {
    pathHeaders(): TableHeader[] {
      return [
        {
          name: 'path', labelKey: 'extensionsCenter.importAnalysis.cols.path', value: 'path', sort: ['path']
        },
        {
          name: 'count', labelKey: 'extensionsCenter.importAnalysis.cols.imports', value: 'count', align: 'right', sort: ['count']
        },
        {
          name: 'bytes', labelKey: 'extensionsCenter.importAnalysis.cols.sourceSize', value: 'bytes', align: 'right', sort: ['bytes']
        },
        {
          name: 'specifiers', labelKey: 'extensionsCenter.importAnalysis.cols.specifiers', value: 'specifiers', sort: false
        },
      ];
    },

    externalHeaders(): TableHeader[] {
      return [
        {
          name: 'path', labelKey: 'extensionsCenter.importAnalysis.cols.package', value: 'path', sort: ['path']
        },
        {
          name: 'count', labelKey: 'extensionsCenter.importAnalysis.cols.imports', value: 'count', align: 'right', sort: ['count']
        },
      ];
    },

    shellTotal(): number {
      return this.sumBytes(this.detail.shell);
    },

    componentsTotal(): number {
      return this.sumBytes(this.detail.components);
    },
  },

  methods: {
    prettyBytes,

    sumBytes(rows: ExtensionImportPath[]): number {
      return rows.reduce((sum, r) => sum + (r.bytes || 0), 0);
    },
  },
});
</script>

<template>
  <div class="extension-detail">
    <h3>{{ extName }}</h3>

    <h4>
      {{ t('extensionsCenter.importAnalysis.detail.shell') }}
      <span class="text-muted">{{ prettyBytes(shellTotal) }}</span>
    </h4>
    <SortableTable
      :headers="pathHeaders"
      :rows="detail.shell"
      key-field="path"
      :table-actions="false"
      :row-actions="false"
      :search="false"
      :paging="false"
      no-rows-key="extensionsCenter.importAnalysis.empty"
      default-sort-by="bytes"
      :descending="true"
    >
      <template #cell:path="{ row }">
        <code>{{ row.path }}</code>
      </template>

      <template #cell:bytes="{ row }">
        <span
          v-if="!row.bytes"
          class="text-muted"
        >{{ t('extensionsCenter.common.na') }}</span>
        <span v-else>{{ prettyBytes(row.bytes) }}</span>
      </template>

      <template #cell:specifiers="{ row }">
        <span
          v-if="row.specifiers && row.specifiers.length"
          class="specifiers"
        >{{ row.specifiers.join(', ') }}</span>
        <span
          v-else
          class="text-muted"
        >{{ t('extensionsCenter.common.na') }}</span>
      </template>
    </SortableTable>

    <h4>
      {{ t('extensionsCenter.importAnalysis.detail.components') }}
      <span class="text-muted">{{ prettyBytes(componentsTotal) }}</span>
    </h4>
    <SortableTable
      :headers="pathHeaders"
      :rows="detail.components"
      key-field="path"
      :table-actions="false"
      :row-actions="false"
      :search="false"
      :paging="false"
      no-rows-key="extensionsCenter.importAnalysis.empty"
      default-sort-by="bytes"
      :descending="true"
    >
      <template #cell:path="{ row }">
        <code>{{ row.path }}</code>
      </template>

      <template #cell:bytes="{ row }">
        <span
          v-if="!row.bytes"
          class="text-muted"
        >{{ t('extensionsCenter.common.na') }}</span>
        <span v-else>{{ prettyBytes(row.bytes) }}</span>
      </template>

      <template #cell:specifiers="{ row }">
        <span
          v-if="row.specifiers && row.specifiers.length"
          class="specifiers"
        >{{ row.specifiers.join(', ') }}</span>
        <span
          v-else
          class="text-muted"
        >{{ t('extensionsCenter.common.na') }}</span>
      </template>
    </SortableTable>

    <h4>{{ t('extensionsCenter.importAnalysis.detail.external') }}</h4>
    <SortableTable
      :headers="externalHeaders"
      :rows="detail.external"
      key-field="path"
      :table-actions="false"
      :row-actions="false"
      :search="false"
      :paging="false"
      no-rows-key="extensionsCenter.importAnalysis.empty"
      default-sort-by="count"
      :descending="true"
    >
      <template #cell:path="{ row }">
        <code>{{ row.path }}</code>
      </template>
    </SortableTable>
  </div>
</template>

<style lang="scss" scoped>
.extension-detail {
  h3 {
    margin: 0 0 16px;
  }

  h4 {
    align-items: baseline;
    display: flex;
    gap: 8px;
    margin: 24px 0 8px;

    span {
      font-size: 13px;
      font-weight: normal;
    }
  }

  code {
    font-size: 12px;
  }

  .specifiers {
    font-size: 12px;
    word-break: break-word;
  }
}
</style>
