<script lang="ts">
import { defineComponent, PropType } from 'vue';
import SortableTable from '@shell/components/SortableTable/index.vue';

import { PackageGroup, VulnSource } from '../types/security';
import { TableHeader } from '../types/table';
import { severityRank } from '../utils/severity';

/**
 * A repo's vulnerable packages, expandable to the advisories behind each one.
 *
 * One row per package rather than per advisory: `js-yaml` raising six
 * advisories across three lockfiles is one bump, not six pieces of work.
 */
export default defineComponent({
  name: 'SecurityTable',

  components: { SortableTable },

  props: {
    rows: {
      type:     Array as PropType<PackageGroup[]>,
      required: true,
    },

    /** Decides which columns are meaningful — see `headers` */
    source: {
      type:     String as PropType<VulnSource>,
      required: true,
    },

    loading: {
      type:    Boolean,
      default: false,
    },
  },

  computed: {
    headers(): TableHeader[] {
      const headers: TableHeader[] = [
        {
          name: 'name', labelKey: 'extensionsCenter.security.cols.package', value: 'name', sort: ['name']
        },
        {
          name: 'worstSeverity', labelKey: 'extensionsCenter.security.cols.severity', value: 'severityOrder', sort: ['severityOrder', 'name']
        },
        {
          name: 'count', labelKey: 'extensionsCenter.security.cols.advisories', value: 'count', align: 'right', sort: ['count']
        },
      ];

      // An SBOM says what is installed, not which lockfile asked for it, and
      // carries no runtime/development split. Rendering those columns empty
      // for every row would imply we looked and found nothing.
      if (this.source === 'dependabot') {
        headers.push({
          name: 'manifests', labelKey: 'extensionsCenter.security.cols.manifests', value: 'manifestCount', align: 'right', sort: ['manifestCount']
        });
      }

      headers.push({
        name: 'patchedVersion', labelKey: 'extensionsCenter.security.cols.patched', value: 'patchedVersion', sort: ['patchedVersion']
      });

      if (this.source === 'dependabot') {
        headers.push(
          {
            name: 'scope', labelKey: 'extensionsCenter.security.cols.scope', value: 'scope', sort: ['scope']
          },
          {
            name: 'oldest', labelKey: 'extensionsCenter.security.cols.oldest', value: 'oldest', sort: ['oldest']
          },
        );
      }

      return headers;
    },

    /**
     * Rows with the fields SortableTable needs to sort on.
     *
     * `severityOrder` exists because sorting on the severity *word* puts
     * critical after high alphabetically, which is exactly backwards.
     */
    tableRows(): (PackageGroup & { severityOrder: number; count: number; manifestCount: number })[] {
      return this.rows.map((row) => ({
        ...row,
        severityOrder: severityRank(row.worstSeverity),
        count:         row.advisories.length,
        manifestCount: row.manifests.length,
      }));
    },
  },

  methods: {
    shortDate(iso: string | null): string {
      return iso ? new Date(iso).toLocaleDateString() : this.t('extensionsCenter.common.na');
    },
  },
});
</script>

