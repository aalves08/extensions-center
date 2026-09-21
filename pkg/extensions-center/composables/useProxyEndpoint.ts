import { ref, Ref } from 'vue';
import { MANAGEMENT } from '@shell/config/types';

import { GITHUB_PROXY_DOMAIN, PROXY_ENDPOINT_NAME } from '../config/constants';
import {
  RancherStore, SteveResource, SteveSchema, errorMessage, storeErrorStatus
} from '../types/rancher';

/**
 * How the allow-list check turned out.
 *
 * The three failure states are deliberately distinct, because the thing a user
 * has to do about them is different in each case: nothing, ask an admin, or
 * look at the error.
 */
export type ProxyEndpointState =
  /** Not checked yet */
  | 'unknown'
  /** The domain was already allowed, or we just allowed it */
  | 'ready'
  /** Missing, and this user may not create it — an admin has to */
  | 'forbidden'
  /** Missing, and creating it failed for some other reason */
  | 'error';

/**
 * Makes sure `api.github.com` is reachable through Rancher's `/meta/proxy`.
 *
 * GitHub's code search endpoint sends no CORS headers on a successful
 * authenticated response, so it can only be called server-side, and Rancher
 * will only proxy hosts named by a `ProxyEndpoint`. That object is
 * cluster-scoped, so this quietly creates it for admins and reports back for
 * everyone else rather than letting the known-extensions table fail with an
 * error that never mentions GitHub.
 *
 * Creating it is idempotent by name: repeat visits find the existing object.
 */
export function useProxyEndpoint(store: RancherStore) {
  const state: Ref<ProxyEndpointState> = ref('unknown');
  const error: Ref<string | null> = ref(null);

  /** Whether this user may create cluster-scoped ProxyEndpoints at all. */
  const canCreate = (): boolean => {
    const schema: SteveSchema | undefined = store.getters['management/schemaFor'](MANAGEMENT.PROXY_ENDPOINT);

    return (schema?.collectionMethods || []).some((m) => m.toLowerCase() === 'post');
  };

  /**
   * True when any ProxyEndpoint already routes the domain.
   *
   * Checked across every object rather than just ours, so an endpoint an admin
   * set up by hand — or a wildcard from another extension — counts and we do
   * not add a redundant second one.
   */
  const isAllowed = async(): Promise<boolean> => {
    const endpoints: { spec?: { routes?: { domain?: string }[] } }[] =
      await store.dispatch('management/findAll', { type: MANAGEMENT.PROXY_ENDPOINT });

    return (endpoints || []).some((e) => (e?.spec?.routes || []).some(
      (r) => r?.domain?.toLowerCase() === GITHUB_PROXY_DOMAIN
    ));
  };

  const ensure = async(): Promise<ProxyEndpointState> => {
    error.value = null;

    try {
      if (await isAllowed()) {
        state.value = 'ready';

        return state.value;
      }
    } catch (e) {
      // Not being allowed to list them is the standard-user case, and it is
      // indistinguishable from "there are none" — either way we cannot fix it.
      const status = storeErrorStatus(e);

      state.value = (status === 403 || status === 404) ? 'forbidden' : 'error';
      error.value = errorMessage(e);

      return state.value;
    }

    if (!canCreate()) {
      state.value = 'forbidden';

      return state.value;
    }

    try {
      const created: SteveResource = await store.dispatch('management/create', {
        type:     MANAGEMENT.PROXY_ENDPOINT,
        metadata: { name: PROXY_ENDPOINT_NAME },
        spec:     { routes: [{ domain: GITHUB_PROXY_DOMAIN }] },
      });

      await created.save();
      state.value = 'ready';
    } catch (e) {
      // 409 means something created it between our check and our write, which
      // is the outcome we wanted anyway.
      if (storeErrorStatus(e) === 409) {
        state.value = 'ready';

        return state.value;
      }

      state.value = storeErrorStatus(e) === 403 ? 'forbidden' : 'error';
      error.value = errorMessage(e);
    }

    return state.value;
  };

  return {
    state, error, ensure
  };
}
