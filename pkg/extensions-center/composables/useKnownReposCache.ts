import { CONFIG_MAP } from '@shell/config/types';

import {
  CONFIG_NAMESPACE,
  KNOWN_REPOS_CONFIGMAP_ID,
  KNOWN_REPOS_CONFIGMAP_NAME,
  KNOWN_REPOS_CACHE_VERSION,
  KNOWN_REPOS_TTL_DAYS
} from '../config/constants';
import { RancherStore, SteveResource, SteveSchema, storeErrorStatus } from '../types/rancher';
import { KnownRepo, KnownReposDoc } from '../types/repos';

/** Key inside the ConfigMap's `data` map. */
const DATA_KEY = 'repos.json';

/**
 * etcd rejects objects over ~1MiB. We stay well under it: at roughly 400 bytes
 * per repo, 500 repos is about 200KB. The ceiling below is the point at which
 * we start dropping the lowest-ranked rows rather than risk a rejected write.
 */
const MAX_BYTES = 700 * 1024;

/** Whether a cached document is old enough to be worth telling the user about. */
export function isStale(doc: KnownReposDoc): boolean {
  const fetched = new Date(doc.fetchedAt).getTime();

  if (!Number.isFinite(fetched)) {
    return true;
  }

  return (Date.now() - fetched) / (24 * 60 * 60 * 1000) >= KNOWN_REPOS_TTL_DAYS;
}

/**
 * Persistence for the known-extensions table.
 *
 * This is the only Kubernetes object the extension writes during normal use,
 * and it exists because the table behind it is expensive: assembling it costs a
 * paginated code search plus two GitHub calls for every repo found. Paying that
 * on each page load is what made the dashboard fire hundreds of requests, so
 * the finished table is stored here and replayed instead.
 */
export function useKnownReposCache(store: RancherStore) {
  const find = async(): Promise<SteveResource | null> => {
    try {
      return await store.dispatch('management/find', {
        type: CONFIG_MAP,
        id:   KNOWN_REPOS_CONFIGMAP_ID,
        opt:  { force: true },
      });
    } catch (e) {
      const status = storeErrorStatus(e);

      // 404 is the ordinary first-run case: nobody has built the table yet.
      if (status === 404 || status === 403) {
        return null;
      }

      throw e;
    }
  };

  /** Read the cached table, or null when there is nothing usable to read. */
  const read = async(): Promise<KnownReposDoc | null> => {
    const cm = await find();
    const raw = cm?.data?.[DATA_KEY];

    if (!raw) {
      return null;
    }

    let parsed: KnownReposDoc;

    try {
      parsed = JSON.parse(raw);
    } catch {
      // A corrupt cache is not worth surfacing: it reads as "no cache", and the
      // next rebuild overwrites it.
      return null;
    }

    if (parsed?.version !== KNOWN_REPOS_CACHE_VERSION || !Array.isArray(parsed.repos)) {
      return null;
    }

    return parsed;
  };

  /**
   * Replace the cached table.
   *
   * Rows are already sorted by score, so trimming to fit drops the least
   * interesting extensions rather than an arbitrary slice.
   */
  const write = async(repos: KnownRepo[]): Promise<void> => {
    let kept = repos;

    const encode = () => JSON.stringify({
      version:   KNOWN_REPOS_CACHE_VERSION,
      fetchedAt: new Date().toISOString(),
      repos:     kept,
    } satisfies KnownReposDoc);

    let payload = encode();

    while (new Blob([payload]).size > MAX_BYTES && kept.length > 1) {
      kept = kept.slice(0, Math.floor(kept.length * 0.9));
      payload = encode();
    }

    const existing = await find();

    if (existing) {
      existing.data = { ...(existing.data || {}), [DATA_KEY]: payload };
      await existing.save();

      return;
    }

    const created: SteveResource = await store.dispatch('management/create', {
      type:     CONFIG_MAP,
      metadata: { name: KNOWN_REPOS_CONFIGMAP_NAME, namespace: CONFIG_NAMESPACE },
      data:     { [DATA_KEY]: payload },
    });

    await created.save();
  };

  /** Whether the current user may persist the table at all. */
  const canWrite = (): boolean => {
    const schema: SteveSchema | undefined = store.getters['management/schemaFor'](CONFIG_MAP);

    return (schema?.collectionMethods || []).some((m) => m.toLowerCase() === 'post');
  };

  return {
    read, write, canWrite
  };
}
