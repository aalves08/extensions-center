<script lang="ts">
import { defineComponent, PropType } from 'vue';
import { RouteLocationRaw } from 'vue-router';
import AsyncButton from '@shell/components/AsyncButton.vue';

/**
 * Header shared by every data section: title, an optional link through to the
 * full list view, a refresh action and when the data was last fetched.
 *
 * Nothing in this extension is persisted, so "last refreshed" is the only
 * signal a user has for how current a table is — it is deliberately part of the
 * header rather than tucked away.
 */
export default defineComponent({
  name: 'SectionHeader',

  components: { AsyncButton },

  props: {
    title: {
      type:     String,
      required: true,
    },

    description: {
      type:    String,
      default: null,
    },

    /** Route for the "view all" link. Omit to hide the link. */
    viewAllTo: {
      type:    Object as PropType<RouteLocationRaw | null>,
      default: null,
    },

    lastRefreshed: {
      type:    Date as PropType<Date | null>,
      default: null,
    },

    loading: {
      type:    Boolean,
      default: false,
    },

    /** Smaller heading, for cards sitting inside the dashboard grid */
    compact: {
      type:    Boolean,
      default: false,
    },

    /**
     * Caption under the refresh button for tables that are expensive to refresh.
     *
     * Most tables here re-fetch a page of GitHub data and cost nothing but
     * time. The known-extensions table re-runs a code search and two calls per
     * repo found, so pressing refresh there should be a deliberate act rather
     * than a reflex.
     */
    refreshHint: {
      type:    String,
      default: null,
    },
  },

  emits: ['refresh'],

  computed: {
    refreshedLabel(): string {
      if (!this.lastRefreshed) {
        return this.t('extensionsCenter.common.neverRefreshed');
      }

      return this.t('extensionsCenter.common.lastRefreshed', { value: this.lastRefreshed.toLocaleString() });
    },
  },

  methods: {
    onRefresh(done: (ok: boolean) => void) {
      this.$emit('refresh', done);
    },
  },
});
</script>

<template>
  <div class="section-header">
    <div class="titles">
      <component
        :is="compact ? 'h3' : 'h2'"
        class="title"
      >
        {{ title }}
        <router-link
          v-if="viewAllTo"
          :to="viewAllTo"
          class="view-all"
        >
          {{ t('extensionsCenter.common.viewAll') }}
        </router-link>
      </component>
      <p
        v-if="description"
        class="description text-muted"
      >
        {{ description }}
      </p>
    </div>

    <div class="controls">
      <div class="controls-row">
        <span class="refreshed text-muted">{{ refreshedLabel }}</span>
        <AsyncButton
          mode="refresh"
          size="sm"
          :action-label="t('extensionsCenter.common.refresh')"
          :waiting-label="t('extensionsCenter.common.refreshing')"
          :disabled="loading"
          @click="onRefresh"
        />
      </div>
      <span
        v-if="refreshHint"
        class="refresh-hint text-muted"
      >
        <i class="icon icon-warning" />
        {{ refreshHint }}
      </span>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.section-header {
  align-items: flex-start;
  display: flex;
  gap: 16px;
  justify-content: space-between;
  margin-bottom: 12px;

  .titles {
    min-width: 0;
  }

  .title {
    margin: 0;
  }

  .view-all {
    font-size: 13px;
    font-weight: normal;
    margin-left: 8px;
  }

  .description {
    margin: 4px 0 0;
  }

  .controls {
    align-items: flex-end;
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    gap: 4px;
  }

  .controls-row {
    align-items: center;
    display: flex;
    gap: 12px;
  }

  .refreshed {
    font-size: 12px;
    white-space: nowrap;
  }

  // Sits under the button it describes rather than beside it, where it was
  // competing with the button for the same row. Muted rather than `--warning`:
  // caption-sized amber text is close to unreadable on either theme, and the
  // icon carries the warning on its own.
  .refresh-hint {
    align-items: center;
    display: flex;
    font-size: 11px;
    gap: 4px;
    max-width: 260px;
    text-align: right;

    .icon {
      // color: var(--warning);
      flex-shrink: 0;
    }
  }
}
</style>
