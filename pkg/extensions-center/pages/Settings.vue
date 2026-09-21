<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useStore } from 'vuex';
import { Banner } from '@components/Banner';
import { LabeledInput } from '@components/Form/LabeledInput';
import LabeledSelect from '@shell/components/form/LabeledSelect.vue';
import AsyncButton from '@shell/components/AsyncButton.vue';

import {
  CONFIG_NAMESPACE, CONFIG_SECRET_NAME, DEFAULT_AWS_REGION, DEFAULT_CLAUDE_AWS_REGION,
  DEFAULT_MODELS, LLM_PROVIDERS, SECRET_KEYS
} from '../config/constants';
import { useExtensionConfig } from '../composables/useExtensionConfig';
import { LlmProvider } from '../types/common';
import { errorMessage } from '../types/rancher';

type Done = (ok: boolean) => void;

defineOptions({ name: 'ExtensionsCenterSettings' });

const store = useStore();
const {
  config, hasGithubToken, canManage, load, save, clear
} = useExtensionConfig(store);

/**
 * Credential inputs are write-only on purpose: stored values are never read
 * back into the form, so a saved credential cannot be recovered through the UI.
 * Blank means "leave as-is". The non-secret settings next to them — provider,
 * model, region — are ordinary fields and do round-trip.
 */
const githubToken = ref('');
const anthropicKey = ref('');
const awsAccessKeyId = ref('');
const awsSecretAccessKey = ref('');
const awsSessionToken = ref('');
const claudeAwsApiKey = ref('');

const provider = ref<LlmProvider>('anthropic');
const model = ref('');
const awsRegion = ref('');
const claudeAwsWorkspaceId = ref('');
const claudeAwsRegion = ref('');

const message = ref<string | null>(null);
const messageColor = ref<'success' | 'error'>('success');

const t = (key: string, args?: Record<string, unknown>) => store.getters['i18n/t'](key, args);

const description = computed(() => t('extensionsCenter.settings.description', { secret: CONFIG_SECRET_NAME, namespace: CONFIG_NAMESPACE }));

const permissionMessage = computed(() => t('extensionsCenter.settings.permissionDenied', { namespace: CONFIG_NAMESPACE }));

const providerOptions = computed(() => LLM_PROVIDERS.map((value) => ({
  value,
  label: t(`extensionsCenter.settings.provider.options.${ value }`),
})));

/** Placeholder doubles as documentation of the default when left blank. */
const modelPlaceholder = computed(() => DEFAULT_MODELS[provider.value]);

/** Whether the selected provider currently has a stored credential. */
const providerConfigured = computed((): boolean => {
  switch (provider.value) {
  case 'bedrock':
    return !!config.value.awsAccessKeyId && !!config.value.awsSecretAccessKey;
  case 'claudeAws':
    return !!config.value.claudeAwsApiKey;
  default:
    return !!config.value.anthropicApiKey;
  }
});

/** Copy the stored non-secret settings into the form. */
function resetFromConfig() {
  provider.value = config.value.llmProvider;
  model.value = config.value.llmModel || '';
  awsRegion.value = config.value.awsRegion || '';
  claudeAwsWorkspaceId.value = config.value.claudeAwsWorkspaceId || '';
  claudeAwsRegion.value = config.value.claudeAwsRegion || '';
}

// The model id is provider-specific, so a stale override from another provider
// would be worse than no override at all.
watch(provider, (next, previous) => {
  if (previous && next !== previous) {
    model.value = next === config.value.llmProvider ? config.value.llmModel || '' : '';
  }
});

function show(text: string, color: 'success' | 'error') {
  message.value = text;
  messageColor.value = color;
}

