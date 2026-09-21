<script lang="ts">
import { defineComponent, PropType } from 'vue';
import SortableTable from '@shell/components/SortableTable/index.vue';
import { BadgeState } from '@components/BadgeState';

import { KnownRepo } from '../types/repos';
import { TableHeader } from '../types/table';

/**
 * Known extension repos, community and official.
 *
 * The dashboard passes the top slice of community repos with paging off; the
 * list view passes everything with paging and search on.
 */
export default defineComponent({
  name: 'KnownReposTable',

  components: { BadgeState, SortableTable },

  props: {
    rows: {
      type:     Array as PropType<KnownRepo[]>,
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

    /** Drop the description column where there is no room for it */
    compact: {
      type:    Boolean,
      default: false,
    },
  },

  computed: {
    headers(): TableHeader[] {
      const description: TableHeader = {
        name: 'description', labelKey: 'extensionsCenter.knownRepos.cols.description', value: 'description', sort: false
      };

      return [
        {
          name: 'name', labelKey: 'extensionsCenter.knownRepos.cols.name', value: 'name', sort: ['name']
        },
        {
          name: 'repo', labelKey: 'extensionsCenter.knownRepos.cols.repo', value: 'id', sort: ['id']
        },
        ...(this.compact ? [] : [description]),
        // One column, not two. Until the categorisation layer comes back the
        // category *is* who owns the repo, and showing that twice under two
        // headings would only suggest they mean different things.
        {
          name: 'origin', labelKey: 'extensionsCenter.knownRepos.cols.category', value: 'isExternal', align: 'center', sort: ['isExternal', 'name']
        },
      ];
    },
  },
});
</script>

<template>
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
    :extra-search-fields="['id', 'description']"
    no-rows-key="extensionsCenter.knownRepos.empty"
    default-sort-by="name"
  >
    <template #cell:name="{ row }">
      <span v-clean-tooltip="row.description">{{ row.name }}</span>
    </template>

    <template #cell:repo="{ row }">
      <a
        :href="row.repoUrl"
        target="_blank"
        rel="noopener noreferrer"
      >
        {{ row.id }}
        <i class="icon icon-external-link" />
      </a>
    </template>

    <template #cell:description="{ row }">
      <span v-if="row.description">{{ row.description }}</span>
      <span
        v-else
        class="text-muted"
      >{{ t('extensionsCenter.common.na') }}</span>
    </template>

    <template #cell:origin="{ row }">
      <BadgeState
        :color="row.isExternal ? 'bg-warning' : 'bg-info'"
        :label="row.isExternal ? t('extensionsCenter.knownRepos.external') : t('extensionsCenter.knownRepos.suse')"
      />
    </template>
  </SortableTable>
</template>

<style lang="scss" scoped>
.icon-external-link {
  font-size: 11px;
}
</style>
