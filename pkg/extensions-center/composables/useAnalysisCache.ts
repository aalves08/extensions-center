import { CONFIG_MAP } from '@shell/config/types';

import { ANALYSIS_TTL_DAYS, CONFIG_NAMESPACE } from '../config/constants';
import { RancherStore, SteveResource, SteveSchema, storeErrorStatus } from '../types/rancher';
import { gunzipFromBase64, gzipToBase64, isCompressionSupported } from '../utils/gzip';

/**
 * ConfigMap persistence for the three expensive documents: the two analyses and
 * the Security page.
 *
 * All three are far too expensive to run on page load — one downloads roughly
 * 1,150 source files, another close to 98MB of source maps, the third makes
 * hundreds of API calls across eighteen targets — so the finished document is
 * stored in the cluster and replayed on every subsequent visit. A hard refresh
 * costs a single ConfigMap read.
 *
 * Generic over the document type rather than duplicated per page, because all
 * three want identical behaviour against different objects. The known-repos
 * cache stays separate: it trims its rows to fit, which only makes sense when
 * the rows are ranked.
 */

/** Keys inside the ConfigMap's `data` map, one per storage format. */
const DATA_KEY = 'analysis.json';
const GZIP_DATA_KEY = 'analysis.json.gz';

/**
 * etcd rejects objects over ~1MiB, and this is the point at which we refuse the
 * write instead.
 *
 * Measured against the real data all three are comfortably clear: imports comes
 * to roughly 80KB, bundles to 59KB, and security to ~55KB once compressed.
 * Passing this ceiling would mean something has changed shape drastically,
 * which is worth an error rather than a silent truncation — a partially stored
 * document would read as a complete one and quietly understate every total on
 * the page.
 *
 * Applied to the payload as *stored*, so a compressed document is measured
 * compressed. That is the number the API server sees.
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
  /**
   * Store the document gzipped and base64-encoded rather than as plain JSON.
   *
   * For the Security document, which comes to ~870KB of JSON across the estate
   * — close enough to etcd's limit that storing it plainly is waiting for the
   * repo that tips it over. It compresses ~20x, since it is mostly repeated
   * advisory text.
   *
   * Compressed documents live under a different `data` key, so a plain
   * document can never be handed to the decompressor and vice versa.
   */
  compress?: boolean;
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
  const key = opts.compress ? GZIP_DATA_KEY : DATA_KEY;

  /**
   * Whether this cache can run here at all.
   *
   * Only false on a browser with no `CompressionStream`, and only for a
   * compressed cache. Such a browser gets no persistence rather than an
   * uncompressed write the API server might refuse.
   */
  const usable = !opts.compress || isCompressionSupported();

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
    if (!usable) {
      return null;
    }

    const cm = await find();
    const raw = cm?.data?.[key];

    if (!raw) {
      return null;
    }

    let parsed: T;

    try {
      parsed = JSON.parse(opts.compress ? await gunzipFromBase64(raw) : raw);
    } catch {
      // A corrupt cache reads as "no cache"; the next rebuild overwrites it.
      // Covers a failed decompress as well as malformed JSON — neither is
      // recoverable and both have the same remedy.
      return null;
    }

    return parsed?.version === opts.version ? parsed : null;
  };

  /** Replace the stored document. Throws rather than truncate if it is too big. */
  const write = async(doc: T): Promise<void> => {
    const json = JSON.stringify(doc);
    const payload = opts.compress ? await gzipToBase64(json) : json;
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
      existing.data = { ...(existing.data || {}), [key]: payload };
      await existing.save();

      return;
    }

    const created: SteveResource = await store.dispatch('management/create', {
      type:     CONFIG_MAP,
      metadata: { name: opts.name, namespace: CONFIG_NAMESPACE },
      data:     { [key]: payload },
    });

    await created.save();
  };

  /** Whether the current user may persist the document at all. */
  const canWrite = (): boolean => {
    if (!usable) {
      return false;
    }

    const schema: SteveSchema | undefined = store.getters['management/schemaFor'](CONFIG_MAP);

    return (schema?.collectionMethods || []).some((m) => m.toLowerCase() === 'post');
  };

  return {
    read, write, canWrite
  };
}
