<script lang="ts">
import { defineComponent, PropType } from 'vue';

import { CategorySummary, RepoOrigin } from '../types/repos';

/**
 * Total extension count plus the SUSE/external split.
 *
 * Covers the whole known set, official repos included, not just the community
 * rows shown in the table next to it.
 */
export default defineComponent({
  name: 'CategorySummaryPanel',

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
    max(): number {
      return this.summary.byOrigin.reduce((m, c) => Math.max(m, c.count), 0);
    },
  },

  methods: {
    originLabel(origin: RepoOrigin): string {
      return this.t(`extensionsCenter.knownRepos.${ origin }`);
    },

    barWidth(count: number): string {
      return this.max ? `${ Math.round((count / this.max) * 100) }%` : '0%';
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
            :style="{ width: barWidth(entry.count) }"
          />
        </span>
        <span class="value">{{ entry.count }}</span>
      </li>
    </ul>

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
