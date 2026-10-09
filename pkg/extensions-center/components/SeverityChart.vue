<script lang="ts">
import { defineComponent, markRaw, PropType } from 'vue';
import { Chart, registerables } from 'chart.js';

import { SeveritySeries, SEVERITIES, Severity } from '../types/security';

Chart.register(...registerables);

type SeverityChartJs = Chart<'line', number[], string>;

interface Data {
  chart: SeverityChartJs | null;
}

/**
 * Which theme variable each severity is drawn in.
 *
 * The dashboard's own status colours rather than a palette of our own, so a
 * critical line here is the same red as a critical anything else in Rancher
 * and both themes are handled by the shell. `low` takes the muted ink: it is
 * deliberately not `--success`, because a low-severity vulnerability is still
 * a vulnerability and a green line would read as "this is fine".
 */
const SEVERITY_VARS: Record<Severity, { name: string; fallback: string }> = {
  critical: { name: '--error', fallback: '#f64747' },
  high:     { name: '--warning', fallback: '#dac342' },
  medium:   { name: '--info', fallback: '#3d98d3' },
  low:      { name: '--muted', fallback: '#6c6c76' },
};

/**
 * Open vulnerabilities over time, one line per severity.
 *
 * Deliberately the same chart as `DownloadChart` on the NPM Metrics page —
 * filled area, same tension, same axes, sitting in the same bordered card — so
 * the two pages read as one product. chart.js directly rather than a wrapper,
 * colours off the document so both themes work, `markRaw` to keep the instance
 * out of Vue's reactivity.
 */
export default defineComponent({
  name: 'SeverityChart',

  props: {
    series: {
      type:     Object as PropType<SeveritySeries>,
      required: true,
    },
  },

  data(): Data {
    return { chart: null };
  },

  watch: {
    series() {
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

      const styles = getComputedStyle(document.body);
      const read = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback;
      const muted = read('--muted', '#6c6c76');
      const border = read('--border', '#dcdee7');

      const chart = new Chart(canvas, {
        type: 'line',
        data: {
          labels:   this.series.dates,
          datasets: SEVERITIES.map((severity) => {
            const colour = read(SEVERITY_VARS[severity].name, SEVERITY_VARS[severity].fallback);

            return {
              label:           this.t(`extensionsCenter.security.severity.${ severity }`),
              data:            this.series[severity],
              borderColor:     colour,
              // Same 15% wash under the line as the download chart. Not
              // stacked: the question people ask is "are the criticals coming
              // down", and stacking makes every band except the bottom one
              // unreadable against its own baseline.
              backgroundColor: `${ colour }26`,
              borderWidth:     2,
              fill:            true,
              pointRadius:     0,
              tension:         0.25,
            };
          }),
        },
        options: {
          responsive:          true,
          maintainAspectRatio: false,
          interaction:         { mode: 'index', intersect: false },
          plugins:             {
            // The download chart has one series and so needs no legend. Four
            // severities do, but it stays out of the plot area and wears the
            // same muted ink as the axis labels rather than competing with it.
            legend: {
              display:  true,
              position: 'bottom',
              labels:   {
                color: muted, boxWidth: 12, boxHeight: 12, padding: 16
              },
            },
            tooltip: { callbacks: { title: (items) => items[0]?.label || '' } },
          },
          scales: {
            x: {
              ticks: {
                color: muted, maxRotation: 0, autoSkipPadding: 24
              },
              grid: { display: false },
            },
            y: {
              beginAtZero: true,
              ticks:       { color: muted, precision: 0 },
              grid:        { color: border },
            },
          },
        },
      }) as SeverityChartJs;

      this.chart = markRaw(chart);
    },
  },
});
</script>

<template>
  <section class="severity-chart">
    <div class="plot">
      <canvas ref="canvas" />
    </div>
  </section>
</template>

<style lang="scss" scoped>
// The card the NPM Metrics charts sit in, so the two pages match.
.severity-chart {
  background: var(--box-bg);
  border: 1px solid var(--border);
  border-radius: var(--border-radius);
  padding: 16px;

  .plot {
    height: 280px;
    position: relative;
    width: 100%;
  }
}
</style>
