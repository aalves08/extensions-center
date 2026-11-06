<script setup lang="ts">
import { computed } from 'vue';
import SortableTable from '@shell/components/SortableTable/index.vue';

import { TableHeader } from '../types/table';
import { BumpReach, ExtensionImpact, VersionSkew } from '../utils/bumpImpact';
import { useTranslation } from '../utils/i18n';

/**
 * One bumped package, and what it does to every official extension.
 *
 * The column that carries the answer is `reach`, and it has four values rather
 * than two on purpose — "already running it", "only after a rebuild", "not
 * affected" and "we cannot say" are four different pieces of news. The fourth
 * is the one the rest of the table exists to explain: the sub-row names which
 * document is missing or out of date, and the action on the right is the fix.
 *
 * Nothing here reranks or hides a row. A row the model later calls harmless
 * still shows every version and every gap it showed before, because the model
 * is annotating this table rather than deciding it.
 */

/** Worst first, and the same order `assessBumps` sorted the rows into. */
const REACH_ORDER: Record<BumpReach, number> = {
  runtime: 0, unknown: 1, rebuild: 2, none: 3,
};

/** Biggest gap first. `mixed` outranks a single major gap: it contains one. */
const SKEW_ORDER: Record<VersionSkew, number> = {
  mixed:          0,
  'behind-major': 1,
  'behind-minor': 2,
  ahead:          3,
  aligned:        4,
  unknown:        5,
};

const t = useTranslation();

const props = defineProps<{
  rows: ExtensionImpact[];
  /** Name of the extension currently being re-analysed, if any */
  refreshing: string | null;
}>();

const emit = defineEmits<{(e: 'refresh', ext: string): void }>();

const headers = computed<TableHeader[]>(() => [
  {
    name: 'ext', labelKey: 'extensionsCenter.bumpImpact.cols.extension', value: 'ext', sort: ['ext']
  },
  {
    name: 'reach', labelKey: 'extensionsCenter.bumpImpact.cols.reach', value: 'reachOrder', sort: ['reachOrder', 'ext']
  },
  {
    name: 'pinned', labelKey: 'extensionsCenter.bumpImpact.cols.pinned', value: 'pinnedLabel', sort: ['pinnedLabel']
  },
  {
    name: 'skew', labelKey: 'extensionsCenter.bumpImpact.cols.skew', value: 'skewOrder', sort: ['skewOrder', 'ext']
  },
  {
    name: 'evidence', labelKey: 'extensionsCenter.bumpImpact.cols.evidence', sort: false
  },
  {
    name: 'analysed', labelKey: 'extensionsCenter.bumpImpact.cols.analysed', value: 'analysedLabel', sort: ['analysedLabel']
  },
  {
    name: 'actions', labelKey: 'extensionsCenter.bumpImpact.cols.actions', sort: false, align: 'right'
  },
]);

const tableRows = computed(() => props.rows.map((row) => ({
  ...row,
  reachOrder:    REACH_ORDER[row.reach],
  skewOrder:     SKEW_ORDER[row.skew],
  pinnedLabel:   row.pinned.join(', '),
  // The inventory's reading is the one the lockfile column came from, so it is
  // the one shown beside it. The other two are in the sub-row, where a
  // disagreement between them is worth the space it takes to show.
  analysedLabel: row.analysed.inventory || row.analysed.imports || row.analysed.bundles || '',
})));

/**
 * Every version the three documents read, deduplicated.
 *
 * Shown as a set rather than three labelled lines because they agree in the
 * ordinary case, and three identical version strings down a sub-row teaches a
 * reader to stop looking at them — which is exactly when disagreeing ones stop
 * being noticed.
 */
function analysedVersions(row: ExtensionImpact): string[] {
  return [...new Set([row.analysed.inventory, row.analysed.imports, row.analysed.bundles].filter((v): v is string => !!v))];
}
</script>

