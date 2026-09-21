<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { Banner } from '@components/Banner';

import DownloadChart from '../components/DownloadChart.vue';
import SectionHeader from '../components/SectionHeader.vue';
import { useNpmMetrics, MetricsRange } from '../composables/useNpmMetrics';

type Done = (ok: boolean) => void;

const metrics = useNpmMetrics();

const rangeOptions: { value: MetricsRange; labelKey: string }[] = [
  { value: 'last-month', labelKey: 'extensionsCenter.npmMetrics.range.lastMonth' },
  { value: 'last-quarter', labelKey: 'extensionsCenter.npmMetrics.range.lastQuarter' },
  { value: 'last-year', labelKey: 'extensionsCenter.npmMetrics.range.lastYear' },
];

const selectedRange = ref<MetricsRange>('last-month');

async function refresh(done?: Done) {
  await metrics.refresh();
  done?.(!metrics.error.value);
}

function onRangeChange(value: MetricsRange) {
  selectedRange.value = value;
  metrics.setRange(value);
}

function formatNumber(value: number): string {
  return value.toLocaleString();
}

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleDateString() : '—';
}

onMounted(() => refresh());
</script>

<template>
  <div class="npm-metrics">
    <SectionHeader
      :title="t('extensionsCenter.npmMetrics.title')"
      :description="t('extensionsCenter.npmMetrics.description')"
      :last-refreshed="metrics.lastRefreshed.value"
      :loading="metrics.loading.value"
      @refresh="refresh"
    />

    <Banner
      v-if="metrics.error.value"
      color="error"
      :label="metrics.error.value"
    />

    <div class="range">
      <span class="text-muted">{{ t('extensionsCenter.npmMetrics.range.label') }}</span>
      <button
        v-for="option in rangeOptions"
        :key="option.value"
        type="button"
        class="btn btn-sm"
        :class="option.value === selectedRange ? 'role-primary' : 'role-secondary'"
        :disabled="metrics.loading.value"
        @click="onRangeChange(option.value)"
      >
        {{ t(option.labelKey) }}
      </button>
    </div>

    <section
      v-for="pkg in metrics.data.value"
      :key="pkg.name"
      class="package"
    >
      <header>
        <h3>
          <a
            :href="pkg.npmUrl"
            target="_blank"
            rel="noopener noreferrer"
          >
            {{ pkg.name }}
            <i class="icon icon-external-link" />
          </a>
        </h3>
      </header>

      <div class="stats">
        <div class="stat">
          <span class="value">{{ pkg.latestVersion || '—' }}</span>
          <span class="label text-muted">{{ t('extensionsCenter.npmMetrics.latestVersion') }}</span>
        </div>
        <div class="stat">
          <span class="value">{{ formatDate(pkg.latestPublishedAt) }}</span>
          <span class="label text-muted">{{ t('extensionsCenter.npmMetrics.published') }}</span>
        </div>
        <div class="stat">
          <span class="value">{{ formatNumber(pkg.totalVersions) }}</span>
          <span class="label text-muted">{{ t('extensionsCenter.npmMetrics.totalVersions') }}</span>
        </div>
        <div class="stat">
          <span class="value">{{ formatNumber(pkg.downloadsLastWeek) }}</span>
          <span class="label text-muted">{{ t('extensionsCenter.npmMetrics.lastWeek') }}</span>
        </div>
        <div class="stat">
          <span class="value">{{ formatNumber(pkg.downloadsLastMonth) }}</span>
          <span class="label text-muted">{{ t('extensionsCenter.npmMetrics.lastMonth') }}</span>
        </div>
      </div>

      <DownloadChart
        :points="pkg.daily"
        :label="t('extensionsCenter.npmMetrics.chartTitle')"
      />
    </section>
  </div>
</template>

<style lang="scss" scoped>
.npm-metrics {
  padding-bottom: 40px;

  .range {
    align-items: center;
    display: flex;
    gap: 8px;
    margin-bottom: 20px;
  }

  .package {
    background: var(--box-bg);
    border: 1px solid var(--border);
    border-radius: var(--border-radius);
    margin-bottom: 20px;
    padding: 16px;

    h3 {
      margin: 0 0 12px;
    }
  }

  .stats {
    display: grid;
    gap: 16px;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    margin-bottom: 20px;
  }

  .stat {
    display: flex;
    flex-direction: column;

    .value {
      font-size: 20px;
      font-weight: 600;
    }

    .label {
      font-size: 12px;
    }
  }

  .icon-external-link {
    font-size: 12px;
  }
}
</style>
