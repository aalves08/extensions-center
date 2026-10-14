<script lang="ts">
import { defineComponent, PropType } from 'vue';
import SortableTable from '@shell/components/SortableTable/index.vue';

import { TableHeader } from '../types/table';
import { prettyBytes } from '../utils/bytes';
import { RangeVerdict } from '../utils/semverRange';
import { severityRank } from '../utils/severity';
import { ReachRow } from '../utils/vulnReach';
import { i18nMixin } from '../utils/i18n';

/**
 * Vulnerable packages ranked by whether they actually reach a browser.
 *
 * Every other view on this page is organised by repository, which is how the
 * advisories arrive and not how the risk is distributed. A package is in this
 * table once, with the list of published bundles that carry it underneath —
 * so one row is one bump, and its position is set by exposure rather than by
 * which repo happened to file the alert.
 */

/** Sort key for the verdict column; most alarming first. */
const VERDICT_ORDER: Record<RangeVerdict, number> = {
  hit: 0, partial: 1, unknown: 2, miss: 3,
};

export default defineComponent({
  name: 'ReachTable',

  mixins: [i18nMixin],

  components: { SortableTable },

  props: {
    rows: {
      type:     Array as PropType<ReachRow[]>,
      required: true,
    },
  },

  computed: {
    headers(): TableHeader[] {
      return [
        {
          name: 'pkg', labelKey: 'extensionsCenter.security.cols.package', value: 'pkg', sort: ['pkg']
        },
        {
          name: 'verdict', labelKey: 'extensionsCenter.security.cols.reach', value: 'verdictOrder', sort: ['verdictOrder', 'severityOrder']
        },
        {
          name: 'worstSeverity', labelKey: 'extensionsCenter.security.cols.severity', value: 'severityOrder', sort: ['severityOrder', 'pkg']
        },
        {
          name: 'advisories', labelKey: 'extensionsCenter.security.cols.advisories', value: 'advisoryCount', align: 'right', sort: ['advisoryCount']
        },
        {
          name: 'shipped', labelKey: 'extensionsCenter.security.cols.inBundles', value: 'shippedCount', align: 'right', sort: ['shippedCount']
        },
        {
          name: 'shippedBytes', labelKey: 'extensionsCenter.security.cols.shippedBytes', value: 'shippedBytesSort', align: 'right', sort: ['shippedBytesSort']
        },
        {
          name: 'repos', labelKey: 'extensionsCenter.security.cols.flaggedBy', value: 'repoCount', align: 'right', sort: ['repoCount']
        },
      ];
    },

    tableRows() {
      return this.rows.map((row) => ({
        ...row,
        severityOrder:    severityRank(row.worstSeverity),
        verdictOrder:     VERDICT_ORDER[row.verdict],
        advisoryCount:    row.advisories.length,
        shippedCount:     row.shipped.length,
        repoCount:        row.repos.length,
        // Unmeasured sorts to the bottom rather than to zero, so "we could not
        // size this" does not read as "this is tiny".
        shippedBytesSort: row.shippedBytes ?? -1,
      }));
    },
  },

  methods: { prettyBytes },
});
</script>

