<script setup lang="ts">
import { computed } from 'vue';

import { Severity, SEVERITIES, TriageStatus } from '../types/security';
import { useTranslation } from '../utils/i18n';
import { ageInDays } from '../utils/severity';
import { TRIAGE_ORDER } from '../utils/triage';
import SeverityAmountBar from './SeverityAmountBar.vue';

/**
 * The summary above a repo's table.
 *
 * One bordered strip with two blocks, not a row of cards: the severity
 * breakdown and the remediation numbers are the same summary read two ways,
 * and boxing them separately makes them look like unrelated widgets.
 *
 * The right-hand block leads on triage rather than on severity, because
 * severity is already the whole of the left-hand block and repeating it says
 * nothing new. What it adds is who has to move: on `rancher/dashboard` the
 * severity bar reads "18 open, 2 critical" while the triage split reads "12
 * cannot be fixed, 5 are waiting on a reviewer, 1 needs a PR" — the same
 * findings, and the only version of them anyone can act on.
 *
 * It replaces the old "no patch available" number rather than sitting beside
 * it: `no-fix` is that number, exactly, and printing both would be two labels
 * for one count.
 */
const props = withDefaults(defineProps<{
  counts: Record<Severity, number>;
  /** Open advisories across every severity, shown muted in the block header */
  total?: number;
  triage?: Record<TriageStatus, number> | null;
  oldest?: string | null;
}>(), {
  total: 0, triage: null, oldest: null
});

const t = useTranslation();

/**
 * The triage split, most work remaining first.
 *
 * Every status is shown even at zero. "0 need a PR" is a result worth reading,
 * and a block whose columns move about depending on the repo is harder to
 * compare across tabs than one with a fixed shape.
 */
const triageStats = computed(() => TRIAGE_ORDER.map((status) => ({
  status,
  count: props.triage?.[status] || 0,
  label: t(`extensionsCenter.security.triage.${ status }.short`),
})));

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
        Only `fix-ready` is ever coloured, and only when it is non-zero. It is
        the one number that is nobody's blocker: the fix exists, and no PR has
        been raised. `no-fix` is larger and looks worse but cannot be acted on,
        an age is not a failure, and colouring all three would leave none of
        them reading as the exception.
      -->
      <div class="stats">
        <div
          v-for="stat in triageStats"
          :key="stat.status"
          class="stat"
        >
          <div
            class="stat-value"
            :class="{ 'text-warning': stat.status === 'fix-ready' && stat.count > 0 }"
          >
            {{ stat.count }}
          </div>
          <div class="stat-label">
            {{ stat.label }}
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

// Four figures now rather than two, so the gap and the type come down to suit.
// Still one row: the triage split only reads as a split if its parts sit side
// by side, and wrapping "oldest" onto a second line would imply it belongs to
// a different group than it does.
.stats {
  align-items: center;
  display: flex;
  flex: 1;
  gap: 16px;
  justify-content: space-between;
}

.stat {
  display: flex;
  flex: 1 1 0;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  text-align: center;
}

.stat-value {
  font-size: 24px;
  font-weight: 700;
  line-height: 32px;
}

.stat-label {
  color: var(--disabled-text);
  font-size: 13px;
  font-weight: 400;
  line-height: 18px;
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