<template>
  <SortableTable
    :headers="headers"
    :rows="tableRows"
    key-field="ext"
    :table-actions="false"
    :row-actions="false"
    :search="false"
    :paging="false"
    :sub-rows="true"
    :sub-expandable="true"
    :sub-expand-column="true"
    :sub-rows-description="false"
    no-rows-key="extensionsCenter.bumpImpact.noRows"
    default-sort-by="reach"
  >
    <template #cell:ext="{ row }">
      <span class="ext">{{ row.ext }}</span>
    </template>

    <!--
      The word as well as the colour, for the same reason the severity badges
      carry theirs: "unknown" has to read as "we could not confirm this", and
      no colour on its own says that.
    -->
    <template #cell:reach="{ row }">
      <span
        v-clean-tooltip="t(`extensionsCenter.bumpImpact.reachNote.${ row.reach }`)"
        class="badge"
        :class="`reach-${ row.reach }`"
      >{{ t(`extensionsCenter.bumpImpact.reach.${ row.reach }`) }}</span>
    </template>

    <template #cell:pinned="{ row }">
      <code v-if="row.pinnedLabel">{{ row.pinnedLabel }}</code>
      <span
        v-else
        class="text-muted"
      >{{ t('extensionsCenter.common.na') }}</span>
    </template>

    <template #cell:skew="{ row }">
      <span
        class="skew"
        :class="`skew-${ row.skew }`"
      >{{ t(`extensionsCenter.bumpImpact.skew.${ row.skew }`) }}</span>
    </template>

    <!--
      Two independent pieces of evidence, shown separately rather than summed.
      Source that imports the package and a bundle that carries it mean
      different things, and an extension can have either without the other.
    -->
    <template #cell:evidence="{ row }">
      <span class="evidence">
        <span
          v-if="row.importsIt"
          class="tag"
        >{{ t('extensionsCenter.bumpImpact.evidence.imports') }}</span>
        <span
          v-if="row.bundledCause"
          v-clean-tooltip="t(`extensionsCenter.bundleAnalysis.cause.${ row.bundledCause }`)"
          class="tag"
        >{{ t('extensionsCenter.bumpImpact.evidence.bundled') }}</span>
        <span
          v-if="!row.importsIt && !row.bundledCause && row.pinned.length"
          class="tag"
        >{{ t('extensionsCenter.bumpImpact.evidence.lockfileOnly') }}</span>
        <span
          v-if="!row.importsIt && !row.bundledCause && !row.pinned.length"
          class="text-muted"
        >{{ t('extensionsCenter.common.na') }}</span>
      </span>
    </template>

    <!--
      The version read, and — once a check has run — the version that is
      actually published. Before a check there is only one number and no claim
      is made about it; "not checked" is said rather than implied by its
      absence.

      Both carry the full explanation on hover rather than leaving it to the
      sub-row. This is the cell a reader looks at to decide whether to trust
      the reach badge beside it, and the rule that a stale reading can never
      produce "not affected" should not need an expand to find.
    -->
    <template #cell:analysed="{ row }">
      <span class="versions">
        <code :class="{ stale: row.stale }">{{ row.analysedLabel || t('extensionsCenter.common.na') }}</code>
        <span
          v-if="row.stale"
          v-clean-tooltip="t('extensionsCenter.bumpImpact.staleTooltip')"
          class="text-muted now"
        >{{ t('extensionsCenter.bumpImpact.nowAt', { version: row.current }) }}</span>
        <span
          v-else-if="!row.current"
          v-clean-tooltip="t('extensionsCenter.bumpImpact.uncheckedTooltip')"
          class="text-muted now"
        >{{ t('extensionsCenter.bumpImpact.unchecked') }}</span>
      </span>
    </template>

    <!--
      Offered only on a stale row. A re-analysis costs a lockfile, a full
      source scan and a source-map download for that one extension, which is
      worth paying to turn an "unknown" into an answer and is not worth
      offering beside a row that is already current.

      A plain button rather than an AsyncButton: the work runs in the page, not
      here, so this has no completion to report — and a button that flashed
      "Done" while the page was still downloading source maps would be lying
      about the one thing it is for.
    -->
    <template #cell:actions="{ row }">
      <button
        v-if="row.stale"
        type="button"
        class="btn btn-sm role-secondary"
        :disabled="!!refreshing"
        @click="emit('refresh', row.ext)"
      >
        {{ refreshing === row.ext
          ? t('extensionsCenter.bumpImpact.reanalyse.waiting')
          : t('extensionsCenter.bumpImpact.reanalyse.action') }}
      </button>
    </template>

    <template #sub-row="{ row, fullColspan }">
      <tr class="sub-row">
        <td :colspan="fullColspan">
          <div class="detail">
            <p class="text-muted">
              {{ t('extensionsCenter.bumpImpact.detail.readAt', {
                repo: row.repo,
                versions: analysedVersions(row).join(', ') || t('extensionsCenter.common.na'),
              }) }}
            </p>

            <!--
              A branch read is not a release. It is the best available answer
              for an extension that has never tagged one, and it ages the
              moment someone pushes — so it says so rather than sitting in the
              version column looking like a tag.
            -->
            <p
              v-if="row.source === 'branch'"
              class="text-muted"
            >
              {{ t('extensionsCenter.bumpImpact.detail.fromBranch') }}
            </p>

            <ul
              v-if="row.gaps.length"
              class="gaps"
            >
              <li
                v-for="gap in row.gaps"
                :key="gap"
              >
                <strong>{{ t(`extensionsCenter.bumpImpact.gap.${ gap }`) }}</strong>
                <span class="text-muted">{{ t(`extensionsCenter.bumpImpact.gapNote.${ gap }`) }}</span>
              </li>
            </ul>

            <p
              v-else
              class="text-muted"
            >
              {{ t('extensionsCenter.bumpImpact.detail.noGaps') }}
            </p>
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