<template>
  <SortableTable
    :headers="headers"
    :rows="tableRows"
    :loading="loading"
    key-field="id"
    :table-actions="false"
    :row-actions="false"
    :paging="true"
    :sub-rows="true"
    :sub-expandable="true"
    :sub-expand-column="true"
    :sub-rows-description="false"
    no-rows-key="extensionsCenter.security.empty"
    default-sort-by="worstSeverity"
  >
    <template #cell:name="{ row }">
      <span class="pkg">{{ row.name }}</span>
      <span class="text-muted ecosystem">{{ row.ecosystem }}</span>
    </template>

    <template #cell:worstSeverity="{ row }">
      <span
        class="badge"
        :class="`sev-${ row.worstSeverity }`"
      >{{ t(`extensionsCenter.security.severity.${ row.worstSeverity }`) }}</span>
    </template>

    <!--
      A count, not the paths. One package can be declared by a dozen chart
      versions, and printing every `extensions/<name>/<version>/plugin/package.json`
      pushed every other column off the row. The paths are still there, one per
      advisory, when the row is expanded.
    -->
    <template #cell:manifests="{ row }">
      <span :title="row.manifests.join('\n')">{{ row.manifestCount }}</span>
    </template>

    <template #cell:patchedVersion="{ row }">
      <span v-if="row.patchedVersion">{{ row.patchedVersion }}</span>
      <!--
        `text-error`, not `text-warning`: `--warning` is the pale amber meant to
        sit behind a badge, and as small text on the light theme it is barely
        readable. `--error` is a text-grade token that holds up on both themes,
        and shell uses it this exact way for a bad state in a table cell.
      -->
      <span
        v-else
        class="text-error"
      >{{ t('extensionsCenter.security.noPatch') }}</span>
    </template>

    <template #cell:scope="{ row }">
      {{ row.scope ? t(`extensionsCenter.security.scope.${ row.scope }`) : t('extensionsCenter.common.na') }}
    </template>

    <template #cell:oldest="{ row }">
      {{ shortDate(row.oldest) }}
    </template>

    <template #sub-row="{ row, fullColspan }">
      <tr class="sub-row">
        <td :colspan="fullColspan">
          <ul class="advisories">
            <li
              v-for="advisory in row.advisories"
              :key="advisory.id"
            >
              <div class="line">
                <span
                  class="badge"
                  :class="`sev-${ advisory.severity }`"
                >{{ t(`extensionsCenter.security.severity.${ advisory.severity }`) }}</span>
                <a
                  :href="advisory.url"
                  target="_blank"
                  rel="noopener noreferrer"
                >{{ advisory.ghsa }}</a>
                <span
                  v-if="advisory.cve"
                  class="text-muted"
                >{{ advisory.cve }}</span>
                <span class="summary">{{ advisory.summary }}</span>
              </div>
              <div class="meta text-muted">
                <span v-if="advisory.vulnerableRange">
                  {{ t('extensionsCenter.security.detail.range', { value: advisory.vulnerableRange }) }}
                </span>
                <span v-if="advisory.patchedVersion">
                  {{ t('extensionsCenter.security.detail.patched', { value: advisory.patchedVersion }) }}
                </span>
                <span v-if="advisory.manifest">{{ advisory.manifest }}</span>
                <span v-if="advisory.relationship">
                  {{ t(`extensionsCenter.security.relationship.${ advisory.relationship }`) }}
                </span>
                <span v-if="advisory.createdAt">{{ shortDate(advisory.createdAt) }}</span>
              </div>
            </li>
          </ul>
        </td>
      </tr>
    </template>
  </SortableTable>
</template>

<style lang="scss" scoped>
.pkg {
  font-weight: 600;
}

.ecosystem {
  font-size: 11px;
  margin-left: 6px;
}

// Severity is never colour alone — the badge always carries its own word, so
// the table stays readable in greyscale and to a colourblind reader.
.badge {
  border-radius: 10px;
  display: inline-block;
  font-size: 11px;
  font-weight: 600;
  padding: 1px 8px;
  text-transform: uppercase;
  white-space: nowrap;

  &.sev-critical { background: var(--error); color: var(--error-text, #fff); }
  &.sev-high { background: var(--warning); color: var(--body-bg); }
  &.sev-medium { background: var(--info); color: var(--body-bg); }
  &.sev-low { background: var(--muted); color: var(--body-bg); }
}

.advisories {
  list-style: none;
  margin: 0;
  padding: 8px 0 8px 32px;

  li + li {
    border-top: 1px solid var(--border);
    margin-top: 8px;
    padding-top: 8px;
  }

  .line {
    align-items: center;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .summary {
    min-width: 0;
  }

  .meta {
    display: flex;
    flex-wrap: wrap;
    font-size: 12px;
    gap: 12px;
    margin-top: 2px;
  }
}
</style>
