<script lang="ts">
import { defineComponent, PropType } from 'vue';
import { BadgeState } from '@components/BadgeState';

import { RunStatus } from '../types/tests';

/** Rancher state background classes, one per run outcome. */
const COLORS: Record<RunStatus, string> = {
  success:     'bg-success',
  failure:     'bg-error',
  cancelled:   'bg-warning',
  skipped:     'bg-muted',
  in_progress: 'bg-info',
  queued:      'bg-info',
  unknown:     'bg-muted',
};

/**
 * Renders a workflow run (or job, or step) outcome using the same badge Rancher
 * uses for resource state, so these tables read like every other list view.
 */
export default defineComponent({
  name: 'RunStatusBadge',

  components: { BadgeState },

  props: {
    status: {
      type:     String as PropType<RunStatus>,
      required: true,
    },

    /** Render just the dot, for the dense per-stage columns on the dashboard */
    compact: {
      type:    Boolean,
      default: false,
    },
  },

  computed: {
    color(): string {
      return COLORS[this.status] || COLORS.unknown;
    },

    label(): string {
      return this.t(`extensionsCenter.status.${ this.status }`);
    },
  },
});
</script>

<template>
  <span
    v-if="compact"
    v-clean-tooltip="label"
    class="status-dot"
    :class="color"
    role="img"
    :aria-label="label"
  />
  <BadgeState
    v-else
    :color="color"
    :label="label"
  />
</template>

<style lang="scss" scoped>
.status-dot {
  display: inline-block;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  vertical-align: middle;
}
</style>
