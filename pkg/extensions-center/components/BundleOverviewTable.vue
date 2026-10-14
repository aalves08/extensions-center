<script lang="ts">
import { defineComponent, PropType } from 'vue';
import SortableTable from '@shell/components/SortableTable/index.vue';
import Tag from '@shell/components/Tag.vue';

import { BundleCategory, ExtensionBundle } from '../types/analysis';
import { TableHeader } from '../types/table';
import { prettyBytes } from '../utils/bytes';
import { i18nMixin } from '../utils/i18n';

/**
 * Every extension's shipped bundle, one row each.
 *
 * The two right-hand columns are the ones that matter. `@rancher/shell` and
 * `@rancher/components` are provided by the host at runtime and must be
 * externalized — finding either inside a bundle means that extension is
 * shipping a second copy of code the host already loaded.
 *
 * Every byte figure in this table is disk-scaled. Source bytes are
 * pre-minification and ran two to three times the real download size, and by a
 * different multiple per bundle — so the breakdown columns used to sum to well
 * over the bundle size sitting beside them. Scaling by each bundle's own ratio
 * makes the row add up and makes two rows comparable.
 */
export default defineComponent({
  name: 'BundleOverviewTable',

  mixins: [i18nMixin],

  components: { SortableTable, Tag },

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
          name: 'shellCaused', labelKey: 'extensionsCenter.bundleAnalysis.cols.shellCaused', align: 'right', sort: false
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

    /**
     * One category's contribution to this bundle, as bytes on disk.
     *
     * Null when the category split was never read, or when the bundle has no
     * ratio to scale by — both mean "we cannot answer", and showing a
     * pre-minification number here would be answering a different question.
     */
    categoryBytes(row: ExtensionBundle, category: BundleCategory): number | null {
      if (!row.byCategory || row.ratio === null) {
        return null;
      }

      return Math.round((row.byCategory.find((c) => c.category === category)?.bytes ?? 0) * row.ratio);
    },

    shellCausedBytes(row: ExtensionBundle): number | null {
      return row.ratio === null ? null : Math.round(row.shellCausedBytes * row.ratio);
    },

    /** Shell-caused weight as a share of the whole bundle. */
    shellCausedPct(row: ExtensionBundle): number | null {
      const bytes = this.shellCausedBytes(row);

      if (bytes === null || !row.totalBundleBytes) {
        return null;
      }

      return Math.round((bytes / row.totalBundleBytes) * 100);
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
      <Tag
        v-if="!row.inManifest"
        v-clean-tooltip="t('extensionsCenter.common.unlistedTooltip')"
        class="unlisted"
      >
        {{ t('extensionsCenter.common.unlisted') }}
      </Tag>
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

    <!--
      The share of this bundle that nobody but rancher/dashboard can remove.
      The percentage rather than the bytes is the headline: it is the number
      that says whether an extension is big because of what it does or because
      of what shell made it carry.
    -->
    <template #cell:shellCaused="{ row }">
      <span v-if="shellCausedBytes(row) !== null">
        {{ prettyBytes(shellCausedBytes(row)) }}
        <span
          v-if="shellCausedPct(row) !== null"
          class="text-muted pct"
        >{{ shellCausedPct(row) }}%</span>
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

.unlisted {
  margin-left: 6px;
  white-space: nowrap;
}

.pct {
  font-size: 11px;
  margin-left: 4px;
}
</style>
