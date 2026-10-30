<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useStore } from 'vuex';
import { Banner } from '@components/Banner';
import AsyncButton from '@shell/components/AsyncButton.vue';

import CategorySummaryPanel from '../components/CategorySummary.vue';
import KnownReposTable from '../components/KnownReposTable.vue';
import SectionHeader from '../components/SectionHeader.vue';
import { DASHBOARD_ROW_LIMIT } from '../config/constants';
import { useExtensionConfig } from '../composables/useExtensionConfig';
import { useKnownRepos } from '../composables/useKnownRepos';
import { useTranslation } from '../utils/i18n';

const t = useTranslation();

type Done = (ok: boolean) => void;

const store = useStore();
const knownRepos = useKnownRepos(store);
const { hasLlmAccess, load: loadConfig } = useExtensionConfig(store);

/** Unlike the dashboard tile, this view lists official repos too. */
const description = computed(() => {
  return store.getters['i18n/t']('extensionsCenter.knownRepos.description', { count: DASHBOARD_ROW_LIMIT });
});

const refreshHint = computed(() => store.getters['i18n/t']('extensionsCenter.knownRepos.refreshCost'));

/**
 * Whether the Describe with AI button can do anything.
 *
 * Both halves matter: a provider with no credentials cannot be called, and an
 * empty table has nothing to describe — and the second is the likelier of the
 * two on a first visit, before anyone has built the table.
 */
const canDescribe = computed(() => hasLlmAccess.value && knownRepos.data.value.length > 0);

const describeHint = computed(() => {
  if (!hasLlmAccess.value) {
    return t('extensionsCenter.knownRepos.describe.noCredentials');
  }

  return knownRepos.data.value.length ? '' : t('extensionsCenter.knownRepos.describe.noRows');
});

/**
 * What the next press would send, in rows.
 *
 * Shown next to the per-repo cost rather than left to be inferred from it:
 * "a fifth of a cent per repo" means nothing without knowing how many repos
 * are going, and on a described table the honest answer is usually very few.
 */
const describePending = computed(() => {
  return store.getters['i18n/t']('extensionsCenter.knownRepos.describe.pending', {
    describe: knownRepos.pendingDescribe.value,
    place:    knownRepos.pendingPlace.value,
  });
});

/** Same expensive rebuild as the dashboard tile, and the only thing that runs it. */
async function rebuild(done?: Done) {
  await knownRepos.rebuild();
  done?.(!knownRepos.error.value);
}

/** The one AI-powered action in the product, and it is opt-in on every press. */
async function describe(done: Done) {
  await knownRepos.describe();
  done(!knownRepos.describeError.value);
}

// Reads the saved table. Opening this page costs one Kubernetes call. The
// config load alongside it is what tells the button whether it is usable, and
// is almost always already cached.
onMounted(async() => {
  await Promise.all([knownRepos.load(), loadConfig()]);
});
</script>

<template>
  <div class="known-repos">
    <SectionHeader
      :title="t('extensionsCenter.knownRepos.listTitle')"
      :description="description"
      :last-refreshed="knownRepos.lastRefreshed.value"
      :loading="knownRepos.loading.value"
      :refresh-hint="refreshHint"
      @refresh="rebuild"
    />

    <Banner
      v-if="knownRepos.error.value"
      color="error"
      :label="knownRepos.error.value"
    />

    <Banner
      v-if="knownRepos.needsBuild.value"
      color="info"
      :label="t('extensionsCenter.knownRepos.notBuilt')"
    />

    <Banner
      v-else-if="knownRepos.stale.value"
      color="info"
      :label="t('extensionsCenter.knownRepos.stale')"
    />

    <Banner
      v-if="knownRepos.describeError.value"
      color="error"
      :label="knownRepos.describeError.value"
    />

    <Banner
      v-if="knownRepos.describeNote.value"
      color="info"
      :label="knownRepos.describeNote.value"
    />

    <div class="ai-actions">
      <AsyncButton
        class="role-secondary"
        :action-label="t('extensionsCenter.knownRepos.describe.action')"
        :waiting-label="t('extensionsCenter.knownRepos.describe.waiting')"
        :success-label="t('extensionsCenter.knownRepos.describe.done')"
        :error-label="t('extensionsCenter.knownRepos.describe.failed')"
        :disabled="!canDescribe"
        @click="describe"
      />

      <span class="text-muted hint">
        <template v-if="describeHint">{{ describeHint }}</template>
        <template v-else>
          {{ t('extensionsCenter.knownRepos.describe.hint') }}
          <strong>{{ describePending }}</strong>
        </template>
      </span>
    </div>

    <div class="layout">
      <KnownReposTable
        paging
        :rows="knownRepos.data.value"
        :loading="knownRepos.loading.value"
      />

      <aside>
        <h3>{{ t('extensionsCenter.knownRepos.summary.title') }}</h3>
        <CategorySummaryPanel :summary="knownRepos.summary.value" />
      </aside>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.known-repos {
  padding-bottom: 40px;

  .ai-actions {
    align-items: center;
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    margin-bottom: 16px;

    .hint {
      font-size: 12px;
    }
  }

  .layout {
    display: grid;
    gap: 24px;
    grid-template-columns: minmax(0, 1fr) 280px;
  }

  aside {
    background: var(--box-bg);
    border: 1px solid var(--border);
    border-radius: var(--border-radius);
    height: fit-content;
    padding: 16px;

    h3 {
      margin: 0 0 12px;
    }
  }
}

@media (max-width: 1100px) {
  .known-repos .layout {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