async function onSave(done: Done) {
  message.value = null;

  try {
    await save({
      githubToken:        githubToken.value,
      anthropicApiKey:    anthropicKey.value,
      awsAccessKeyId:     awsAccessKeyId.value,
      awsSecretAccessKey: awsSecretAccessKey.value,
      awsSessionToken:    awsSessionToken.value,
      claudeAwsApiKey:    claudeAwsApiKey.value,
      llmProvider:        provider.value,
      llmModel:           model.value,
      awsRegion:          awsRegion.value,

      claudeAwsWorkspaceId: claudeAwsWorkspaceId.value,
      claudeAwsRegion:      claudeAwsRegion.value,
    });

    githubToken.value = '';
    anthropicKey.value = '';
    awsAccessKeyId.value = '';
    awsSecretAccessKey.value = '';
    awsSessionToken.value = '';
    claudeAwsApiKey.value = '';

    resetFromConfig();
    show(t('extensionsCenter.settings.saved'), 'success');
    done(true);
  } catch (e) {
    show(t('extensionsCenter.settings.saveFailed', { message: errorMessage(e) }), 'error');
    done(false);
  }
}

async function onClear(keys: string[]) {
  message.value = null;

  try {
    await clear(keys);
    show(t('extensionsCenter.settings.cleared'), 'success');
  } catch (e) {
    show(t('extensionsCenter.settings.saveFailed', { message: errorMessage(e) }), 'error');
  }
}

/** Clears every credential belonging to the selected provider at once. */
function clearProvider() {
  switch (provider.value) {
  case 'bedrock':
    return onClear([SECRET_KEYS.AWS_ACCESS_KEY_ID, SECRET_KEYS.AWS_SECRET_ACCESS_KEY, SECRET_KEYS.AWS_SESSION_TOKEN]);
  case 'claudeAws':
    return onClear([SECRET_KEYS.CLAUDE_AWS_API_KEY]);
  default:
    return onClear([SECRET_KEYS.ANTHROPIC_KEY]);
  }
}

onMounted(async() => {
  await load(true);
  resetFromConfig();
});
</script>

