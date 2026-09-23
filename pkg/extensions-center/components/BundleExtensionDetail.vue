<script lang="ts">
import { defineComponent, PropType } from 'vue';
import SortableTable from '@shell/components/SortableTable/index.vue';
import { Banner } from '@components/Banner';

import { BundlePackage, ExtensionBundle } from '../types/analysis';
import { TableHeader } from '../types/table';
import { prettyBytes } from '../utils/bytes';

/**
 * One extension's bundle in full: its chunks, its category split, and the
 * packages inside it.
 *
 * Warnings come first because they are the actionable part — everything below
 * them is context for why a number looks the way it does.
 */
export default defineComponent({
  name: 'BundleExtensionDetail',

  components: { Banner, SortableTable },

  props: {
    bundle: {
      type:     Object as PropType<ExtensionBundle>,
      required: true,
    },
  },

  computed: {
    chunkHeaders(): TableHeader[] {
      return [
        {
          name: 'name', labelKey: 'extensionsCenter.bundleAnalysis.cols.chunk', value: 'name', sort: ['name']
        },
        {
          name: 'bytes', labelKey: 'extensionsCenter.bundleAnalysis.cols.size', value: 'bytes', align: 'right', sort: ['bytes']
        },
      ];
    },

    categoryHeaders(): TableHeader[] {
      return [
        {
          name: 'category', labelKey: 'extensionsCenter.bundleAnalysis.cols.category', value: 'category', sort: ['category']
        },
        {
          name: 'bytes', labelKey: 'extensionsCenter.bundleAnalysis.cols.sourceSize', value: 'bytes', align: 'right', sort: ['bytes']
        },
        {
          name: 'files', labelKey: 'extensionsCenter.bundleAnalysis.cols.files', value: 'files', align: 'right', sort: ['files']
        },
      ];
    },

    packageHeaders(): TableHeader[] {
      return [
        {
          name: 'pkg', labelKey: 'extensionsCenter.bundleAnalysis.cols.package', value: 'pkg', sort: ['pkg']
        },
        {
          name: 'category', labelKey: 'extensionsCenter.bundleAnalysis.cols.category', value: 'category', sort: ['category']
        },
        {
          name: 'bytes', labelKey: 'extensionsCenter.bundleAnalysis.cols.sourceSize', value: 'bytes', align: 'right', sort: ['bytes']
        },
        {
          name: 'files', labelKey: 'extensionsCenter.bundleAnalysis.cols.files', value: 'files', align: 'right', sort: ['files']
        },
      ];
    },

    /** Only the packages that should not be there, for the warnings section. */
    leakedPackages(): BundlePackage[] {
      return (this.bundle.byPackage || [])
        .filter((p) => p.category === 'shell' || p.category === 'components' || p.category === 'host-provided');
    },

    warnings(): string[] {
      const leaks = this.bundle.leaks;

      if (!leaks) {
        return [];
      }

      const out: string[] = [];

      if (leaks.shellFiles) {
        out.push(this.t('extensionsCenter.bundleAnalysis.warn.shell', { count: leaks.shellFiles }));
      }

      if (leaks.componentsFiles) {
        out.push(this.t('extensionsCenter.bundleAnalysis.warn.components', { count: leaks.componentsFiles }));
      }

      if (leaks.hostPkgs.length) {
        out.push(this.t('extensionsCenter.bundleAnalysis.warn.host', { pkgs: leaks.hostPkgs.join(', ') }));
      }

      return out;
    },
  },

  methods: {
    prettyBytes,

    categoryLabel(category: string): string {
      return this.t(`extensionsCenter.bundleAnalysis.category.${ category }`);
    },
  },
});
</script>

