<script setup lang="ts">
import { computed, ref } from 'vue';
import { Banner } from '@components/Banner';
import { LabeledInput } from '@components/Form/LabeledInput';
import SortableTable from '@shell/components/SortableTable/index.vue';

import { BundleAnalysisDoc } from '../types/analysis';
import { InventoryDoc } from '../types/inventory';
import { RepoSecurity } from '../types/security';
import { TableHeader } from '../types/table';
import { prettyBytes } from '../utils/bytes';
import { InventoryHit, parseQuery, searchInventory } from '../utils/inventorySearch';
import { useTranslation } from '../utils/i18n';

/**
 * Looking one package up across every extension's lockfile.
 *
 * Built for the hour after a name starts circulating and before any advisory
 * exists: the question is "is this in our tree, at what version", and the
 * advisory-driven views cannot answer it — they have no row for a package
 * nobody has filed against yet, so they come back empty and empty reads as
 * "we are fine".
 *
 * The result is annotated with everything the other two documents know about
 * the package, because "it is in four lockfiles" and "it is in four lockfiles
 * and two published bundles" call for different responses.
 */

/** Sort key for the verdict column. Same order, and reason, as `ReachTable`. */
const VERDICT_ORDER: Record<string, number> = {
  hit: 0, partial: 1, unknown: 2, miss: 3,
};

const t = useTranslation();

const props = defineProps<{
  inventory: InventoryDoc | null;
  bundles: BundleAnalysisDoc | null;
  repos: RepoSecurity[];
}>();

/** What is in the box, which is not yet what was searched for */
const input = ref('');

/**
 * The submitted query.
 *
 * Deliberately not the input itself. Searching every keystroke across ~20,000
 * package names is affordable, but it means a half-typed name renders as a
 * confident "not found in any of 14 extensions" — which is the one answer this
 * must never give by accident.
 */
const query = ref('');

const parsed = computed(() => parseQuery(query.value));

const result = computed(() => {
  return parsed.value ? searchInventory(parsed.value, props.inventory, props.bundles, props.repos) : null;
});

const headers = computed<TableHeader[]>(() => [
  {
    name: 'ext', labelKey: 'extensionsCenter.security.search.cols.extension', value: 'ext', sort: ['ext']
  },
  {
    name: 'versions', labelKey: 'extensionsCenter.security.search.cols.resolved', value: 'versionLabel', sort: ['versionLabel']
  },
  // Only when a range was actually typed. A verdict column reading "—" down
  // every row is noise, and worse, it hints that a check was run and came back
  // inconclusive rather than that none was asked for.
  ...(parsed.value?.range ? [{
    name: 'verdict', labelKey: 'extensionsCenter.security.search.cols.inRange', value: 'verdictOrder', sort: ['verdictOrder']
  }] : []),
  {
    name: 'shipped', labelKey: 'extensionsCenter.security.search.cols.ships', value: 'shippedOrder', sort: ['shippedOrder']
  },
  {
    name: 'advisories', labelKey: 'extensionsCenter.security.cols.advisories', value: 'advisoryCount', align: 'right', sort: ['advisoryCount']
  },
  {
    name: 'release', labelKey: 'extensionsCenter.security.search.cols.release', value: 'semver', sort: ['semver']
  },
]);

const rows = computed(() => {
  return (result.value?.hits || []).map((hit: InventoryHit) => ({
    ...hit,
    versionLabel:  hit.versions.join(', '),
    verdictOrder:  VERDICT_ORDER[hit.verdict || 'unknown'],
    shippedOrder:  hit.shipped ? 0 : 1,
    advisoryCount: hit.advisories.length,
  }));
});

function search() {
  query.value = input.value;
}

/** Run a suggested name, from the near-miss list under an empty result. */
function searchFor(name: string) {
  input.value = name;
  search();
}
</script>

