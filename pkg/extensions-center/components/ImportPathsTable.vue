<script lang="ts">
import { defineComponent, PropType } from 'vue';
import SortableTable from '@shell/components/SortableTable/index.vue';

import { AggregateImportPath, ExtensionImportDetail } from '../types/analysis';
import { TableHeader } from '../types/table';
import { prettyBytes } from '../utils/bytes';
import { i18nMixin } from '../utils/i18n';

/**
 * Import paths aggregated across every extension.
 *
 * One component serves the shell, components, external-package and unresolved
 * tables: they differ only in whether a size column makes sense and in the
 * label above them, so `showBytes` and the caller's heading cover the lot.
 *
 * Expanding a row names the extensions behind the count, with how many times
 * each imports the path and which symbols it takes. "Four extensions use this"
 * is a number; "kubewarden takes `escapeHtml` from it twelve times" is
 * something to act on, and it is what makes a path traceable back to the work
 * that would have to change if shell moved it.
 */

/** One extension's use of a single path, as the sub-row lists it. */
interface PathUser {
  name: string;
  /** Zero when the saved document predates the per-extension breakdown */
  count: number;
  specifiers: string[];
}

export default defineComponent({
  name: 'ImportPathsTable',

  mixins: [i18nMixin],

  components: { SortableTable },

  emits: ['select'],

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

    /**
     * The saved per-extension breakdown, keyed by extension name.
     *
     * Optional so the table still renders against a document saved before this
     * existed; such a row falls back to naming the extensions without counts.
     */
    detail: {
      type:    Object as PropType<Record<string, ExtensionImportDetail>>,
      default: () => ({}),
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

    /**
     * Every path in the document, mapped to the extensions that import it.
     *
     * Built once for the whole table rather than looked up per expanded row:
     * the three lists are walked anyway, and an index keeps expanding a row
     * free no matter how many are open at once.
     *
     * All three lists go into one map because a path only ever lands in one of
     * them — shell paths start `@rancher/shell`, components paths
     * `@rancher/components`, and anything else is external — so no `kind` prop
     * is needed to tell the caller's tab apart.
     */
    usage(): Record<string, PathUser[]> {
      const out: Record<string, PathUser[]> = {};

      for (const [name, detail] of Object.entries(this.detail || {})) {
        for (const list of [detail.shell, detail.components, detail.external]) {
          for (const entry of list || []) {
            const users = out[entry.path] = out[entry.path] || [];
            const existing = users.find((u) => u.name === name);

            if (existing) {
              existing.count += entry.count;
              existing.specifiers = [...new Set([...existing.specifiers, ...entry.specifiers || []])];
            } else {
              users.push({
                name, count: entry.count, specifiers: [...entry.specifiers || []]
              });
            }
          }
        }
      }

      // Heaviest user first: on a path with a dozen consumers, the one with 40
      // imports is the one whose migration actually costs something.
      for (const users of Object.values(out)) {
        users.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
      }

      return out;
    },
  },

  methods: {
    prettyBytes,

    /**
     * Who uses one path.
     *
     * Falls back to the aggregate's own name list, which has been in the saved
     * document since the first version of this page. A row then still answers
     * "which extensions", just without the counts — better than an empty panel
     * under a chevron that promised something.
     */
    users(row: AggregateImportPath): PathUser[] {
      return this.usage[row.path] || row.exts.map((name) => ({
        name, count: 0, specifiers: []
      }));
    },
  },
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
    :sub-rows="true"
    :sub-expandable="true"
    :sub-expand-column="true"
    :sub-rows-description="false"
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

    <template #sub-row="{ row, fullColspan }">
      <tr class="sub-row">
        <td :colspan="fullColspan">
          <div class="detail">
            <span class="field-label text-muted">{{ t('extensionsCenter.importAnalysis.detail.usedBy') }}</span>

            <p
              v-if="!users(row).length"
              class="text-muted empty"
            >
              {{ t('extensionsCenter.importAnalysis.detail.noUsage') }}
            </p>

            <ul
              v-else
              class="users"
            >
              <li
                v-for="use in users(row)"
                :key="use.name"
              >
                <!-- The name goes to that extension's own breakdown, so a path
                     can be followed through to everything else it imports. -->
                <a
                  href="#"
                  class="who"
                  @click.prevent="$emit('select', use.name)"
                >{{ use.name }}</a>

                <span
                  v-if="use.count"
                  class="text-muted count"
                >{{ t('extensionsCenter.importAnalysis.detail.importCount', { count: use.count }) }}</span>

                <span
                  v-if="use.specifiers.length"
                  class="symbols"
                >
                  <code
                    v-for="spec in use.specifiers"
                    :key="spec"
                  >{{ spec }}</code>
                </span>
              </li>
            </ul>
          </div>
        </td>
      </tr>
    </template>
  </SortableTable>
</template>

<style lang="scss" scoped>
code {
  font-size: 12px;
}

// Matches ApiSurfaceTable's sub-row, which sits two tabs away and shows the
// same kind of thing. Two different expanded panels on one page would read as
// two different features.
.detail {
  padding: 8px 0 8px 32px;
}

.field-label {
  font-size: 12px;
}

.empty {
  font-size: 12px;
  margin: 4px 0 0;
}

.users {
  list-style: none;
  margin: 4px 0 0;
  padding: 0;

  li {
    align-items: baseline;
    display: flex;
    flex-wrap: wrap;
    font-size: 12px;
    gap: 4px 8px;
  }

  li + li {
    margin-top: 6px;
  }
}

// Fixed width so the counts line up down the list: scanning for the heaviest
// user is the reason to open this at all.
.who {
  flex: 0 0 180px;
}

.count {
  flex: 0 0 80px;
}

.symbols {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 8px;
}
</style>