.badge {
  border-radius: 10px;
  display: inline-block;
  font-size: 11px;
  font-weight: 600;
  padding: 1px 8px;
  text-transform: uppercase;
  white-space: nowrap;
}

// Reach is not severity, but it is the same kind of scale, so it reuses the
// same palette rather than introducing a second one on a page that already
// links to the security and bundle views.
//
// `unknown` deliberately gets the neutral grey and not a reassuring one: it
// sorts above `rebuild` because it is work somebody has to do, and a green
// badge would undo that the moment anyone scanned the column.
.badge.reach-runtime {
  background: $critical-color;
  color: $on-severity;
}

.badge.reach-rebuild {
  background: $medium-color;
  color: $on-severity;
}

.badge.reach-unknown {
  background: $na-color;
  color: $low-na-text;
}

.badge.reach-none {
  background: $zero-color-light;
  color: var(--disabled-text);

  body.theme-dark & {
    background: $zero-color-dark;
  }
}

.skew {
  font-size: 12px;
}

.skew-behind-major,
.skew-mixed {
  color: $critical-color;
  font-weight: 600;
}

.skew-behind-minor {
  color: $medium-color;
}

.skew-aligned,
.skew-ahead,
.skew-unknown {
  color: var(--muted);
}

.evidence {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 4px;
}

.tag {
  background: var(--box-bg);
  border: 1px solid var(--border);
  border-radius: var(--border-radius);
  font-size: 11px;
  padding: 0 6px;
  white-space: nowrap;
}

.versions {
  align-items: baseline;
  display: inline-flex;
  flex-wrap: wrap;
  gap: 6px;

  code.stale {
    color: $critical-color;
  }

  .now {
    font-size: 11px;
  }
}

.detail {
  padding: 8px 0 8px 32px;

  p {
    font-size: 12px;
    margin: 0 0 4px;
  }
}

.gaps {
  font-size: 12px;
  list-style: none;
  margin: 8px 0 0;
  padding: 0;

  li {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  li + li {
    margin-top: 4px;
  }
}
</style>
