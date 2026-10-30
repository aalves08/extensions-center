<script lang="ts">
import { defineComponent, PropType } from 'vue';

import { CategorySummary, RepoOrigin } from '../types/repos';
import { i18nMixin } from '../utils/i18n';

/**
 * Total extension count, the SUSE/external split, and — once someone has run
 * Describe with AI — what the model sorted them into.
 *
 * Both breakdowns are shown rather than one replacing the other: who owns a
 * repo and what it does are different questions, and the origin split is the
 * only one available on a table nobody has described.
 *
 * Covers the whole known set, official repos included, not just the community
 * rows shown in the table next to it.
 */
export default defineComponent({
  name: 'CategorySummaryPanel',

  mixins: [i18nMixin],

  props: {
    summary: {
      type:     Object as PropType<CategorySummary>,
      required: true,
    },

    /** Optional note rendered under the bars */
    description: {
      type:    String,
      default: null,
    },
  },

  computed: {
    originMax(): number {
      return this.summary.byOrigin.reduce((m, c) => Math.max(m, c.count), 0);
    },

    /**
     * Scaled separately from the origin bars.
     *
     * There are a dozen categories and two origins, so sharing a scale would
     * flatten every category bar against a SUSE/external count an order of
     * magnitude larger and make the breakdown unreadable.
     */
    categoryMax(): number {
      return this.summary.byCategory.reduce((m, c) => Math.max(m, c.count), 0);
    },
  },

  methods: {
    originLabel(origin: RepoOrigin): string {
      return this.t(`extensionsCenter.knownRepos.${ origin }`);
    },

    barWidth(count: number, max: number): string {
      return max ? `${ Math.round((count / max) * 100) }%` : '0%';
    },
  },
});
</script>

<template>
  <div class="category-summary">
    <div class="total">
      <span class="count">{{ summary.total }}</span>
      <span class="text-muted">{{ t('extensionsCenter.knownRepos.summary.total') }}</span>
    </div>

    <h4>{{ t('extensionsCenter.knownRepos.summary.origins') }}</h4>

    <ul class="categories">
      <li
        v-for="entry in summary.byOrigin"
        :key="entry.origin"
      >
        <span class="name">{{ originLabel(entry.origin) }}</span>
        <span class="bar">
          <span
            class="fill"
            :class="entry.origin"
            :style="{ width: barWidth(entry.count, originMax) }"
          />
        </span>
        <span class="value">{{ entry.count }}</span>
      </li>
    </ul>

    <h4>{{ t('extensionsCenter.knownRepos.summary.categories') }}</h4>

    <ul
      v-if="summary.byCategory.length"
      class="categories"
    >
      <li
        v-for="entry in summary.byCategory"
        :key="entry.category"
      >
        <span class="name">{{ entry.category }}</span>
        <span class="bar">
          <span
            class="fill"
            :style="{ width: barWidth(entry.count, categoryMax) }"
          />
        </span>
        <span class="value">{{ entry.count }}</span>
      </li>
    </ul>

    <!--
      Said rather than left blank: an empty panel reads as "the model found
      nothing", when what it means is that nobody has pressed the button.
    -->
    <p
      v-else
      class="description text-muted"
    >
      {{ t('extensionsCenter.knownRepos.summary.notDescribed') }}
    </p>

    <p
      v-if="description"
      class="description text-muted"
    >
      {{ description }}
    </p>
  </div>
</template>

<style lang="scss" scoped>
.category-summary {
  h4 {
    font-size: 12px;
    letter-spacing: 0.04em;
    margin: 16px 0 6px;
    text-transform: uppercase;

    &:first-of-type {
      margin-top: 0;
    }
  }

  .total {
    align-items: baseline;
    display: flex;
    gap: 8px;
    margin-bottom: 16px;

    .count {
      font-size: 32px;
      font-weight: 600;
      line-height: 1;
    }
  }

  .categories {
    list-style: none;
    margin: 0;
    padding: 0;

    li {
      align-items: center;
      display: grid;
      gap: 8px;
      grid-template-columns: minmax(80px, 1fr) 2fr auto;
      padding: 3px 0;
    }

    .name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .bar {
      background: var(--border);
      border-radius: 3px;
      display: block;
      height: 6px;
      overflow: hidden;
    }

    // Same two colours the badges in the table use, so the bar and the row a
    // reader just looked at are obviously the same thing.
    .fill {
      background: var(--primary);
      display: block;
      height: 100%;

      &.external {
        background: var(--warning);
      }
    }

    .value {
      font-variant-numeric: tabular-nums;
      text-align: right;
    }
  }

  .description {
    font-size: 12px;
    margin: 16px 0 0;
  }
}
</style>
