<script lang="ts">
import { defineComponent, PropType } from 'vue';

import { Severity, SEVERITIES } from '../types/security';
import { ageInDays } from '../utils/severity';

/**
 * The severity tiles above a repo's table.
 *
 * Four counts plus two that matter more than they look. "No patch available"
 * is work that cannot be done by bumping a version, so it needs a different
 * decision; "oldest open" is the one number that says whether anything is
 * actually being acted on.
 */
export default defineComponent({
  name: 'SecuritySummary',

  props: {
    counts: {
      type:     Object as PropType<Record<Severity, number>>,
      required: true,
    },

    unpatched: {
      type:    Number,
      default: 0,
    },

    oldest: {
      type:    String as PropType<string | null>,
      default: null,
    },
  },

  computed: {
    severities(): { severity: Severity; count: number }[] {
      return SEVERITIES.map((severity) => ({ severity, count: this.counts[severity] }));
    },

    /** Whole days, months or years — nobody reads "just over 431 days". */
    oldestLabel(): string {
      const days = ageInDays(this.oldest);

      if (days === null) {
        return this.t('extensionsCenter.common.na');
      }

      if (days < 60) {
        return this.t('extensionsCenter.security.age.days', { count: days });
      }

      if (days < 730) {
        return this.t('extensionsCenter.security.age.months', { count: Math.floor(days / 30) });
      }

      return this.t('extensionsCenter.security.age.years', { count: Math.floor(days / 365) });
    },
  },
});
</script>

<template>
  <div class="security-summary">
    <div
      v-for="entry in severities"
      :key="entry.severity"
      class="tile"
      :class="`sev-${ entry.severity }`"
    >
      <span class="count">{{ entry.count }}</span>
      <span class="label">{{ t(`extensionsCenter.security.severity.${ entry.severity }`) }}</span>
    </div>

    <div class="tile secondary">
      <span class="count">{{ unpatched }}</span>
      <span class="label">{{ t('extensionsCenter.security.tiles.unpatched') }}</span>
    </div>

    <div class="tile secondary">
      <span class="count small">{{ oldestLabel }}</span>
      <span class="label">{{ t('extensionsCenter.security.tiles.oldest') }}</span>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.security-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 16px;

  .tile {
    background: var(--box-bg);
    border: 1px solid var(--border);
    border-radius: var(--border-radius);
    display: flex;
    flex: 1 1 110px;
    flex-direction: column;
    gap: 2px;
    padding: 12px 16px;

    // A 4px rule carries the severity rather than tinting the whole tile:
    // four saturated blocks side by side is a traffic light, not a summary.
    border-left-width: 4px;
  }

  .sev-critical { border-left-color: var(--error); }
  .sev-high { border-left-color: var(--warning); }
  .sev-medium { border-left-color: var(--info); }
  .sev-low { border-left-color: var(--muted); }

  .secondary {
    border-left-color: var(--border);
  }

  .count {
    font-size: 24px;
    font-weight: 600;
    line-height: 1.1;

    &.small {
      font-size: 18px;
      // Keeps the baseline of "1y 2m" level with the plain numbers beside it.
      padding: 3px 0;
    }
  }

  .label {
    color: var(--muted);
    font-size: 12px;
  }
}
</style>