<template>
  <div class="package-search">
    <form
      class="search-bar"
      @submit.prevent="search"
    >
      <LabeledInput
        v-model:value="input"
        class="search-input"
        :label="t('extensionsCenter.security.search.label')"
        :placeholder="t('extensionsCenter.security.search.placeholder')"
        :disabled="!inventory"
        @keyup.enter="search"
      />
      <button
        type="submit"
        class="btn role-primary"
        :disabled="!inventory || !input.trim()"
      >
        {{ t('extensionsCenter.security.search.submit') }}
      </button>
    </form>

    <template v-if="result && parsed">
      <!--
        The query echoed back, split the way it was parsed. A scoped name with
        a range in it is ambiguous enough that showing the split is the
        cheapest way to make a mis-parse obvious.
      -->
      <div class="summary">
        <span class="asked">
          <code>{{ parsed.name }}</code>
          <span
            v-if="parsed.range"
            class="text-muted"
          >{{ t('extensionsCenter.security.search.range', { range: parsed.range }) }}</span>
        </span>

        <span class="text-muted">
          {{ t('extensionsCenter.security.search.scope', { found: result.hits.length, searched: result.searched }) }}
        </span>
      </div>

      <!--
        Said whenever any lockfile failed, found or not. A hit list that is
        missing an extension is a worse answer than no answer, because nothing
        about it looks incomplete.
      -->
      <Banner
        v-if="result.unreadable.length"
        color="warning"
        :label="t('extensionsCenter.security.search.unreadable', { extensions: result.unreadable.join(', ') })"
      />

      <template v-if="!result.hits.length">
        <Banner
          color="info"
          :label="t('extensionsCenter.security.search.notFound', { name: parsed.name, searched: result.searched })"
        />

        <!--
          Offered only on a miss, and only for a name long enough that the
          matches mean something. A typo and a genuinely absent package look
          identical in the result, and this is what tells them apart.
        -->
        <div
          v-if="result.suggestions.length"
          class="suggestions"
        >
          <span class="text-muted">{{ t('extensionsCenter.security.search.didYouMean') }}</span>
          <a
            v-for="name in result.suggestions"
            :key="name"
            href="#"
            @click.prevent="searchFor(name)"
          >{{ name }}</a>
        </div>
      </template>

      <SortableTable
        v-else
        :headers="headers"
        :rows="rows"
        key-field="ext"
        :table-actions="false"
        :row-actions="false"
        :search="false"
        :paging="false"
        :sub-rows="true"
        :sub-expandable="true"
        :sub-expand-column="true"
        :sub-rows-description="false"
        no-rows-key="extensionsCenter.security.search.notFoundShort"
        default-sort-by="ext"
      >
        <template #cell:versions="{ row }">
          <code>{{ row.versionLabel }}</code>
        </template>

        <template #cell:verdict="{ row }">
          <span
            class="badge"
            :class="`reach-${ row.verdict }`"
          >{{ t(`extensionsCenter.security.search.verdict.${ row.verdict }`) }}</span>
        </template>

        <!--
          Two different "no": not in the bundle, versus no bundle analysis to
          check against. The second is not evidence of anything and must not
          render as though it were.
        -->
        <template #cell:shipped="{ row }">
          <span
            v-if="!bundles"
            v-clean-tooltip="t('extensionsCenter.security.search.noBundles')"
            class="text-muted"
          >{{ t('extensionsCenter.common.na') }}</span>
          <span
            v-else-if="row.shipped"
            class="ships"
          >
            {{ t('extensionsCenter.security.search.ships') }}
            <span
              v-if="row.shippedBytes !== null"
              class="text-muted"
            >{{ prettyBytes(row.shippedBytes) }}</span>
          </span>
          <span
            v-else
            class="text-muted"
          >{{ t('extensionsCenter.security.search.buildOnly') }}</span>
        </template>

        <template #cell:release="{ row }">
          {{ row.semver }}
          <span
            v-if="row.source === 'branch'"
            v-clean-tooltip="t('extensionsCenter.security.search.fromBranch', { ref: row.tag })"
            class="text-muted branch"
          >{{ t('extensionsCenter.security.search.head') }}</span>
        </template>

        <template #sub-row="{ row, fullColspan }">
          <tr class="sub-row">
            <td :colspan="fullColspan">
              <div class="detail">
                <p class="text-muted source">
                  {{ t('extensionsCenter.security.search.readFrom', { repo: row.repo, ref: row.tag, lockfile: row.lockfile }) }}
                </p>

                <p
                  v-if="row.shipped && row.cause"
                  class="text-muted"
                >
                  {{ t('extensionsCenter.security.search.cause', { cause: t(`extensionsCenter.bundleAnalysis.cause.${ row.cause }`) }) }}
                </p>

                <ul
                  v-if="row.advisories.length"
                  class="advisories"
                >
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
                    <span class="summary-text">{{ advisory.summary }}</span>
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
  </div>
</template>

<style lang="scss" scoped>
@import '../styles/severity';

.search-bar {
  align-items: flex-end;
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
}

// Wide enough for a scoped name with a range after it, but not the full page:
// a search box the width of a dashboard reads as the page's main content
// rather than as one control on it.
.search-input {
  max-width: 520px;
}

.summary {
  align-items: baseline;
  display: flex;
  flex-wrap: wrap;
  font-size: 12px;
  gap: 16px;
  margin-bottom: 12px;
}

.asked code {
  font-size: 13px;
  font-weight: 600;
}

.asked .text-muted {
  margin-left: 6px;
}

.suggestions {
  align-items: baseline;
  display: flex;
  flex-wrap: wrap;
  font-size: 12px;
  gap: 4px 12px;
  margin-top: 8px;
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

// The same four verdict colours the reach tab uses, because it is the same
// question — does the resolved version fall in the range — and two palettes
// for one answer would read as two different answers.
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

.ships .text-muted {
  margin-left: 6px;
}

.branch {
  font-size: 11px;
  margin-left: 6px;
}

.detail {
  padding: 8px 0 8px 32px;

  p {
    font-size: 12px;
    margin: 0 0 4px;
  }
}

.advisories {
  border-top: 1px solid var(--border);
  font-size: 12px;
  list-style: none;
  margin: 8px 0 0;
  padding: 8px 0 0;

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

.summary-text {
  min-width: 0;
}
</style>
