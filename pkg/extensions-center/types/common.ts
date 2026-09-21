import { Ref } from 'vue';

import { LLM_PROVIDERS } from '../config/constants';

/**
 * Shape every data composable in this extension returns.
 *
 * Nothing here is persisted, so each page owns its own loading/error state and
 * exposes a `refresh` for the button that sits above every table.
 */
export interface AsyncData<T> {
  data: Ref<T>;
  loading: Ref<boolean>;
  /** Translated, user-facing message — null when the last load succeeded */
  error: Ref<string | null>;
  /** When the current `data` was fetched, null before the first load */
  lastRefreshed: Ref<Date | null>;
  refresh: () => Promise<void>;
}

export type LlmProvider = typeof LLM_PROVIDERS[number];

/**
 * Credentials read from the extension's Kubernetes Secret.
 *
 * Every provider's fields are always present but only the selected provider's
 * are used, so switching provider does not throw the other credentials away.
 */
export interface ExtensionConfig {
  githubToken: string | null;

  llmProvider: LlmProvider;
  /** Overrides the provider's default model id when set */
  llmModel: string | null;

  anthropicApiKey: string | null;

  awsAccessKeyId: string | null;
  awsSecretAccessKey: string | null;
  awsSessionToken: string | null;
  awsRegion: string | null;

  /** Workspace API key from the AWS console, not a Bedrock key */
  claudeAwsApiKey: string | null;
  /** `wrkspc_…`, required on every call and not inferable from the key */
  claudeAwsWorkspaceId: string | null;
  claudeAwsRegion: string | null;
}
