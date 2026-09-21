import { Store } from 'vuex';

/**
 * The Vuex store as extensions see it.
 *
 * Rancher's root state is not typed for consumers, and this extension only ever
 * touches getters and dispatch, so the state parameter is left unknown rather
 * than pretending to a shape we do not have.
 */
export type RancherStore = Store<unknown>;

/**
 * The bits of a Steve resource model this extension uses.
 *
 * Secrets and ConfigMaps come back from the store as model instances; we only
 * read and write `data` and call `save()`.
 */
export interface SteveResource {
  data?: Record<string, string>;
  save: () => Promise<void>;
}

/** A Steve schema, as far as our permission checks care. */
export interface SteveSchema {
  collectionMethods?: string[];
  resourceMethods?: string[];
}

/** Errors thrown by the Rancher store carry an HTTP status. */
export interface StoreError {
  status?: number;
  message?: string;
}

export function storeErrorStatus(e: unknown): number | undefined {
  return (e as StoreError)?.status;
}

/** Best-effort message for anything thrown, for display in a Banner. */
export function errorMessage(e: unknown): string {
  if (e instanceof Error) {
    return e.message;
  }

  const message = (e as StoreError)?.message;

  return message || String(e);
}
