<script lang="ts">
import { defineComponent, PropType } from 'vue';
import SortableTable from '@shell/components/SortableTable/index.vue';

import { Advisory, PackageGroup, VulnSource } from '../types/security';
import { TableHeader } from '../types/table';
import { severityRank } from '../utils/severity';
import { i18nMixin } from '../utils/i18n';

/** One label/value pair in an expanded advisory. */
interface DetailField {
  key: string;
  label: string;
  value: string;
  /** Identifiers and paths are read character by character, so they get a mono face */
  mono?: boolean;
}

/**
 * Where a CVE is actually documented.
 *
 * GitHub's advisory page is already one click away through the GHSA link
 * beside it; the NVD entry is the one that carries the CVSS vector, the CPE
 * list and the upstream references, which is what someone clicking a CVE id is
 * after.
 */
const NVD_BASE = 'https://nvd.nist.gov/vuln/detail/';

/**
 * A repo's vulnerable packages, expandable to the advisories behind each one.
 *
 * One row per package rather than per advisory: `js-yaml` raising six
 * advisories across three lockfiles is one bump, not six pieces of work.
 */
export default defineComponent({
  name: 'SecurityTable',

  mixins: [i18nMixin],

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

    cveUrl(cve: string): string {
      return `${ NVD_BASE }${ encodeURIComponent(cve) }`;
    },

    /**
     * The rows of an expanded advisory's field grid.
     *
     * Built here rather than as five `v-if` spans in the template so the grid
     * never has a gap in it: a public-data advisory carries no manifest, no
     * scope and no relationship, and an empty label beside an empty value
     * reads as missing data rather than as data that does not exist.
     */
    fields(advisory: Advisory): DetailField[] {
      const out: DetailField[] = [];
      const label = (key: string) => this.t(`extensionsCenter.security.detail.${ key }`);

      if (advisory.vulnerableRange) {
        out.push({
          key: 'vulnerable', label: label('vulnerable'), value: advisory.vulnerableRange, mono: true
        });
      }

      if (advisory.manifest) {
        out.push({
          key: 'manifest', label: label('manifest'), value: advisory.manifest, mono: true
        });
      }

      if (advisory.relationship) {
        out.push({
          key:   'relationship',
          label: label('relationship'),
          value: this.t(`extensionsCenter.security.relationship.${ advisory.relationship }`),
        });
      }

      if (advisory.scope) {
        out.push({
          key:   'scope',
          label: label('scope'),
          value: this.t(`extensionsCenter.security.scope.${ advisory.scope }`),
        });
      }

      if (advisory.createdAt) {
        out.push({
          key: 'reported', label: label('reported'), value: this.shortDate(advisory.createdAt)
        });
      }

      return out;
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

    <!--
      One block per advisory, in three bands: who it is (severity + the two
      identifiers + whether a fix exists), what it is (the summary, in normal
      ink), and the particulars (a label/value grid).

      The old version ran all of that together as one wrapping line plus a row
      of muted spans, which left a bare semver range sitting next to a bare
      file path with nothing saying which was which.
    -->
    <template #sub-row="{ row, fullColspan }">
      <tr class="sub-row">
        <td :colspan="fullColspan">
          <div class="advisories">
            <div
              v-for="advisory in row.advisories"
              :key="advisory.id"
              class="advisory"
            >
              <div class="head">
                <span
                  class="badge"
                  :class="`sev-${ advisory.severity }`"
                >{{ t(`extensionsCenter.security.severity.${ advisory.severity }`) }}</span>

                <a
                  class="ident"
                  :href="advisory.url"
                  :title="t('extensionsCenter.security.detail.ghsaLink', { value: advisory.ghsa })"
                  target="_blank"
                  rel="noopener noreferrer"
                >{{ advisory.ghsa }}</a>

                <!--
                  The CVE is the id people paste into a ticket or a compliance
                  tool, so it has to be reachable rather than selectable.
                -->
                <a
                  v-if="advisory.cve"
                  class="ident"
                  :href="cveUrl(advisory.cve)"
                  :title="t('extensionsCenter.security.detail.cveLink', { value: advisory.cve })"
                  target="_blank"
                  rel="noopener noreferrer"
                >{{ advisory.cve }}</a>

                <!--
                  Glyph plus words, never the glyph alone: this is the one fact
                  that decides whether the row is actionable today.
                -->
                <span
                  class="fix"
                  :class="{ 'no-fix': !advisory.patchedVersion }"
                >
                  <i
                    class="icon"
                    :class="advisory.patchedVersion ? 'icon-confirmation-alt' : 'icon-notify-error'"
                  />
                  <span v-if="advisory.patchedVersion">
                    {{ t('extensionsCenter.security.detail.fixedIn', { value: advisory.patchedVersion }) }}
                  </span>
                  <span v-else>{{ t('extensionsCenter.security.detail.noFix') }}</span>
                </span>
              </div>

              <p class="summary">
                {{ advisory.summary }}
              </p>

              <dl class="fields">
                <template
                  v-for="field in fields(advisory)"
                  :key="field.key"
                >
                  <dt>{{ field.label }}</dt>
                  <dd
                    :class="{ mono: field.mono }"
                    :title="field.value"
                  >
                    {{ field.value }}
                  </dd>
                </template>
              </dl>
            </div>
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

  // The severity palette rather than shell's status tokens: `--warning` and
  // `--info` are state colours and read as "caution" and "notice" — two
  // unrelated states, not two steps on one scale — and `--muted` for low is
  // the same grey as disabled text. Low and unknown take dark ink; see
  // `$low-na-text`.
  @include severity-fill('sev-');
}

.advisories {
  padding: 12px 0 12px 32px;
}

.advisory + .advisory {
  border-top: 1px solid var(--border);
  margin-top: 12px;
  padding-top: 12px;
}

.head {
  align-items: center;
  display: flex;
  gap: 12px;
}

// Identifiers are fixed-shape strings read character by character, and the
// SKILL is explicit that they never wrap onto a second line: a GHSA id broken
// across two rows stops being recognisable as one.
.ident {
  font-family: monospace;
  font-size: 12px;
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fix {
  align-items: center;
  display: flex;
  font-size: 12px;
  gap: 4px;
  margin-left: auto;
  white-space: nowrap;

  // `--info`, not a success green: a fix existing is information, not health.
  .icon {
    color: var(--info);
    font-size: 16px;
  }
}

.fix.no-fix,
.fix.no-fix .icon {
  color: var(--error);
}

// Capped rather than full-bleed. The sub-row spans every column, and a GitHub
// advisory summary set across 1800px is one unreadable line.
.summary {
  margin: 8px 0 0;
  max-width: 100ch;
}

.fields {
  display: grid;
  font-size: 12px;
  gap: 2px 16px;
  grid-template-columns: max-content minmax(0, 1fr);
  margin: 10px 0 0;
  max-width: 820px;

  dt {
    color: var(--disabled-text);
  }

  dd {
    margin: 0;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .mono {
    font-family: monospace;
  }
}
</style>
