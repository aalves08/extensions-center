<script lang="ts">
import { defineComponent, markRaw, PropType } from 'vue';
import { Chart, registerables } from 'chart.js';

import { DownloadPoint } from '../types/npm';

Chart.register(...registerables);

type DownloadsChart = Chart<'line', number[], string>;

interface Data {
  chart: DownloadsChart | null;
}

/**
 * Daily npm downloads as a line chart.
 *
 * Uses chart.js directly rather than a wrapper, matching how the shell's own
 * Fleet dashboard draws its charts, so there is no extra abstraction to keep in
 * step with the shell's chart.js version.
 */
export default defineComponent({
  name: 'DownloadChart',

  props: {
    points: {
      type:     Array as PropType<DownloadPoint[]>,
      required: true,
    },

    label: {
      type:     String,
      required: true,
    },
  },

  data(): Data {
    return { chart: null };
  },

  watch: {
    points() {
      this.render();
    },
  },

  mounted() {
    this.render();
  },

  beforeUnmount() {
    this.chart?.destroy();
    this.chart = null;
  },

  methods: {
    render() {
      const canvas = this.$refs.canvas as HTMLCanvasElement | undefined;

      if (!canvas) {
        return;
      }

      this.chart?.destroy();

      // Read the theme's colours off the document so the chart follows light
      // and dark mode without duplicating the palette here.
      const styles = getComputedStyle(document.body);
      const primary = styles.getPropertyValue('--primary').trim() || '#3d98d3';
      const muted = styles.getPropertyValue('--muted').trim() || '#6c6c76';
      const border = styles.getPropertyValue('--border').trim() || '#dcdee7';

      // markRaw keeps the chart instance out of Vue's reactivity — chart.js
      // manages its own internal state and does not want a proxy wrapped round it.
      const chart = new Chart(canvas, {
        type: 'line',
        data: {
          labels:   this.points.map((p) => p.day),
          datasets: [{
            label:           this.label,
            data:            this.points.map((p) => p.downloads),
            borderColor:     primary,
            backgroundColor: `${ primary }26`,
            borderWidth:     2,
            fill:            true,
            pointRadius:     0,
            tension:         0.25,
          }],
        },
        options: {
          responsive:          true,
          maintainAspectRatio: false,
          interaction:         { mode: 'index', intersect: false },
          plugins:             { legend: { display: false } },
          scales:              {
            x: {
              ticks: {
                color: muted, maxRotation: 0, autoSkipPadding: 24
              },
              grid: { display: false },
            },
            y: {
              beginAtZero: true,
              ticks:       { color: muted },
              grid:        { color: border },
            },
          },
        },
      }) as DownloadsChart;

      this.chart = markRaw(chart);
    },
  },
});
</script>

<template>
  <div class="download-chart">
    <canvas ref="canvas" />
  </div>
</template>

<style lang="scss" scoped>
.download-chart {
  height: 240px;
  position: relative;
  width: 100%;
}
</style>
