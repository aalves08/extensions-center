<script lang="ts">
import { defineComponent, PropType } from 'vue';
import { Banner } from '@components/Banner';

import { ManifestPr } from '../types/manifestPr';

/** Changes spelled out before the rest collapse into a count. */
const SHOWN_CHANGES = 3;

/**
 * One open PR against the official extensions manifest, as a single line.
 *
 * One banner per PR, and each is deliberately one row high: these sit above the
 * dashboard proper, and three of them stacked must not push the tables off the
 * fold. So the PR title is not shown — what it does to the manifest is the
 * thing worth reading, and the title repeats it badly most of the time.
 */
export default defineComponent({
  name: 'ManifestPrBanner',

  components: { Banner },

  props: {
    pr: {
      type:     Object as PropType<ManifestPr>,
      required: true,
    },
  },

  computed: {
    /** `kubewarden +4.2.2, locales (new) 0.1.2` */
    summary(): string {
      const { changes } = this.pr;

      if (!changes.length) {
        return this.t('extensionsCenter.dashboard.manifestPr.noChange');
      }

      const shown = changes.slice(0, SHOWN_CHANGES).map((c) => {
        return this.t(`extensionsCenter.dashboard.manifestPr.change.${ c.kind }`, {
          extension: c.extension,
          versions:  c.versions.join(', '),
        });
      });

      const rest = changes.length - shown.length;

      if (rest > 0) {
        shown.push(this.t('extensionsCenter.dashboard.manifestPr.more', { count: rest }));
      }

      return shown.join(', ');
    },
  },
});
</script>

<template>
  <Banner
    color="info"
    class="manifest-pr"
  >
    <div class="banner-content">
      <span class="summary">
        <strong>{{ t('extensionsCenter.dashboard.manifestPr.prefix') }}</strong>
        #{{ pr.number }}
        <span
          v-if="pr.draft"
          class="text-muted"
        >{{ t('extensionsCenter.dashboard.manifestPr.draft') }}</span>
        {{ summary }}
      </span>

      <a
        :href="pr.url"
        target="_blank"
        rel="noopener noreferrer"
        class="btn btn-sm role-secondary"
      >
        {{ t('extensionsCenter.dashboard.manifestPr.view') }}
        <i class="icon icon-external-link" />
      </a>
    </div>
  </Banner>
</template>

<style lang="scss" scoped>
.manifest-pr {
  margin: 0;

  .banner-content {
    align-items: center;
    display: flex;
    gap: 16px;
    justify-content: space-between;
    width: 100%;
  }

  // One line, truncated rather than wrapped: a manifest PR that touches a dozen
  // extensions would otherwise be the tallest thing on the page.
  .summary {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;

    strong {
      margin-right: 4px;
    }
  }

  .btn {
    flex-shrink: 0;
  }
}
</style>