<template>
  <div class="bundle-detail">
    <h3>{{ bundle.name }} — {{ bundle.semver }}</h3>

    <Banner
      v-if="bundle.error"
      color="warning"
      :label="bundle.error"
    />

    <Banner
      v-for="warning in warnings"
      :key="warning"
      color="error"
      :label="warning"
    />

    <div class="facts">
      <div>
        <label>{{ t('extensionsCenter.bundleAnalysis.pluginDir') }}</label>
        <code v-if="bundle.pluginDir">{{ bundle.pluginDir }}</code>
        <span
          v-else
          class="text-muted"
        >{{ t('extensionsCenter.bundleAnalysis.notPublished') }}</span>
      </div>
      <div>
        <label>{{ t('extensionsCenter.bundleAnalysis.cols.chunks') }}</label>
        <span>{{ bundle.chunkCount }}</span>
      </div>
      <div>
        <label>{{ t('extensionsCenter.bundleAnalysis.cols.bundleSize') }}</label>
        <span>{{ prettyBytes(bundle.totalBundleBytes) }}</span>
      </div>
      <div>
        <label>{{ t('extensionsCenter.bundleAnalysis.sourceMaps') }}</label>
        <span>{{ bundle.hasSourceMaps ? t('generic.yes') : t('generic.no') }}</span>
      </div>
    </div>

    <template v-if="bundle.chunks.length">
      <h4>{{ t('extensionsCenter.bundleAnalysis.detail.chunks') }}</h4>
      <SortableTable
        :headers="chunkHeaders"
        :rows="bundle.chunks"
        key-field="name"
        :table-actions="false"
        :row-actions="false"
        :search="false"
        :paging="false"
        no-rows-key="extensionsCenter.bundleAnalysis.empty"
        default-sort-by="bytes"
        :descending="true"
      >
        <template #cell:name="{ row }">
          <code>{{ row.name }}</code>
        </template>

        <template #cell:bytes="{ row }">
          {{ prettyBytes(row.bytes) }}
        </template>
      </SortableTable>
    </template>

    <template v-if="bundle.byCategory">
      <h4>{{ t('extensionsCenter.bundleAnalysis.detail.byCategory') }}</h4>
      <p class="text-muted hint">
        {{ t('extensionsCenter.bundleAnalysis.sourceSizeHint') }}
      </p>
      <SortableTable
        :headers="categoryHeaders"
        :rows="bundle.byCategory"
        key-field="category"
        :table-actions="false"
        :row-actions="false"
        :search="false"
        :paging="false"
        no-rows-key="extensionsCenter.bundleAnalysis.empty"
        default-sort-by="bytes"
        :descending="true"
      >
        <template #cell:category="{ row }">
          {{ categoryLabel(row.category) }}
        </template>

        <template #cell:bytes="{ row }">
          {{ prettyBytes(row.bytes) }}
        </template>
      </SortableTable>
    </template>

    <template v-if="leakedPackages.length">
      <h4>{{ t('extensionsCenter.bundleAnalysis.detail.leaked') }}</h4>
      <SortableTable
        :headers="packageHeaders"
        :rows="leakedPackages"
        key-field="pkg"
        :table-actions="false"
        :row-actions="false"
        :search="false"
        :paging="false"
        no-rows-key="extensionsCenter.bundleAnalysis.empty"
        default-sort-by="bytes"
        :descending="true"
      >
        <template #cell:pkg="{ row }">
          <code>{{ row.pkg }}</code>
        </template>

        <template #cell:category="{ row }">
          {{ categoryLabel(row.category) }}
        </template>

        <template #cell:bytes="{ row }">
          {{ prettyBytes(row.bytes) }}
        </template>
      </SortableTable>
    </template>

    <template v-if="bundle.byPackage">
      <h4>{{ t('extensionsCenter.bundleAnalysis.detail.byPackage') }}</h4>
      <SortableTable
        :headers="packageHeaders"
        :rows="bundle.byPackage"
        key-field="pkg"
        :table-actions="false"
        :row-actions="false"
        search
        paging
        :rows-per-page="20"
        no-rows-key="extensionsCenter.bundleAnalysis.empty"
        default-sort-by="bytes"
        :descending="true"
      >
        <template #cell:pkg="{ row }">
          <code>{{ row.pkg }}</code>
        </template>

        <template #cell:category="{ row }">
          {{ categoryLabel(row.category) }}
        </template>

        <template #cell:bytes="{ row }">
          {{ prettyBytes(row.bytes) }}
        </template>
      </SortableTable>
    </template>
  </div>
</template>

<style lang="scss" scoped>
.bundle-detail {
  h3 {
    margin: 0 0 16px;
  }

  h4 {
    margin: 24px 0 8px;
  }

  .hint {
    font-size: 12px;
    margin: 0 0 8px;
  }

  .facts {
    display: grid;
    gap: 12px 24px;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    margin: 16px 0;

    label {
      color: var(--input-label);
      display: block;
      font-size: 12px;
    }
  }

  code {
    font-size: 12px;
  }
}
</style>
