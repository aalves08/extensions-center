<script setup lang="ts">
import { computed } from 'vue';
import SortableTable from '@shell/components/SortableTable/index.vue';

import { ShellUpgradeRow } from '../types/security';
import { TableHeader } from '../types/table';
import { useTranslation } from '../utils/i18n';

/**
 * What a shell bump would buy each extension.
 *
 * One row per extension rather than per advisory, because the decision is per
 * extension: a maintainer either takes the newer `@rancher/shell` or does not,
 * and the findings it clears are the argument for doing so, not separate
 * pieces of work.
 *
 * The count is a floor and the table says so rather than relying on the reader
 * to remember it — see the header of `utils/shellUpgrade.ts`.
 */

const props = defineProps<{
  rows: ShellUpgradeRow[];
  /** The version every row is measured against, for the removed/cleared wording */
  target: string;
  loading?: boolean;
}>();

const t = useTranslation();

/** Where GitHub publishes an advisory, which is stable from the GHSA id alone. */
const GHSA_BASE = 'https://github.com/advisories/';

const headers = computed<TableHeader[]>(() => [
  {
    name: 'name', labelKey: 'extensionsCenter.security.shellUpgrade.cols.extension', value: 'name', sort: ['name']
  },
  {
    name: 'shipped', labelKey: 'extensionsCenter.security.shellUpgrade.cols.shipped', value: 'shippedShell', sort: ['shippedShell', 'name']
  },
  {
    name: 'cleared', labelKey: 'extensionsCenter.security.shellUpgrade.cols.cleared', value: 'clearedCount', align: 'right', sort: ['clearedCount']
  },
  {
    name: 'removed', labelKey: 'extensionsCenter.security.shellUpgrade.cols.removed', value: 'removedCount', align: 'right', sort: ['removedCount']
  },
]);

/**
 * Counts hoisted for sorting, like every other table on this page.
 *
 * `key` rather than the name: two extensions can be published from one repo,
 * and one repo can appear twice in the manifest under different names, so the
 * pair is what is actually unique.
 */
const tableRows = computed(() => props.rows.map((row) => ({
  ...row,
  key:          `${ row.repo }@${ row.name }`,
  clearedCount: row.cleared.length,
  removedCount: row.removed.length,
})));

function ghsaUrl(ghsa: string): string {
  return `${ GHSA_BASE }${ encodeURIComponent(ghsa) }`;
}

/** How the target clears one finding, in words: removed outright, or repinned. */
function howLabel(how: string, version: string | null): string {
  if (how === 'removed') {
    return t('extensionsCenter.security.shellUpgrade.how.removed', { target: props.target });
  }

  return t('extensionsCenter.security.shellUpgrade.how.repinned', { version: version || '' });
}
</script>

