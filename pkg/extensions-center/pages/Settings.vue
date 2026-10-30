<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useStore } from 'vuex';
import { Banner } from '@components/Banner';
import { LabeledInput } from '@components/Form/LabeledInput';
import LabeledSelect from '@shell/components/form/LabeledSelect.vue';
import AsyncButton from '@shell/components/AsyncButton.vue';

import {
  CONFIG_NAMESPACE, CONFIG_SECRET_NAME, DEFAULT_CLAUDE_AWS_REGION, DEFAULT_MODELS,
  DEFAULT_VERTEX_REGION, LLM_PROVIDERS, SECRET_KEYS, STRONGEST_MODEL, TEST_MODEL
} from '../config/constants';
import { useClaude } from '../composables/useClaude';
import { hasLlmCredentials, useExtensionConfig } from '../composables/useExtensionConfig';
import { ExtensionConfig, LlmProvider } from '../types/common';
import { errorMessage } from '../types/rancher';
import { useTranslation } from '../utils/i18n';

const t = useTranslation();

/**
 * The two files the Vertex credentials field accepts, shown under it.
 *
 * Written here rather than in `en-us.yaml` because every `{` in a translation
 * is ICU interpolation and has to be escaped one at a time — which is exactly
 * what white-screened this page once already. These are JSON skeletons, not
 * prose, so there is nothing in them to translate anyway.
 */
const SERVICE_ACCOUNT_EXAMPLE = `{
  "type": "service_account",
  "project_id": "my-project",
  "private_key_id": "…",
  "private_key": "-----BEGIN PRIVATE KEY-----\\n…\\n-----END PRIVATE KEY-----\\n",
  "client_email": "vertex@my-project.iam.gserviceaccount.com",
  "client_id": "…",
  "token_uri": "https://oauth2.googleapis.com/token"
}`;

const AUTHORIZED_USER_EXAMPLE = `{
  "type": "authorized_user",
  "client_id": "….apps.googleusercontent.com",
  "client_secret": "…",
  "refresh_token": "1//…"
}`;

type Done = (ok: boolean) => void;

defineOptions({ name: 'ExtensionsCenterSettings' });

const store = useStore();
const {
  config, hasGithubToken, canManage, load, save, clear
} = useExtensionConfig(store);
const { sendMessage } = useClaude(store);

/**
 * Credential inputs are write-only on purpose: stored values are never read
 * back into the form, so a saved credential cannot be recovered through the UI.
 * Blank means "leave as-is". The non-secret settings next to them — provider,
 * model, region — are ordinary fields and do round-trip.
 */
const githubToken = ref('');
const anthropicKey = ref('');
const vertexServiceAccount = ref('');
const claudeAwsApiKey = ref('');

const provider = ref<LlmProvider>('anthropic');
const model = ref('');
const vertexProjectId = ref('');
const vertexRegion = ref('');
const claudeAwsWorkspaceId = ref('');
const claudeAwsRegion = ref('');

const message = ref<string | null>(null);
const messageColor = ref<'success' | 'error'>('success');

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
  case 'vertex':
    return !!config.value.vertexServiceAccount;
  case 'claudeAws':
    return !!config.value.claudeAwsApiKey;
  default:
    return !!config.value.anthropicApiKey;
  }
});

/**
 * What a call would be made with right now: stored settings, with anything
 * typed into the form laid over the top.
 *
 * So Test connection can be used on a pasted key before it is saved, which is
 * the order people actually work in — and, just as usefully, on a saved one
 * without re-typing it, since credentials never come back out of the Secret.
 */
const candidateConfig = computed((): ExtensionConfig => {
  const over = (typed: string, stored: string | null) => typed.trim() || stored;

  return {
    ...config.value,
    llmProvider:     provider.value,
    llmModel:        model.value.trim() || null,
    anthropicApiKey: over(anthropicKey.value, config.value.anthropicApiKey),

    vertexServiceAccount: over(vertexServiceAccount.value, config.value.vertexServiceAccount),
    vertexProjectId:      over(vertexProjectId.value, config.value.vertexProjectId),
    vertexRegion:         over(vertexRegion.value, config.value.vertexRegion),

    claudeAwsApiKey:      over(claudeAwsApiKey.value, config.value.claudeAwsApiKey),
    claudeAwsWorkspaceId: over(claudeAwsWorkspaceId.value, config.value.claudeAwsWorkspaceId),
    claudeAwsRegion:      over(claudeAwsRegion.value, config.value.claudeAwsRegion),
  };
});

const canTest = computed(() => hasLlmCredentials(candidateConfig.value));

/** Copy the stored non-secret settings into the form. */
function resetFromConfig() {
  provider.value = config.value.llmProvider;
  model.value = config.value.llmModel || '';
  vertexProjectId.value = config.value.vertexProjectId || '';
  vertexRegion.value = config.value.vertexRegion || '';
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
      githubToken:     githubToken.value,
      anthropicApiKey: anthropicKey.value,
      claudeAwsApiKey: claudeAwsApiKey.value,
      llmProvider:     provider.value,
      llmModel:        model.value,

      vertexServiceAccount: vertexServiceAccount.value,
      vertexProjectId:      vertexProjectId.value,
      vertexRegion:         vertexRegion.value,

      claudeAwsWorkspaceId: claudeAwsWorkspaceId.value,
      claudeAwsRegion:      claudeAwsRegion.value,
    });

    githubToken.value = '';
    anthropicKey.value = '';
    vertexServiceAccount.value = '';
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
  case 'vertex':
    return onClear([SECRET_KEYS.VERTEX_SERVICE_ACCOUNT]);
  case 'claudeAws':
    return onClear([SECRET_KEYS.CLAUDE_AWS_API_KEY]);
  default:
    return onClear([SECRET_KEYS.ANTHROPIC_KEY]);
  }
}

