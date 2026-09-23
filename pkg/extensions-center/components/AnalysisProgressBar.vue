<script lang="ts">
import { defineComponent, PropType } from 'vue';

import { AnalysisProgress } from '../types/analysis';

/**
 * Progress for a rebuild that is going to run for minutes.
 *
 * A bare spinner on a five-minute job is indistinguishable from a hang, so this
 * names the phase, counts the extensions and says which one is being worked on.
 */
export default defineComponent({
  name: 'AnalysisProgressBar',

  props: {
    progress: {
      type:    Object as PropType<AnalysisProgress | null>,
      default: null,
    },
  },

  computed: {
    phaseLabel(): string {
      return this.t(`extensionsCenter.analysis.phase.${ this.progress?.phase }`);
    },

    /**
     * Percentage, or null while the total is unknown.
     *
     * The first phase resolves the target list and cannot know how many
     * extensions there are until it finishes, so the bar renders indeterminate
     * rather than sitting at a misleading zero.
     */
    percent(): number | null {
      const total = this.progress?.total || 0;

      if (!total) {
        return null;
      }

      return Math.min(100, Math.round(((this.progress?.done || 0) / total) * 100));
    },

    countLabel(): string | null {
      if (!this.progress?.total) {
        return null;
      }

      return `${ this.progress.done } / ${ this.progress.total }`;
    },
  },
});
</script>

<template>
  <div
    v-if="progress"
    class="analysis-progress"
  >
    <div class="labels">
      <span>
        {{ phaseLabel }}
        <span
          v-if="progress.label"
          class="text-muted"
        >— {{ progress.label }}</span>
      </span>
      <span
        v-if="countLabel"
        class="text-muted"
      >{{ countLabel }}</span>
    </div>

    <div class="track">
      <div
        class="fill"
        :class="{ indeterminate: percent === null }"
        :style="percent === null ? undefined : { width: `${ percent }%` }"
      />
    </div>
  </div>
</template>

<style lang="scss" scoped>
.analysis-progress {
  margin-bottom: 16px;

  .labels {
    display: flex;
    font-size: 12px;
    justify-content: space-between;
    margin-bottom: 4px;
  }

  .track {
    background: var(--border);
    border-radius: 3px;
    height: 6px;
    overflow: hidden;
  }

  .fill {
    background: var(--primary);
    height: 100%;
    transition: width 0.3s ease;

    // No total yet, so the bar slides instead of claiming a position.
    &.indeterminate {
      animation: analysis-sweep 1.4s ease-in-out infinite;
      width: 30%;
    }
  }
}

@keyframes analysis-sweep {
  0% { margin-left: -30%; }
  100% { margin-left: 100%; }
}
</style>