<template>
  <SortableTable
    :headers="headers"
    :rows="tableRows"
    :loading="loading"
    key-field="key"
    :table-actions="false"
    :row-actions="false"
    :paging="false"
    :sub-rows="true"
    :sub-expandable="true"
    :sub-expand-column="true"
    :sub-rows-description="false"
    no-rows-key="extensionsCenter.security.shellUpgrade.empty"
    default-sort-by="cleared"
  >
    <template #cell:name="{ row }">
      <span class="ext">{{ row.name }}</span>
      <span class="text-muted tag">{{ row.tag }}</span>
    </template>

    <!--
      Three different states, and none of them may be confused for another:
      a version read out of a lockfile, the target version already shipped,
      and a release whose lockfile could not be read at all. The last one
      names its reason — a guessed version here would be advice to upgrade
      from somewhere the extension may not be.
    -->
    <template #cell:shipped="{ row }">
      <template v-if="row.shippedShell">
        <span
          class="mono"
          :title="row.lockfile"
        >{{ row.shippedShell }}</span>
        <span
          v-if="row.current"
          class="text-muted current"
        >{{ t('extensionsCenter.security.shellUpgrade.current') }}</span>
      </template>

      <span
        v-else
        class="text-muted"
        :title="t(`extensionsCenter.security.shellUpgrade.unknown.${ row.unknownReason || 'unreadable' }`)"
      >
        {{ t('extensionsCenter.security.shellUpgrade.unknownShort') }}
      </span>
    </template>

    <!--
      "at least", on every non-zero count. Shell pins its direct dependencies
      only, so anything a bump clears deeper in the tree is not visible here
      and the honest figure is a floor.
    -->
    <template #cell:cleared="{ row }">
      <span v-if="row.clearedCount">
        {{ t('extensionsCenter.security.shellUpgrade.atLeast', { count: row.clearedCount }) }}
      </span>
      <span
        v-else
        class="text-muted"
      >0</span>
    </template>

    <template #cell:removed="{ row }">
      <span :class="{ 'text-muted': !row.removedCount }">{{ row.removedCount }}</span>
    </template>

    <template #sub-row="{ row, fullColspan }">
      <tr class="sub-row">
        <td :colspan="fullColspan">
          <div class="detail">
            <p
              v-if="!row.shippedShell"
              class="text-muted"
            >
              {{ t(`extensionsCenter.security.shellUpgrade.unknown.${ row.unknownReason || 'unreadable' }`) }}
            </p>

            <p
              v-else-if="row.current"
              class="text-muted"
            >
              {{ t('extensionsCenter.security.shellUpgrade.currentNote', { version: target }) }}
            </p>

            <template v-else>
              <p class="text-muted source">
                {{ t('extensionsCenter.security.shellUpgrade.source', { lockfile: row.lockfile, from: row.shippedShell, to: target }) }}
              </p>

              <ul
                v-if="row.cleared.length"
                class="cleared"
              >
                <li
                  v-for="fix in row.cleared"
                  :key="`${ fix.ghsa }-${ fix.packageName }`"
                >
                  <span
                    class="badge"
                    :class="`sev-${ fix.severity }`"
                  >{{ t(`extensionsCenter.security.severity.${ fix.severity }`) }}</span>
                  <strong>{{ fix.packageName }}</strong>
                  <a
                    :href="ghsaUrl(fix.ghsa)"
                    class="ident"
                    target="_blank"
                    rel="noopener noreferrer"
                  >{{ fix.ghsa }}</a>
                  <span
                    v-if="fix.cve"
                    class="ident text-muted"
                  >{{ fix.cve }}</span>
                  <span class="text-muted">{{ howLabel(fix.how, fix.targetVersion) }}</span>
                </li>
              </ul>

              <p
                v-else
                class="text-muted"
              >
                {{ t('extensionsCenter.security.shellUpgrade.noneCleared') }}
              </p>

              <!--
                The dropped dependencies in full rather than as a number: this
                is the part a maintainer checks against their own code, since
                a package shell no longer carries is one they may have been
                relying on arriving for free.
              -->
              <div
                v-if="row.removed.length"
                class="removed"
              >
                <span class="text-muted">{{ t('extensionsCenter.security.shellUpgrade.removedTitle', { count: row.removed.length }) }}</span>
                <code>{{ row.removed.join(', ') }}</code>
              </div>
            </template>
          </div>
        </td>
      </tr>
    </template>
  </SortableTable>
</template>

<style lang="scss" scoped>
@import '../styles/severity';

.ext {
  font-weight: 600;
}

.tag,
.current {
  font-size: 11px;
  margin-left: 6px;
}

.mono {
  font-family: monospace;
}

.badge {
  border-radius: 10px;
  display: inline-block;
  font-size: 11px;
  font-weight: 600;
  padding: 1px 8px;
  text-transform: uppercase;
  white-space: nowrap;

  @include severity-fill('sev-');
}

.detail {
  padding: 8px 0 8px 32px;
}

.source {
  margin: 0 0 8px;
}

// Identifiers never wrap: a GHSA id broken across two lines stops being
// recognisable as one.
.ident {
  font-family: monospace;
  font-size: 12px;
  white-space: nowrap;
}

.cleared {
  list-style: none;
  margin: 0;
  padding: 0;

  li {
    align-items: center;
    display: flex;
    flex-wrap: wrap;
    font-size: 12px;
    gap: 8px;
  }

  li + li {
    margin-top: 6px;
  }
}

.removed {
  border-top: 1px solid var(--border);
  font-size: 12px;
  margin-top: 8px;
  padding-top: 8px;

  code {
    display: block;
    margin-top: 4px;
    max-width: 120ch;
  }
}
</style>
