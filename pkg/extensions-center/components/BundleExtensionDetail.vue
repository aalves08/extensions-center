<script lang="ts">
import { defineComponent, PropType } from 'vue';
import SortableTable from '@shell/components/SortableTable/index.vue';
import { Banner } from '@components/Banner';

import { BundlePackage, ExtensionBundle } from '../types/analysis';
import { TableHeader } from '../types/table';
import { SHELL_CAUSED } from '../utils/bundleCause';
import { prettyBytes } from '../utils/bytes';
import { i18nMixin } from '../utils/i18n';

/**
 * One extension's bundle in full: its chunks, its category split, what put
 * each package there, and the packages themselves.
 *
 * Warnings come first because they are the actionable part — everything below
 * them is context for why a number looks the way it does.
 *
 * Sizes are disk-scaled wherever the bundle has a ratio. The underlying
 * measurement is pre-minification source bytes, which is fine for ranking and
 * misleading as a size, since it overstates the real figure by two to three
 * times and by a different factor per bundle.
 */
export default defineComponent({
  name: 'BundleExtensionDetail',

  mixins: [i18nMixin],

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
          name: 'bytes', labelKey: 'extensionsCenter.bundleAnalysis.cols.shippedSize', value: 'bytes', align: 'right', sort: ['bytes']
        },
        {
          name: 'files', labelKey: 'extensionsCenter.bundleAnalysis.cols.files', value: 'files', align: 'right', sort: ['files']
        },
      ];
    },

    causeHeaders(): TableHeader[] {
      return [
        {
          name: 'cause', labelKey: 'extensionsCenter.bundleAnalysis.cols.cause', value: 'cause', sort: ['cause']
        },
        {
          name: 'bytes', labelKey: 'extensionsCenter.bundleAnalysis.cols.shippedSize', value: 'bytes', align: 'right', sort: ['bytes']
        },
        {
          name: 'packages', labelKey: 'extensionsCenter.bundleAnalysis.cols.packages', value: 'packages', align: 'right', sort: ['packages']
        },
        {
          name: 'fix', labelKey: 'extensionsCenter.bundleAnalysis.cols.fix', sort: false
        },
      ];
    },

    packageHeaders(): TableHeader[] {
      return [
        {
          name: 'pkg', labelKey: 'extensionsCenter.bundleAnalysis.cols.package', value: 'pkg', sort: ['pkg']
        },
        {
          name: 'resolved', labelKey: 'extensionsCenter.bundleAnalysis.cols.resolved', value: 'resolved', sort: ['resolved']
        },
        {
          name: 'cause', labelKey: 'extensionsCenter.bundleAnalysis.cols.cause', value: 'cause', sort: ['cause']
        },
        {
          name: 'bytes', labelKey: 'extensionsCenter.bundleAnalysis.cols.shippedSize', value: 'bytes', align: 'right', sort: ['bytes']
        },
        {
          name: 'files', labelKey: 'extensionsCenter.bundleAnalysis.cols.files', value: 'files', align: 'right', sort: ['files']
        },
      ];
    },

    /**
     * Category rows with their bytes converted to disk.
     *
     * Done here rather than in the cell template so sorting sorts on the same
     * number the reader sees. Scaling is monotonic so the order is unchanged,
     * but a table that sorts on a hidden quantity is a trap for the next
     * person to add a column.
     */
    categoryRows() {
      return (this.bundle.byCategory || []).map((row) => ({ ...row, bytes: this.scale(row.bytes) }));
    },

    causeRows() {
      return (this.bundle.byCause || []).map((row) => ({
        ...row,
        bytes:       this.scale(row.bytes),
        shellCaused: SHELL_CAUSED.has(row.cause),
      }));
    },

    packageRows() {
      return (this.bundle.byPackage || []).map((row) => ({
        ...row,
        bytes:    this.scale(row.bytes),
        // Joined rather than listed: a package resolving to three versions is
        // rare and a column of bullet lists would wreck every other row.
        resolved: row.versions.join(', '),
      }));
    },

    /** Only the packages that should not be there, for the warnings section. */
    leakedPackages(): BundlePackage[] {
      return this.packageRows
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

    /**
     * Source bytes to bytes on disk.
     *
     * A no-op when the bundle has no ratio, which happens when its maps
     * carried no `sourcesContent`. The banner above the tables says so rather
     * than the numbers quietly changing meaning.
     */
    scale(bytes: number): number {
      return this.bundle.ratio === null ? bytes : Math.round(bytes * this.bundle.ratio);
    },

    categoryLabel(category: string): string {
      return this.t(`extensionsCenter.bundleAnalysis.category.${ category }`);
    },

    causeLabel(cause: string): string {
      return this.t(`extensionsCenter.bundleAnalysis.cause.${ cause }`);
    },

    causeFix(cause: string): string {
      return this.t(`extensionsCenter.bundleAnalysis.causeFix.${ cause }`);
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

    <!--
      One banner for the whole page's worth of numbers rather than a note per
      table: the scaling applies to every size below this point, and repeating
      it three times would train people to skip it.
    -->
    <Banner
      v-if="bundle.byPackage && bundle.ratio === null"
      color="warning"
      :label="t('extensionsCenter.bundleAnalysis.noRatio')"
    />

    <template v-if="bundle.byCause && bundle.byCause.length">
      <h4>{{ t('extensionsCenter.bundleAnalysis.detail.byCause') }}</h4>
      <p class="text-muted hint">
        {{ t('extensionsCenter.bundleAnalysis.causeDescription') }}
      </p>
      <SortableTable
        :headers="causeHeaders"
        :rows="causeRows"
        key-field="cause"
        :table-actions="false"
        :row-actions="false"
        :search="false"
        :paging="false"
        no-rows-key="extensionsCenter.bundleAnalysis.empty"
        default-sort-by="bytes"
        :descending="true"
      >
        <template #cell:cause="{ row }">
          <!--
            Shell-caused rows are marked rather than coloured. The point of
            the column is ownership, and a red row would read as "broken",
            which a node polyfill is not — it is simply not this repo's to
            remove.
          -->
          <span :class="{ 'shell-caused': row.shellCaused }">{{ causeLabel(row.cause) }}</span>
        </template>

        <template #cell:bytes="{ row }">
          {{ prettyBytes(row.bytes) }}
        </template>

        <template #cell:fix="{ row }">
          <span class="text-muted fix">{{ causeFix(row.cause) }}</span>
        </template>
      </SortableTable>
    </template>

    <template v-if="bundle.byCategory">
      <h4>{{ t('extensionsCenter.bundleAnalysis.detail.byCategory') }}</h4>
      <p class="text-muted hint">
        {{ t('extensionsCenter.bundleAnalysis.diskNote') }}
      </p>
      <SortableTable
        :headers="categoryHeaders"
        :rows="categoryRows"
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

        <template #cell:resolved="{ row }">
          <span v-if="row.resolved">{{ row.resolved }}</span>
          <span
            v-else
            class="text-muted"
          >{{ t('extensionsCenter.common.na') }}</span>
        </template>

        <template #cell:cause="{ row }">
          {{ causeLabel(row.cause) }}
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
        :rows="packageRows"
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

        <template #cell:resolved="{ row }">
          <span v-if="row.resolved">{{ row.resolved }}</span>
          <span
            v-else
            class="text-muted"
          >{{ t('extensionsCenter.common.na') }}</span>
        </template>

        <template #cell:cause="{ row }">
          {{ causeLabel(row.cause) }}
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
    max-width: 90ch;
  }

  // Weight, not colour: this marks ownership, and a colour here would compete
  // with the severity scale used elsewhere in the product for actual danger.
  .shell-caused {
    font-weight: 600;
  }

  .fix {
    font-size: 12px;
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
