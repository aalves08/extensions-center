import { ref, computed, Ref } from 'vue';

import { SECRET } from '@shell/config/types';
import { base64Decode, base64Encode } from '@shell/utils/crypto';

import {
  CONFIG_NAMESPACE,
  CONFIG_SECRET_NAME,
  CONFIG_SECRET_ID,
  DEFAULT_LLM_PROVIDER,
  LLM_PROVIDERS,
  SECRET_KEYS
} from '../config/constants';
import { ExtensionConfig, LlmProvider } from '../types/common';
import { RancherStore, SteveResource, SteveSchema, storeErrorStatus } from '../types/rancher';

const EMPTY: ExtensionConfig = {
  githubToken:        null,
  llmProvider:        DEFAULT_LLM_PROVIDER,
  llmModel:           null,
  anthropicApiKey:    null,
  awsAccessKeyId:     null,
  awsSecretAccessKey: null,
  awsSessionToken:    null,
  awsRegion:          null,

  claudeAwsApiKey:      null,
  claudeAwsWorkspaceId: null,
  claudeAwsRegion:      null,
};

function isProvider(value: string | null): value is LlmProvider {
  return !!value && (LLM_PROVIDERS as readonly string[]).includes(value);
}

/** True when the selected provider has everything it needs to be called. */
export function hasLlmCredentials(cfg: ExtensionConfig): boolean {
  switch (cfg.llmProvider) {
  case 'bedrock':
    return !!cfg.awsAccessKeyId && !!cfg.awsSecretAccessKey;
  case 'claudeAws':
    // The workspace id is not optional and not derivable from the key, so a
    // key on its own is not a usable credential here.
    return !!cfg.claudeAwsApiKey && !!cfg.claudeAwsWorkspaceId && !!cfg.claudeAwsRegion;
  default:
    return !!cfg.anthropicApiKey;
  }
}

/** Everything the Settings form can write. All optional — blank means "skip". */
export type SaveValues = Partial<Record<
  'githubToken' | 'anthropicApiKey' | 'awsAccessKeyId' | 'awsSecretAccessKey' |
  'awsSessionToken' | 'claudeAwsApiKey' | 'llmProvider' | 'llmModel' |
  'awsRegion' | 'claudeAwsWorkspaceId' | 'claudeAwsRegion',
  string
>>;

/** Write-only credentials: a blank value leaves what is stored alone. */
const CREDENTIAL_FIELDS: [keyof SaveValues, string][] = [
  ['githubToken', SECRET_KEYS.GITHUB_TOKEN],
  ['anthropicApiKey', SECRET_KEYS.ANTHROPIC_KEY],
  ['awsAccessKeyId', SECRET_KEYS.AWS_ACCESS_KEY_ID],
  ['awsSecretAccessKey', SECRET_KEYS.AWS_SECRET_ACCESS_KEY],
  ['awsSessionToken', SECRET_KEYS.AWS_SESSION_TOKEN],
  ['claudeAwsApiKey', SECRET_KEYS.CLAUDE_AWS_API_KEY],
];

/** Plain settings, shown back to the user: a blank value clears them. */
const PLAIN_FIELDS: [keyof SaveValues, string][] = [
  ['llmProvider', SECRET_KEYS.LLM_PROVIDER],
  ['llmModel', SECRET_KEYS.LLM_MODEL],
  ['awsRegion', SECRET_KEYS.AWS_REGION],
  ['claudeAwsWorkspaceId', SECRET_KEYS.CLAUDE_AWS_WORKSPACE_ID],
  ['claudeAwsRegion', SECRET_KEYS.CLAUDE_AWS_REGION],
];

/**
 * Module-level cache.
 *
 * Credentials live in a Secret in the local cluster and change very rarely, so
 * every composable that needs them shares a single in-memory copy rather than
 * hitting the API on each page mount. `save` and `clear` keep it in sync;
 * nothing else writes to it.
 */
const config: Ref<ExtensionConfig> = ref({ ...EMPTY });
const loaded = ref(false);
let inFlight: Promise<ExtensionConfig> | null = null;

