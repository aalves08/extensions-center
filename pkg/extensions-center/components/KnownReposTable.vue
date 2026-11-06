<script lang="ts">
import { defineComponent, PropType } from 'vue';
import SortableTable from '@shell/components/SortableTable/index.vue';
import { BadgeState } from '@components/BadgeState';

import { KnownRepo } from '../types/repos';
import { TableHeader } from '../types/table';
import { i18nMixin } from '../utils/i18n';

/**
 * Known extension repos, community and official.
 *
 * The dashboard passes the top slice of community repos with paging off; the
 * list view passes everything with paging and search on.
 */
export default defineComponent({
  name: 'KnownReposTable',

  mixins: [i18nMixin],

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
    /**
     * Whether anyone has run Describe with AI against this data.
     *
     * Read off the rows rather than passed in, so the category column appears
     * with the data that fills it and a table nobody has described never
     * shows a column of dashes.
     *
     * Either field counts. They are written together, but a row cached by an
     * earlier build carries only the description — and keying this on the
     * category alone meant that table showed model-written descriptions with
     * no column to explain where they came from.
     */
    hasAi(): boolean {
      return this.rows.some((r) => !!r.aiCategory || !!r.aiDescription);
    },

    headers(): TableHeader[] {
      const description: TableHeader = {
        name: 'description', labelKey: 'extensionsCenter.knownRepos.cols.description', value: 'description', sort: false
      };

      const category: TableHeader = {
        name: 'aiCategory', labelKey: 'extensionsCenter.knownRepos.cols.aiCategory', value: 'aiCategory', align: 'center', sort: ['aiCategory', 'name']
      };

      return [
        {
          name: 'name', labelKey: 'extensionsCenter.knownRepos.cols.name', value: 'name', sort: ['name']
        },
        {
          name: 'repo', labelKey: 'extensionsCenter.knownRepos.cols.repo', value: 'id', sort: ['id']
        },
        ...(this.compact ? [] : [description]),
        // Shown in compact mode too. `compact` drops the description because a
        // sentence has nowhere to go in a dashboard tile; a one-word badge
        // does, and it is the thing the tile is least able to say otherwise.
        ...(this.hasAi ? [category] : []),
        // Origin and category were one column while there was no categoriser:
        // who owns the repo was the only categorisation there was. Now that
        // the model supplies a functional one they are genuinely two different
        // facts, so this column says what it actually holds.
        {
          name: 'origin', labelKey: 'extensionsCenter.knownRepos.cols.origin', value: 'isExternal', align: 'center', sort: ['isExternal', 'name']
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
      <span v-clean-tooltip="row.aiDescription || row.description">{{ row.aiName || row.name }}</span>
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

    <!--
      A model-written description wins over GitHub's own, which is blank on
      roughly half these repos and boilerplate on several more. It is marked
      as such and keeps the original on hover, because a sentence nobody on
      the project wrote should not be able to pass for one they did.
    -->
    <template #cell:description="{ row }">
      <span
        v-if="row.aiDescription"
        v-clean-tooltip="row.description || t('extensionsCenter.knownRepos.describe.noOriginal')"
      >
        {{ row.aiDescription }}
        <i
          v-clean-tooltip="t('extensionsCenter.knownRepos.describe.marker')"
          class="icon icon-info ai-marker"
        />
      </span>
      <span v-else-if="row.description">{{ row.description }}</span>
      <span
        v-else
        class="text-muted"
      >{{ t('extensionsCenter.common.na') }}</span>
    </template>

    <template #cell:aiCategory="{ row }">
      <BadgeState
        v-if="row.aiCategory"
        color="bg-default"
        :label="row.aiCategory"
      />
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

.ai-marker {
  color: var(--primary);
  font-size: 11px;
  margin-left: 2px;
  vertical-align: baseline;
}
</style>
