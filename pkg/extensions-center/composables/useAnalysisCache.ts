import { CONFIG_MAP } from '@shell/config/types';

import { ANALYSIS_TTL_DAYS, CONFIG_NAMESPACE } from '../config/constants';
import { RancherStore, SteveResource, SteveSchema, storeErrorStatus } from '../types/rancher';

/**
 * ConfigMap persistence for the two analysis documents.
 *
 * Both rebuilds are far too expensive to run on page load — one downloads
 * roughly 1,150 source files, the other close to 98MB of source maps — so the
 * finished document is stored in the cluster and replayed on every subsequent
 * visit. A hard refresh costs a single ConfigMap read.
 *
 * Generic over the document type rather than duplicated per page, because
 * imports and bundles want identical behaviour against different objects. The
 * known-repos cache stays separate: it trims its rows to fit, which only makes
 * sense when the rows are ranked.
 */

/** Key inside the ConfigMap's `data` map. Same for both documents. */
const DATA_KEY = 'analysis.json';

/**
 * etcd rejects objects over ~1MiB, and this is the point at which we refuse the
 * write instead.
 *
 * Measured against the real data both documents are comfortably clear: imports
 * comes to roughly 80KB and bundles to 59KB. Passing this ceiling would mean
 * something has changed shape drastically, which is worth an error rather than
 * a silent truncation — a partially stored analysis would read as a complete
 * one and quietly understate every total on the page.
 */
const MAX_BYTES = 700 * 1024;

/** Any stored analysis document carries these two fields. */
interface VersionedDoc {
  version: number;
  fetchedAt: string;
}

export interface AnalysisCacheOptions {
  /** ConfigMap name, within `CONFIG_NAMESPACE` */
  name: string;
  /** Expected `version`; anything else is treated as no cache at all */
  version: number;
}

/** Whether a cached document is old enough to be worth flagging in the UI. */
export function isAnalysisStale(doc: VersionedDoc): boolean {
  const fetched = new Date(doc.fetchedAt).getTime();

  if (!Number.isFinite(fetched)) {
    return true;
  }

  return (Date.now() - fetched) / (24 * 60 * 60 * 1000) >= ANALYSIS_TTL_DAYS;
}

export function useAnalysisCache<T extends VersionedDoc>(store: RancherStore, opts: AnalysisCacheOptions) {
  const id = `${ CONFIG_NAMESPACE }/${ opts.name }`;

  const find = async(): Promise<SteveResource | null> => {
    try {
      return await store.dispatch('management/find', {
        type: CONFIG_MAP,
        id,
        opt:  { force: true },
      });
    } catch (e) {
      const status = storeErrorStatus(e);

      // 404 is the ordinary first-run case: nobody has run the analysis yet.
      if (status === 404 || status === 403) {
        return null;
      }

      throw e;
    }
  };

  /** Read the stored document, or null when there is nothing usable to read. */
  const read = async(): Promise<T | null> => {
    const cm = await find();
    const raw = cm?.data?.[DATA_KEY];

    if (!raw) {
      return null;
    }

    let parsed: T;

    try {
      parsed = JSON.parse(raw);
    } catch {
      // A corrupt cache reads as "no cache"; the next rebuild overwrites it.
      return null;
    }

    return parsed?.version === opts.version ? parsed : null;
  };

  /** Replace the stored document. Throws rather than truncate if it is too big. */
  const write = async(doc: T): Promise<void> => {
    const payload = JSON.stringify(doc);
    const size = new Blob([payload]).size;

    if (size > MAX_BYTES) {
      throw new Error(
        store.getters['i18n/t']('extensionsCenter.analysis.errors.tooLarge', {
          size:  Math.round(size / 1024),
          limit: Math.round(MAX_BYTES / 1024),
        })
      );
    }

    const existing = await find();

    if (existing) {
      existing.data = { ...(existing.data || {}), [DATA_KEY]: payload };
      await existing.save();

      return;
    }

    const created: SteveResource = await store.dispatch('management/create', {
      type:     CONFIG_MAP,
      metadata: { name: opts.name, namespace: CONFIG_NAMESPACE },
      data:     { [DATA_KEY]: payload },
    });

    await created.save();
  };

  /** Whether the current user may persist the document at all. */
  const canWrite = (): boolean => {
    const schema: SteveSchema | undefined = store.getters['management/schemaFor'](CONFIG_MAP);

    return (schema?.collectionMethods || []).some((m) => m.toLowerCase() === 'post');
  };

  return {
    read, write, canWrite
  };
}