function decodeSecret(secret: SteveResource | null): ExtensionConfig {
  const data = secret?.data || {};

  const read = (key: string): string | null => {
    const raw = data[key];

    if (!raw) {
      return null;
    }

    const value = base64Decode(raw).trim();

    return value.length ? value : null;
  };

  const provider = read(SECRET_KEYS.LLM_PROVIDER);

  return {
    githubToken:        read(SECRET_KEYS.GITHUB_TOKEN),
    llmProvider:        isProvider(provider) ? provider : DEFAULT_LLM_PROVIDER,
    llmModel:           read(SECRET_KEYS.LLM_MODEL),
    anthropicApiKey:    read(SECRET_KEYS.ANTHROPIC_KEY),
    awsAccessKeyId:     read(SECRET_KEYS.AWS_ACCESS_KEY_ID),
    awsSecretAccessKey: read(SECRET_KEYS.AWS_SECRET_ACCESS_KEY),
    awsSessionToken:    read(SECRET_KEYS.AWS_SESSION_TOKEN),
    awsRegion:          read(SECRET_KEYS.AWS_REGION),

    claudeAwsApiKey:      read(SECRET_KEYS.CLAUDE_AWS_API_KEY),
    claudeAwsWorkspaceId: read(SECRET_KEYS.CLAUDE_AWS_WORKSPACE_ID),
    claudeAwsRegion:      read(SECRET_KEYS.CLAUDE_AWS_REGION),
  };
}

/**
 * Fetch the config Secret. A missing Secret is a normal first-run state, not an
 * error — the extension degrades to unauthenticated GitHub calls and metadata
 * only descriptions until someone fills the Settings page in.
 */
async function fetchConfig(store: RancherStore): Promise<ExtensionConfig> {
  try {
    const secret: SteveResource = await store.dispatch('management/find', {
      type: SECRET,
      id:   CONFIG_SECRET_ID,
      opt:  { force: true },
    });

    return decodeSecret(secret);
  } catch (e) {
    const status = storeErrorStatus(e);

    // 404: not created yet. 403: caller cannot read Secrets. Either way we run
    // in degraded mode rather than blocking the whole dashboard.
    if (status !== 404 && status !== 403) {
      console.warn('extensions-center: failed to read config secret', e); // eslint-disable-line no-console
    }

    return { ...EMPTY };
  }
}

export function useExtensionConfig(store: RancherStore) {
  const load = async(force = false): Promise<ExtensionConfig> => {
    if (loaded.value && !force) {
      return config.value;
    }

    // Collapse concurrent callers onto one request — several composables load
    // in parallel on the dashboard.
    if (!inFlight || force) {
      inFlight = fetchConfig(store).then((result) => {
        config.value = result;
        loaded.value = true;
        inFlight = null;

        return result;
      });
    }

    return inFlight;
  };

  const findSecret = async(): Promise<SteveResource | null> => {
    try {
      return await store.dispatch('management/find', {
        type: SECRET,
        id:   CONFIG_SECRET_ID,
        opt:  { force: true },
      });
    } catch (e) {
      if (storeErrorStatus(e) === 404) {
        return null;
      }

      throw e;
    }
  };

  /**
   * Create or patch the Secret.
   *
   * Credentials are write-only: a blank one means "leave as-is", so the form can
   * update the provider or a region without the user re-typing their key. The
   * non-secret settings alongside them (provider, model, regions) are plain
   * values, so a blank there really does mean "clear it".
   */
  const save = async(values: SaveValues): Promise<void> => {
    const secret = await findSecret();
    const data: Record<string, string> = { ...(secret?.data || {}) };

    CREDENTIAL_FIELDS.forEach(([field, key]) => {
      const value = values[field]?.trim();

      if (value) {
        data[key] = base64Encode(value);
      }
    });

    PLAIN_FIELDS.forEach(([field, key]) => {
      const value = values[field]?.trim();

      if (value === undefined) {
        return;
      }

      if (value) {
        data[key] = base64Encode(value);
      } else {
        delete data[key];
      }
    });

    if (secret) {
      secret.data = data;
      await secret.save();
    } else {
      const created: SteveResource = await store.dispatch('management/create', {
        type:     SECRET,
        metadata: { name: CONFIG_SECRET_NAME, namespace: CONFIG_NAMESPACE },
        _type:    'Opaque',
        data,
      });

      await created.save();
    }

    await load(true);
  };

  /** Remove one or both credentials from the Secret. */
  const clear = async(keys: string[]): Promise<void> => {
    const secret = await findSecret();

    if (!secret) {
      return;
    }

    const data = { ...(secret.data || {}) };

    keys.forEach((k) => delete data[k]);

    secret.data = data;
    await secret.save();

    await load(true);
  };

  /** Whether the current user may create/update Secrets in our namespace. */
  const canManage = computed((): boolean => {
    const schema: SteveSchema | undefined = store.getters['management/schemaFor'](SECRET);

    return (schema?.collectionMethods || []).some((m) => m.toLowerCase() === 'post');
  });

  return {
    config:         computed(() => config.value),
    hasGithubToken: computed(() => !!config.value.githubToken),
    /** Whether the selected provider is usable — what the classifier gates on */
    hasLlmAccess:   computed(() => hasLlmCredentials(config.value)),
    loaded:         computed(() => loaded.value),
    canManage,
    load,
    save,
    clear,
  };
}
