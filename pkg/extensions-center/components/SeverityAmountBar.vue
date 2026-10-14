<script setup lang="ts">
import { computed } from 'vue';
import { useStore } from 'vuex';

import { Severity, SEVERITIES } from '../types/security';

/**
 * Every severity's count for one subject, in one strip.
 *
 * The sanctioned control for a severity breakdown (SUSE Security's
 * `AmountBarBySeverity`), used here in place of one numeric column per
 * severity. Five columns of digits make a reader compare numbers; the strip
 * makes the shape of a repo's exposure legible without reading any of them.
 */
const props = defineProps<{ counts: Record<Severity, number> }>();

const store = useStore();

const segments = computed(() => SEVERITIES.map((severity) => ({
  severity,
  count: props.counts[severity] || 0,
  label: store.getters['i18n/t'](`extensionsCenter.security.severity.${ severity }`) as string,
})));
</script>

<template>
  <div class="sev-bar">
    <!--
      Every segment names its own severity in `title`. The order is fixed and
      the colours are learnable, but neither is available to a screen reader or
      in greyscale, so colour is never the only carrier.
    -->
    <div
      v-for="segment in segments"
      :key="segment.severity"
      class="sev-seg"
      :class="segment.count ? segment.severity : 'zero'"
      :title="`${ segment.label }: ${ segment.count }`"
    >
      {{ segment.count }}
    </div>
  </div>
</template>

<style lang="scss" scoped>
// `@import`, not `@use` — shell prepends its own `@import`s to every style
// block, so a `@use` here is never the first rule. See `_severity.scss`.
@import '../styles/severity';

.sev-bar {
  align-items: center;
  border-radius: 4px;
  display: flex;
  height: 24px;
  overflow: hidden;
  text-align: center;
}

.sev-seg {
  align-items: center;
  align-self: stretch;
  display: flex;
  flex: 1 0 0;
  font-size: 13px;
  justify-content: center;
  line-height: 20px;
  padding: 0 2px;

  @include severity-fill;
}

// A zero segment keeps its slot rather than collapsing: dropping it would
// change the strip's proportions from row to row, and "no criticals" is
// precisely the thing worth seeing at a glance.
.sev-seg.zero {
  background: $zero-color-light;
  color: var(--disabled-text);

  body.theme-dark & {
    background: $zero-color-dark;
  }
}
</style>
