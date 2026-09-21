<script lang="ts">
import { defineComponent, PropType } from 'vue';
import SortableTable from '@shell/components/SortableTable/index.vue';

import { OfficialRepo } from '../types/repos';
import { TableHeader } from '../types/table';

/**
 * The upstream official extension repos from the ui-plugin-charts manifest.
 *
 * The name links out to the repo, per the row-title behaviour these tables use
 * everywhere else in the extension.
 */
export default defineComponent({
  name: 'OfficialReposTable',

  components: { SortableTable },

  props: {
    rows: {
      type:     Array as PropType<OfficialRepo[]>,
      required: true,
    },

    loading: {
      type:    Boolean,
      default: false,
    },

    paging: {
      type:    Boolean,
      default: false,
    },
  },

  computed: {
    headers(): TableHeader[] {
      return [
        {
          name: 'name', labelKey: 'extensionsCenter.officialRepos.cols.name', value: 'name', sort: ['name']
        },
        {
          name: 'headBranch', labelKey: 'extensionsCenter.officialRepos.cols.headBranch', value: 'headBranch', sort: ['headBranch']
        },
        {
          name: 'shellVersion', labelKey: 'extensionsCenter.officialRepos.cols.shellVersion', value: 'shellVersion', sort: ['shellVersion']
        },
        {
          name: 'componentsVersion', labelKey: 'extensionsCenter.officialRepos.cols.componentsVersion', value: 'componentsVersion', sort: ['componentsVersion']
        },
        {
          name: 'publishedVersion', labelKey: 'extensionsCenter.officialRepos.cols.publishedVersion', value: 'publishedVersion', sort: ['publishedVersion']
        },
        {
          name: 'latestOfficialVersion', labelKey: 'extensionsCenter.officialRepos.cols.latestOfficial', value: 'latestOfficialVersion', sort: ['latestOfficialVersion']
        },
      ];
    },
  },
});
</script>

<template>
  <div class="official-repos">
    <SortableTable
      :headers="headers"
      :rows="rows"
      :loading="loading"
      key-field="id"
      :table-actions="false"
      :row-actions="false"
      :search="paging"
      :paging="paging"
      :rows-per-page="20"
      no-rows-key="extensionsCenter.officialRepos.empty"
      default-sort-by="name"
    >
      <template #cell:name="{ row }">
        <a
          v-clean-tooltip="row.id"
          :href="row.repoUrl"
          target="_blank"
          rel="noopener noreferrer"
        >
          {{ row.name }}
          <i class="icon icon-external-link" />
        </a>
        <i
          v-if="row.error"
          v-clean-tooltip="row.error"
          class="icon icon-warning text-warning"
        />
      </template>

      <template #cell:headBranch="{ row }">
        <span v-if="row.headBranch">{{ row.headBranch }}</span>
        <span
          v-else
          class="text-muted"
        >{{ t('extensionsCenter.common.na') }}</span>
      </template>

      <template #cell:shellVersion="{ row }">
        <span v-if="row.shellVersion">{{ row.shellVersion }}</span>
        <span
          v-else
          class="text-muted"
        >{{ t('extensionsCenter.common.na') }}</span>
      </template>

      <template #cell:componentsVersion="{ row }">
        <span v-if="row.componentsVersion">{{ row.componentsVersion }}</span>
        <span
          v-else
          class="text-muted"
        >{{ t('extensionsCenter.common.na') }}</span>
      </template>

      <template #cell:publishedVersion="{ row }">
        <span v-if="row.publishedVersion">{{ row.publishedVersion }}</span>
        <span
          v-else
          class="text-muted"
        >{{ t('extensionsCenter.common.na') }}</span>
      </template>

      <!--
        The marker span is what the row highlight below keys off: SortableTable
        renders the <tr> itself and takes no class for it, so there is nothing
        to hang a modifier on from out here.
      -->
      <template #cell:latestOfficialVersion="{ row }">
        <span
          v-if="row.latestOfficialVersion"
          :class="{ 'out-of-sync': row.outOfSync }"
        >
          {{ row.latestOfficialVersion }}
          <i
            v-if="row.outOfSync"
            v-clean-tooltip="t('extensionsCenter.officialRepos.outOfSync', { published: row.publishedVersion, official: row.latestOfficialVersion })"
            class="icon icon-warning"
          />
        </span>
        <span
          v-else
          class="text-muted"
        >{{ t('extensionsCenter.common.na') }}</span>
      </template>
    </SortableTable>
  </div>
</template>

<style lang="scss" scoped>
.official-repos {
  .icon-external-link {
    font-size: 11px;
  }

  .icon-warning {
    margin-left: 4px;
  }

  // `:has()` walks from our marker back up to the row it sits in, which is the
  // only handle available on markup this component does not render. The tint
  // and the border are paired deliberately: colour alone would not survive a
  // colour-blind reader or a low-contrast display.
  :deep(tbody tr:has(.out-of-sync)) {
    background: var(--warning-banner-bg);
    color: var(--warning-banner-text);

    > td:first-child {
      box-shadow: inset 3px 0 0 var(--warning);
    }
  }
}
</style>