<template>
  <SortableTable
    :headers="headers"
    :rows="tableRows"
    key-field="pkg"
    :table-actions="false"
    :row-actions="false"
    :paging="true"
    :sub-rows="true"
    :sub-expandable="true"
    :sub-expand-column="true"
    :sub-rows-description="false"
    no-rows-key="extensionsCenter.security.reach.empty"
    default-sort-by="verdict"
  >
    <template #cell:pkg="{ row }">
      <span class="pkg">{{ row.pkg }}</span>
    </template>

    <!--
      The verdict carries its own word as well as its colour, like every
      severity badge on this page: `unknown` in particular has to read as "we
      could not confirm the version", which no colour conveys on its own.
    -->
    <template #cell:verdict="{ row }">
      <span
        class="badge"
        :class="`reach-${ row.verdict }`"
      >{{ t(`extensionsCenter.security.reach.verdict.${ row.verdict }`) }}</span>
    </template>

    <template #cell:worstSeverity="{ row }">
      <span
        class="badge"
        :class="`sev-${ row.worstSeverity }`"
      >{{ t(`extensionsCenter.security.severity.${ row.worstSeverity }`) }}</span>
    </template>

    <template #cell:shippedBytes="{ row }">
      <span v-if="row.shippedBytes !== null">{{ prettyBytes(row.shippedBytes) }}</span>
      <span
        v-else
        class="text-muted"
      >{{ t('extensionsCenter.common.na') }}</span>
    </template>

    <template #cell:repos="{ row }">
      <span :title="row.repos.map((r) => r.label).join('\n')">{{ row.repoCount }}</span>
    </template>

    <template #sub-row="{ row, fullColspan }">
      <tr class="sub-row">
        <td :colspan="fullColspan">
          <div class="detail">
            <p
              v-if="!row.shipped.length"
              class="text-muted"
            >
              {{ t('extensionsCenter.security.reach.notShippedNote') }}
            </p>

            <ul
              v-else
              class="hits"
            >
              <li
                v-for="hit in row.shipped"
                :key="hit.ext"
              >
                <span
                  class="badge"
                  :class="`reach-${ hit.verdict }`"
                >{{ t(`extensionsCenter.security.reach.verdict.${ hit.verdict }`) }}</span>
                <strong>{{ hit.ext }}</strong>
                <span class="text-muted">{{ hit.semver }}</span>
                <span class="text-muted">
                  {{ t(`extensionsCenter.bundleAnalysis.cause.${ hit.cause }`) }}
                </span>
                <span v-if="hit.versions.length">
                  {{ t('extensionsCenter.security.reach.resolved', { value: hit.versions.join(', ') }) }}
                </span>
                <span
                  v-else
                  class="text-muted"
                >{{ t('extensionsCenter.security.reach.noLockfile') }}</span>
                <span class="bytes">
                  {{ hit.diskBytes === null ? t('extensionsCenter.common.na') : prettyBytes(hit.diskBytes) }}
                </span>
              </li>
            </ul>

            <ul class="advisories">
              <li
                v-for="advisory in row.advisories"
                :key="advisory.id"
              >
                <span
                  class="badge"
                  :class="`sev-${ advisory.severity }`"
                >{{ t(`extensionsCenter.security.severity.${ advisory.severity }`) }}</span>
                <a
                  :href="advisory.url"
                  target="_blank"
                  rel="noopener noreferrer"
                >{{ advisory.ghsa }}</a>
                <span class="summary">{{ advisory.summary }}</span>
                <span
                  v-if="advisory.vulnerableRange"
                  class="text-muted"
                >
                  {{ t('extensionsCenter.security.detail.range', { value: advisory.vulnerableRange }) }}
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
@import '../styles/severity';

.pkg {
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

  @include severity-fill('sev-');
}

// Reach is not severity and must not borrow its palette wholesale — a package
// that ships is not "critical", it is confirmed. It does share the scale's
// logic, though, so the two confirmed states reuse the severity reds and the
// unconfirmed one reuses the neutral grey, which keeps one visual language on
// the page instead of two.
.badge.reach-hit {
  background: $critical-color;
  color: $on-severity;
}

.badge.reach-partial {
  background: $high-color;
  color: $on-severity;
}

.badge.reach-unknown {
  background: $na-color;
  color: $low-na-text;
}

.badge.reach-miss {
  background: $zero-color-light;
  color: var(--disabled-text);

  body.theme-dark & {
    background: $zero-color-dark;
  }
}

.detail {
  padding: 8px 0 8px 32px;
}

.hits,
.advisories {
  list-style: none;
  margin: 0;
  padding: 0;

  li {
    align-items: center;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  li + li {
    margin-top: 6px;
  }
}

.advisories {
  border-top: 1px solid var(--border);
  font-size: 12px;
  margin-top: 8px;
  padding-top: 8px;
}

.hits .bytes {
  margin-left: auto;
}

.summary {
  min-width: 0;
}
</style>
