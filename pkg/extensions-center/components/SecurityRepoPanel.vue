<script lang="ts">
import { defineComponent, PropType } from 'vue';
import { Banner } from '@components/Banner';
import LabeledSelect from '@shell/components/form/LabeledSelect.vue';

import { SECURITY_BUCKET_DAYS } from '../config/constants';
import { PackageGroup, RepoSecurity, Severity, SEVERITIES } from '../types/security';
import { trimSeries } from '../utils/securityHistory';
import SecuritySummary from './SecuritySummary.vue';
import SecurityTable from './SecurityTable.vue';
import SeverityChart from './SeverityChart.vue';

type View = 'list' | 'chart';

/** Ranges in days; 0 is "everything there is". */
const RANGES = [90, 182, 365, 0] as const;

interface SelectOption {
  label: string;
  value: string;
}

interface Data {
  view: View;
  range: number;
  severityFilter: Severity | 'all';
  scopeFilter: 'all' | 'runtime' | 'development';
  patchFilter: 'all' | 'patched' | 'unpatched';
}

/**
 * One repository's security state.
 *
 * Owns the list/chart toggle and the filters. The data is handed in already
 * loaded, so this component never fetches — the page decides when a tab is
 * worth paying for.
 */
export default defineComponent({
  name: 'SecurityRepoPanel',

  components: {
    Banner, LabeledSelect, SecuritySummary, SecurityTable, SeverityChart
  },

  props: {
    data: {
      type:    Object as PropType<RepoSecurity | null>,
      default: null,
    },

    loading: {
      type:    Boolean,
      default: false,
    },
  },

  data(): Data {
    return {
      view:           'list',
      range:          365,
      severityFilter: 'all',
      scopeFilter:    'all',
      patchFilter:    'all',
    };
  },

  computed: {
    severityOptions(): SelectOption[] {
      return [
        { label: this.t('extensionsCenter.security.filters.all'), value: 'all' },
        ...SEVERITIES.map((s) => ({ label: this.t(`extensionsCenter.security.severity.${ s }`), value: s })),
      ];
    },

    scopeOptions(): SelectOption[] {
      return [
        { label: this.t('extensionsCenter.security.filters.all'), value: 'all' },
        { label: this.t('extensionsCenter.security.scope.runtime'), value: 'runtime' },
        { label: this.t('extensionsCenter.security.scope.development'), value: 'development' },
      ];
    },

    patchOptions(): SelectOption[] {
      return [
        { label: this.t('extensionsCenter.security.filters.all'), value: 'all' },
        { label: this.t('extensionsCenter.security.filters.hasPatch'), value: 'patched' },
        { label: this.t('extensionsCenter.security.filters.noPatch'), value: 'unpatched' },
      ];
    },

    ranges(): readonly number[] {
      return RANGES;
    },

    /** Whether this repo's rows came from Dependabot or from public data. */
    isPublic(): boolean {
      return this.data?.source === 'public';
    },

    filtered(): PackageGroup[] {
      const groups = this.data?.groups || [];

      return groups
        .map((group) => {
          // Filtering has to reach inside the group, not just drop whole rows:
          // a package with one critical and three lows still belongs in a
          // "critical only" view, but showing it with all four advisories and
          // a count of 4 would misreport what the filter claims to show.
          const advisories = group.advisories.filter((advisory) => {
            if (this.severityFilter !== 'all' && advisory.severity !== this.severityFilter) {
              return false;
            }

            if (this.scopeFilter !== 'all' && advisory.scope !== this.scopeFilter) {
              return false;
            }

            if (this.patchFilter === 'patched' && !advisory.patchedVersion) {
              return false;
            }

            if (this.patchFilter === 'unpatched' && advisory.patchedVersion) {
              return false;
            }

            return true;
          });

          return { ...group, advisories };
        })
        .filter((group) => group.advisories.length > 0);
    },

    chartSeries() {
      if (!this.data?.history) {
        return null;
      }

      return trimSeries(this.data.history, this.range, SECURITY_BUCKET_DAYS);
    },

    rangeLabelKey(): (days: number) => string {
      return (days: number) => `extensionsCenter.security.range.${ days || 'all' }`;
    },
  },
});
</script>