/**
 * Make one real call to the selected provider and report what came back.
 *
 * Here because these three fail in ways that are impossible to tell apart
 * from the form: a Bedrock key in the Claude on AWS field, a Vertex model not
 * enabled in Model Garden, a service account without the Vertex AI User role,
 * a region the account has no endpoint in. Each is a perfectly well-formed
 * configuration that only fails when something calls it, so the page lets you
 * call it.
 *
 * Deliberately the smallest possible request — one word in, a handful of
 * tokens out, against the cheapest model rather than the configured one —
 * because it is on a Settings page and gets pressed repeatedly.
 *
 * Thinking is off and the budget is 64 rather than 16 for the same reason the
 * first version of this came back blank: a model that thinks adaptively spends
 * a 16-token budget on the thinking block and stops at `max_tokens` before
 * writing any text, so the banner reported a working connection with nothing
 * in it.
 */
async function onTest(done: Done) {
  message.value = null;

  try {
    const reply = await sendMessage(candidateConfig.value, {
      system:          'You are a connectivity check. Reply with the single word OK.',
      userContent:     'ping',
      maxTokens:       64,
      model:           TEST_MODEL,
      disableThinking: true,
    });

    show(t('extensionsCenter.settings.test.ok', { reply: reply.trim().slice(0, 60) }), 'success');
    done(true);
  } catch (e) {
    show(t('extensionsCenter.settings.test.failed', { message: errorMessage(e) }), 'error');
    done(false);
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

      <template v-if="provider === 'vertex'">
        <div class="field">
          <LabeledInput
            v-model:value="vertexServiceAccount"
            type="multiline-password"
            autocomplete="off"
            :label="t('extensionsCenter.settings.vertex.serviceAccount.label')"
            :placeholder="t('extensionsCenter.settings.vertex.serviceAccount.placeholder')"
            :tooltip="t('extensionsCenter.settings.vertex.serviceAccount.tooltip')"
            :disabled="!canManage"
          />

          <!--
            The field takes a whole file and there are two different ones it
            accepts, neither of which is obvious from a one-line placeholder.
            Showing both skeletons is cheaper than making people find out by
            pasting the wrong one.
          -->
          <div class="examples">
            <p class="text-muted hint">
              {{ t('extensionsCenter.settings.vertex.examples.intro') }}
            </p>

            <p class="hint">
              {{ t('extensionsCenter.settings.vertex.examples.serviceAccount') }}
            </p>
            <pre>{{ SERVICE_ACCOUNT_EXAMPLE }}</pre>

            <p class="hint">
              {{ t('extensionsCenter.settings.vertex.examples.authorizedUser') }}
            </p>
            <pre>{{ AUTHORIZED_USER_EXAMPLE }}</pre>

            <p class="text-muted hint">
              {{ t('extensionsCenter.settings.vertex.examples.note') }}
            </p>
          </div>
        </div>

        <div class="field">
          <LabeledInput
            v-model:value="vertexProjectId"
            :label="t('extensionsCenter.settings.vertex.projectId.label')"
            :tooltip="t('extensionsCenter.settings.vertex.projectId.tooltip')"
            :disabled="!canManage"
          />
        </div>

        <div class="field">
          <LabeledInput
            v-model:value="vertexRegion"
            :label="t('extensionsCenter.settings.vertex.region.label')"
            :placeholder="DEFAULT_VERTEX_REGION"
            :tooltip="t('extensionsCenter.settings.vertex.region.tooltip')"
            :disabled="!canManage"
          />
        </div>

        <Banner
          color="info"
          :label="t('extensionsCenter.settings.vertex.proxyNote')"
        />
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

        <p class="text-muted hint">
          {{ t('extensionsCenter.settings.model.hint', { model: modelPlaceholder, strongest: STRONGEST_MODEL }) }}
        </p>
      </div>

      <p class="text-muted hint">
        {{ t('extensionsCenter.settings.leaveBlank') }}
      </p>

      <!--
        Next to the buttons rather than at the top of the page. Every message
        here is the result of pressing one of them, and with a provider that
        has several fields the form is tall enough that a banner above it
        renders off-screen — which leaves "Failed" on the button as the only
        thing the user sees, and the reason invisible.
      -->
      <Banner
        v-if="message"
        :color="messageColor"
        :label="message"
      />

      <div class="actions">
        <AsyncButton
          mode="apply"
          :action-label="t('extensionsCenter.settings.save')"
          :waiting-label="t('extensionsCenter.settings.saving')"
          :disabled="!canManage"
          @click="onSave"
        />

        <AsyncButton
          class="role-secondary"
          :action-label="t('extensionsCenter.settings.test.label')"
          :waiting-label="t('extensionsCenter.settings.test.waiting')"
          :success-label="t('extensionsCenter.settings.test.success')"
          :error-label="t('extensionsCenter.settings.test.error')"
          :disabled="!canTest"
          @click="onTest"
        />

        <span
          v-if="!canTest"
          class="text-muted hint"
        >{{ t('extensionsCenter.settings.test.needsCredentials') }}</span>
      </div>

      <p class="text-muted hint">
        {{ t('extensionsCenter.settings.test.hint', { model: TEST_MODEL }) }}
      </p>
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

  .examples {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-top: 8px;

    pre {
      background: var(--box-bg);
      border: 1px solid var(--border);
      border-radius: var(--border-radius);
      font-size: 11px;
      margin: 0 0 4px;
      overflow-x: auto;
      padding: 8px 10px;
    }
  }

  .actions {
    align-items: center;
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }
}
</style>
