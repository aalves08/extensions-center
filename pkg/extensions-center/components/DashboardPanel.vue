<script lang="ts">
import { defineComponent } from 'vue';
import { Banner } from '@components/Banner';

import SectionHeader from './SectionHeader.vue';

/**
 * A single tile in the dashboard grid: header, error banner, content.
 *
 * `@components/Card` is built around a footer with actions, which none of these
 * tiles have, so this uses the same border/background tokens directly to stay
 * visually consistent without fighting that component's slots.
 */
export default defineComponent({
  name: 'DashboardPanel',

  components: { Banner, SectionHeader },

  props: {
    title: {
      type:     String,
      required: true,
    },

    viewAllTo: {
      type:    Object,
      default: null,
    },

    lastRefreshed: {
      type:    Date,
      default: null,
    },

    loading: {
      type:    Boolean,
      default: false,
    },

    error: {
      type:    String,
      default: null,
    },

    /** Hide the header controls for tiles that hold no fetched data */
    static: {
      type:    Boolean,
      default: false,
    },

    /** Warning shown beside refresh when refreshing this tile is expensive */
    refreshHint: {
      type:    String,
      default: null,
    },
  },

  emits: ['refresh'],
});
</script>

<template>
  <div class="dashboard-panel">
    <SectionHeader
      v-if="!static"
      compact
      :title="title"
      :view-all-to="viewAllTo"
      :last-refreshed="lastRefreshed"
      :loading="loading"
      :refresh-hint="refreshHint"
      @refresh="$emit('refresh', $event)"
    />
    <h3
      v-else
      class="static-title"
    >
      {{ title }}
    </h3>

    <Banner
      v-if="error"
      color="error"
      :label="error"
    />

    <div class="panel-body">
      <slot />
    </div>
  </div>
</template>

<style lang="scss" scoped>
.dashboard-panel {
  background: var(--box-bg);
  border: 1px solid var(--border);
  border-radius: var(--border-radius);
  display: flex;
  flex-direction: column;
  min-width: 0;
  padding: 16px;

  .static-title {
    margin: 0 0 12px;
  }

  .panel-body {
    flex: 1;
    min-width: 0;
  }
}
</style>