<template>
  <div class="repo-panel">
    <div
      v-if="loading"
      class="loading text-muted"
    >
      <i class="icon icon-spinner icon-spin" />
      {{ t('extensionsCenter.security.loading') }}
    </div>

    <template v-else-if="data">
      <Banner
        v-if="data.error"
        color="error"
        :label="data.error"
      />

      <template v-else>
        <!--
          Where the numbers came from, stated on every public-data tab rather
          than buried in a tooltip. These counts are not comparable with
          Dependabot ones and a reader who does not know that will draw the
          wrong conclusion from the rollup.
        -->
        <Banner
          v-if="isPublic"
          color="info"
        >
          <div>
            <strong>{{ t('extensionsCenter.security.publicSource.title') }}</strong>
            <p>{{ t('extensionsCenter.security.publicSource.detail') }}</p>
            <p
              v-if="data.unresolved"
              class="text-muted"
            >
              {{ t('extensionsCenter.security.publicSource.unresolved', { count: data.unresolved }) }}
            </p>
          </div>
        </Banner>

        <!--
          How this tab was cut out of its repo, for the targets that are one
          package inside a monorepo rather than a repo of their own. Stated
          up front because it bounds what the numbers below can mean.
        -->
        <Banner
          v-if="data.noteKey"
          color="info"
          :label="t(data.noteKey)"
        />

        <SecuritySummary
          :counts="data.counts"
          :unpatched="data.unpatchedCount"
          :oldest="data.oldestOpen"
        />

        <div class="controls">
          <div class="toggle">
            <button
              type="button"
              class="btn btn-sm"
              :class="view === 'list' ? 'role-primary' : 'role-secondary'"
              @click="view = 'list'"
            >
              {{ t('extensionsCenter.security.view.list') }}
            </button>
            <button
              type="button"
              class="btn btn-sm"
              :class="view === 'chart' ? 'role-primary' : 'role-secondary'"
              @click="view = 'chart'"
            >
              {{ t('extensionsCenter.security.view.chart') }}
            </button>
          </div>

          <div
            v-if="view === 'list'"
            class="filters"
          >
            <LabeledSelect
              :value="severityFilter"
              :options="severityOptions"
              :label="t('extensionsCenter.security.filters.severity')"
              :clearable="false"
              :searchable="false"
              class="filter"
              @update:value="severityFilter = $event"
            />

            <!-- Scope is a Dependabot-only field; an SBOM does not carry it. -->
            <LabeledSelect
              v-if="!isPublic"
              :value="scopeFilter"
              :options="scopeOptions"
              :label="t('extensionsCenter.security.filters.scope')"
              :clearable="false"
              :searchable="false"
              class="filter"
              @update:value="scopeFilter = $event"
            />

            <LabeledSelect
              :value="patchFilter"
              :options="patchOptions"
              :label="t('extensionsCenter.security.filters.patch')"
              :clearable="false"
              :searchable="false"
              class="filter"
              @update:value="patchFilter = $event"
            />
          </div>

          <div
            v-else-if="chartSeries"
            class="filters"
          >
            <span class="control-label text-muted">{{ t('extensionsCenter.security.range.label') }}</span>
            <button
              v-for="days in ranges"
              :key="days"
              type="button"
              class="btn btn-sm"
              :class="range === days ? 'role-primary' : 'role-secondary'"
              @click="range = days"
            >
              {{ t(rangeLabelKey(days)) }}
            </button>
          </div>
        </div>

        <SecurityTable
          v-if="view === 'list'"
          :rows="filtered"
          :source="data.source"
        />

        <SeverityChart
          v-else-if="chartSeries"
          :series="chartSeries"
        />

        <!--
          No history is a property of the source, not a failure, so it says
          which source and why rather than showing an empty axis.
        -->
        <Banner
          v-else
          color="info"
          :label="t('extensionsCenter.security.noHistory')"
        />
      </template>
    </template>
  </div>
</template>

<style lang="scss" scoped>
.repo-panel {
  .loading {
    align-items: center;
    display: flex;
    gap: 8px;
    padding: 32px 0;
  }

  // One row, left-aligned, like the range control on the NPM Metrics page.
  // These were pushed apart with `space-between`, which stranded the filters
  // against the right edge a full screen away from the table they filter.
  .controls {
    align-items: center;
    display: flex;
    flex-wrap: wrap;
    gap: 8px 16px;
    margin-bottom: 12px;
  }

  .toggle,
  .filters {
    align-items: center;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .control-label {
    font-size: 12px;
  }

  // LabeledSelect fills its container by default, which in a flex row means
  // one filter per line. A fixed basis keeps the three of them side by side
  // and stops a long option label from resizing the control as you pick.
  .filter {
    flex: 0 0 200px;
  }

  p {
    margin: 4px 0 0;
  }
}
</style>
