<script setup lang="ts">
import { computed } from 'vue';

import { Severity, SEVERITIES } from '../types/security';
import { useTranslation } from '../utils/i18n';
import { ageInDays } from '../utils/severity';
import SeverityAmountBar from './SeverityAmountBar.vue';

/**
 * The summary above a repo's table.
 *
 * One bordered strip with two blocks, not a row of cards: the severity
 * breakdown and the two remediation numbers are the same summary read two
 * ways, and boxing them separately makes them look like unrelated widgets.
 *
 * "No patch available" is work that cannot be done by bumping a version, so it
 * needs a different decision; "oldest open" is the one number that says
 * whether anything is actually being acted on.
 */
const props = withDefaults(defineProps<{
  counts: Record<Severity, number>;
  /** Open advisories across every severity, shown muted in the block header */
  total?: number;
  unpatched?: number;
  oldest?: string | null;
}>(), {
  total: 0, unpatched: 0, oldest: null
});

const t = useTranslation();

/**
 * Labels under the bar, in the bar's own order.
 *
 * The strip prints counts but names its severities only in `title`, which is
 * no use in greyscale or at a glance. One flex row with the same `flex: 1 0 0`
 * as the segments lines the words up under the blocks they belong to.
 */
const legend = computed(() => SEVERITIES.map((severity) => ({
  severity,
  label: t(`extensionsCenter.security.severity.${ severity }`),
})));

/** Whole days, months or years — nobody reads "just over 431 days". */
const oldestLabel = computed(() => {
  const days = ageInDays(props.oldest);

  if (days === null) {
    return t('extensionsCenter.common.na');
  }

  if (days < 60) {
    return t('extensionsCenter.security.age.days', { count: days });
  }

  if (days < 730) {
    return t('extensionsCenter.security.age.months', { count: Math.floor(days / 30) });
  }

  return t('extensionsCenter.security.age.years', { count: Math.floor(days / 365) });
});
</script>

<template>
  <div class="summary-section">
    <section class="summary-block">
      <h3 class="summary-title">
        {{ t('extensionsCenter.security.summary.severityTitle') }}
        <span class="summary-total text-muted">{{ total }}</span>
      </h3>

      <div class="bar-group">
        <SeverityAmountBar :counts="counts" />

        <div class="legend">
          <span
            v-for="entry in legend"
            :key="entry.severity"
            class="legend-item"
          >{{ entry.label }}</span>
        </div>
      </div>
    </section>

    <section class="summary-block">
      <h3 class="summary-title">
        {{ t('extensionsCenter.security.summary.remediationTitle') }}
      </h3>

      <!--
        Only `unpatched` is ever coloured, and only when it is non-zero. An age
        is not a failure, and colouring both would leave neither reading as the
        exception.
      -->
      <div class="stats">
        <div class="stat">
          <div
            class="stat-value"
            :class="{ 'text-error': unpatched > 0 }"
          >
            {{ unpatched }}
          </div>
          <div class="stat-label">
            {{ t('extensionsCenter.security.tiles.unpatched') }}
          </div>
        </div>

        <div class="stat">
          <div class="stat-value">
            {{ oldestLabel }}
          </div>
          <div class="stat-label">
            {{ t('extensionsCenter.security.tiles.oldest') }}
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style lang="scss" scoped>
.summary-section {
  align-items: stretch;
  border: var(--border-width) solid var(--input-border);
  border-radius: 6px;
  display: flex;
  margin-bottom: 24px;
}

.summary-block {
  display: flex;
  flex: 1 1 0;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  padding: 16px;

  // The portable divider: no child needs to know it is not the first.
  & + & {
    border-left: var(--border-width) solid var(--input-border);
  }
}

.summary-title {
  align-items: center;
  display: flex;
  font-size: 18px;
  font-weight: 400;
  gap: 8px;
  line-height: 21px;
  margin: 0;
}

.summary-total {
  font-size: 14px;
  margin-left: auto;
}

.bar-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

// Same basis as the bar's segments, so each word sits under its own block.
.legend {
  display: flex;
}

.legend-item {
  color: var(--disabled-text);
  flex: 1 0 0;
  font-size: 12px;
  line-height: 16px;
  text-align: center;
}

.stats {
  align-items: center;
  display: flex;
  flex: 1;
  gap: 32px;
  justify-content: space-between;
}

.stat {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 8px;
  text-align: center;
}

.stat-value {
  font-size: 28px;
  font-weight: 700;
  line-height: 36px;
}

.stat-label {
  color: var(--disabled-text);
  font-size: 14px;
  font-weight: 400;
  line-height: 20px;
}

@media (max-width: 1200px) {
  .summary-section {
    flex-direction: column;
  }

  .summary-block + .summary-block {
    border-left: 0;
    border-top: var(--border-width) solid var(--input-border);
  }
}
</style>
