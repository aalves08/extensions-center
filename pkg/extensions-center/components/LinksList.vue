<script lang="ts">
import { defineComponent } from 'vue';

import { IMPORTANT_LINKS } from '../config/links';

/** The curated Confluence links, rendered as a plain external link list. */
export default defineComponent({
  name: 'LinksList',

  computed: {
    links() {
      return IMPORTANT_LINKS;
    },
  },
});
</script>

<template>
  <ul class="links-list">
    <li
      v-for="link in links"
      :key="link.url"
    >
      <a
        :href="link.url"
        target="_blank"
        rel="noopener noreferrer"
      >
        {{ link.label }}
        <i class="icon icon-external-link" />
      </a>
      <p class="text-muted">
        {{ link.description }}
      </p>
    </li>
  </ul>
</template>

<style lang="scss" scoped>
.links-list {
  list-style: none;
  margin: 0;
  padding: 0;

  li + li {
    margin-top: 12px;
  }

  a {
    font-weight: 500;
  }

  p {
    font-size: 12px;
    margin: 2px 0 0;
  }

  .icon-external-link {
    font-size: 12px;
  }
}
</style>