<template>
  <div class="settings">
    <h1>{{ t('extensionsCenter.settings.title') }}</h1>
    <p class="text-muted">
      {{ description }}
    </p>

    <Banner
      v-if="!canManage"
      color="warning"
      :label="permissionMessage"
    />

    <Banner
      v-if="message"
      :color="messageColor"
      :label="message"
    />

    <form
      class="form"
      @submit.prevent
    >
      <div class="field">
        <LabeledInput
          v-model:value="githubToken"
          type="password"
          autocomplete="off"
          :label="t('extensionsCenter.settings.githubToken.label')"
          :placeholder="t('extensionsCenter.settings.githubToken.placeholder')"
          :tooltip="t('extensionsCenter.settings.githubToken.tooltip')"
          :disabled="!canManage"
        />
        <div class="field-meta">
          <span :class="hasGithubToken ? 'text-success' : 'text-muted'">
            {{ hasGithubToken ? t('extensionsCenter.settings.configured') : t('extensionsCenter.settings.notConfigured') }}
          </span>
          <button
            v-if="hasGithubToken && canManage"
            type="button"
            class="btn btn-sm role-link"
            @click="onClear([SECRET_KEYS.GITHUB_TOKEN])"
          >
            {{ t('extensionsCenter.settings.clear') }}
          </button>
        </div>
      </div>

      <!-- AI PROVIDERS SETTINGS - disconnected for now as needs additional work
      <hr>

      <h3>{{ t('extensionsCenter.settings.provider.sectionTitle') }}</h3>
      <p class="text-muted section-hint">
        {{ t('extensionsCenter.settings.provider.sectionHint') }}
      </p>

      <div class="field">
        <LabeledSelect
          v-model:value="provider"
          :options="providerOptions"
          :label="t('extensionsCenter.settings.provider.label')"
          :tooltip="t('extensionsCenter.settings.provider.tooltip')"
          :disabled="!canManage"
        />
        <div class="field-meta">
          <span :class="providerConfigured ? 'text-success' : 'text-muted'">
            {{ providerConfigured ? t('extensionsCenter.settings.configured') : t('extensionsCenter.settings.notConfigured') }}
          </span>
          <button
            v-if="providerConfigured && canManage"
            type="button"
            class="btn btn-sm role-link"
            @click="clearProvider()"
          >
            {{ t('extensionsCenter.settings.clear') }}
          </button>
        </div>
      </div>

      <div
        v-if="provider === 'anthropic'"
        class="field"
      >
        <LabeledInput
          v-model:value="anthropicKey"
          type="password"
          autocomplete="off"
          :label="t('extensionsCenter.settings.anthropicKey.label')"
          :placeholder="t('extensionsCenter.settings.anthropicKey.placeholder')"
          :tooltip="t('extensionsCenter.settings.anthropicKey.tooltip')"
          :disabled="!canManage"
        />
      </div>

      <template v-if="provider === 'bedrock'">
        <div class="field">
          <LabeledInput
            v-model:value="awsAccessKeyId"
            type="password"
            autocomplete="off"
            :label="t('extensionsCenter.settings.aws.accessKeyId.label')"
            :placeholder="t('extensionsCenter.settings.aws.accessKeyId.placeholder')"
            :disabled="!canManage"
          />
        </div>

        <div class="field">
          <LabeledInput
            v-model:value="awsSecretAccessKey"
            type="password"
            autocomplete="off"
            :label="t('extensionsCenter.settings.aws.secretAccessKey.label')"
            :disabled="!canManage"
          />
        </div>

        <div class="field">
          <LabeledInput
            v-model:value="awsSessionToken"
            type="password"
            autocomplete="off"
            :label="t('extensionsCenter.settings.aws.sessionToken.label')"
            :tooltip="t('extensionsCenter.settings.aws.sessionToken.tooltip')"
            :disabled="!canManage"
          />
        </div>

        <div class="field">
          <LabeledInput
            v-model:value="awsRegion"
            :label="t('extensionsCenter.settings.aws.region.label')"
            :placeholder="DEFAULT_AWS_REGION"
            :tooltip="t('extensionsCenter.settings.aws.region.tooltip')"
            :disabled="!canManage"
          />
        </div>
      </template>

      <template v-if="provider === 'claudeAws'">
        <div class="field">
          <LabeledInput
            v-model:value="claudeAwsApiKey"
            type="password"
            autocomplete="off"
            :label="t('extensionsCenter.settings.claudeAws.apiKey.label')"
            :tooltip="t('extensionsCenter.settings.claudeAws.apiKey.tooltip')"
            :disabled="!canManage"
          />
        </div>

        <div class="field">
          <LabeledInput
            v-model:value="claudeAwsWorkspaceId"
            :label="t('extensionsCenter.settings.claudeAws.workspaceId.label')"
            :placeholder="t('extensionsCenter.settings.claudeAws.workspaceId.placeholder')"
            :tooltip="t('extensionsCenter.settings.claudeAws.workspaceId.tooltip')"
            :disabled="!canManage"
          />
        </div>

        <div class="field">
          <LabeledInput
            v-model:value="claudeAwsRegion"
            :label="t('extensionsCenter.settings.claudeAws.region.label')"
            :placeholder="DEFAULT_CLAUDE_AWS_REGION"
            :tooltip="t('extensionsCenter.settings.claudeAws.region.tooltip')"
            :disabled="!canManage"
          />
        </div>
      </template>

      <div class="field">
        <LabeledInput
          v-model:value="model"
          :label="t('extensionsCenter.settings.model.label')"
          :placeholder="modelPlaceholder"
          :tooltip="t('extensionsCenter.settings.model.tooltip')"
          :disabled="!canManage"
        />
      </div>

      <p class="text-muted hint">
        {{ t('extensionsCenter.settings.leaveBlank') }}
      </p>-->

      <AsyncButton
        mode="apply"
        :action-label="t('extensionsCenter.settings.save')"
        :waiting-label="t('extensionsCenter.settings.saving')"
        :disabled="!canManage"
        @click="onSave"
      />
    </form>
  </div>
</template>

<style lang="scss" scoped>
.settings {
  max-width: 640px;
  padding-bottom: 40px;

  h1 {
    margin: 0;
  }

  h3 {
    margin: 0;
  }

  > p {
    margin: 4px 0 16px;
  }

  hr {
    border: none;
    border-top: 1px solid var(--border);
    margin: 4px 0;
  }

  .form {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .section-hint {
    font-size: 12px;
    margin: -12px 0 0;
  }

  .field-meta {
    align-items: center;
    display: flex;
    font-size: 12px;
    gap: 8px;
    margin-top: 4px;
  }

  .hint {
    font-size: 12px;
    margin: 0;
  }
}
</style>
