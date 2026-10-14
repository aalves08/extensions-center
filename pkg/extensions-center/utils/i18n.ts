import { defineComponent } from 'vue';
import { useStore } from 'vuex';

/**
 * A `t()` that does not HTML-escape its result.
 *
 * Shell installs `t` as a global property (`@rancher/shell/plugins/i18n.js`)
 * that ends in `escapeHtml(out)` unless you pass `raw`. That is correct for
 * the `v-t` directive it was written for, which assigns the result to
 * `innerHTML` — the browser decodes the entities on the way in.
 *
 * It is wrong for `{{ t('some.key') }}`. A mustache sets *text*, so nothing
 * ever decodes the entities and the user reads `shell&#39;s own screens`
 * on the page. Same for `:title="t(...)"` and any other attribute binding.
 *
 * Five characters are affected: `& < > " '`. An apostrophe in an English
 * sentence is the one that bites, because it is easy to write and the damage
 * is only visible at runtime — neither `tsc` nor ESLint has anything to say
 * about it.
 *
 * The store getter underneath does the interpolation without the escaping, so
 * both helpers below just call it directly. Importantly they are named `t`
 * at the call site, which shadows shell's global inside the component and
 * leaves every existing `{{ t(...) }}` untouched.
 *
 * Passing `t(key, args, true)` to shell's global would work too, but it has to
 * be remembered at every one of a few hundred call sites, and forgetting it
 * fails silently.
 */

export type Translate = (key: string, args?: Record<string, unknown>) => string;

/** For `<script setup>` components. */
export function useTranslation(): Translate {
  const store = useStore();

  return (key, args) => store.getters['i18n/t'](key, args);
}

/**
 * For the Options API components in this extension.
 *
 * A `methods.t` wins over `globalProperties.t` in Vue's instance proxy, so
 * mixing this in is enough — `this.t(...)` in a computed and `{{ t(...) }}` in
 * the template both resolve here.
 */
export const i18nMixin = defineComponent({
  methods: {
    t(key: string, args?: Record<string, unknown>): string {
      return this.$store.getters['i18n/t'](key, args);
    },
  },
});
