import { ExtensionConfig } from '../types/common';
import { RancherStore } from '../types/rancher';
import { fallbackName } from '../utils/names';
import { sendMessage } from './useClaude';
import { hasLlmCredentials, useExtensionConfig } from './useExtensionConfig';

/**
 * NOT WIRED UP.
 *
 * Nothing calls this today. The known-extensions table used to run every repo
 * through it on rebuild and the model call was failing, so the table now
 * categorises by repo owner — SUSE or external — which needs no model and is
 * already in the data. This is kept intact for when the categorisation layer
 * comes back rather than being written again from scratch.
 *
 * It is deliberately self-contained: its categories and its result type live
 * here rather than in `types/repos.ts`, so `KnownRepo` carries no field that
 * nothing populates. Wiring it back in means calling `classify()` from
 * `useKnownRepos.rebuild()`, adding the chosen field to `KnownRepo`, and
 * bumping `KNOWN_REPOS_CACHE_VERSION` so old cached rows are discarded.
 *
 * Credentials are read from the extension's Secret and used directly from the
 * browser, so they never touch source control or a build artifact. Which
 * provider gets called is a setting — see `useClaude`.
 */

/** Categories the model is asked to choose from */
export const REPO_CATEGORIES = [
  'provisioning',
  'node-driver',
  'cluster-driver',
  'virtualisation',
  'observability',
  'security',
  'storage',
  'networking',
  'backup',
  'ai',
  'developer-tools',
  'other',
] as const;

export type RepoCategory = typeof REPO_CATEGORIES[number];

/** What the classifier needs to know about a repo to describe it. */
export interface ClassifierInput {
  /** `owner/name` */
  id: string;
  /** GitHub's own repo description, often empty */
  repoDescription: string;
  topics: string[];
  /** Leading chunk of the README, when we could read one */
  readmeExcerpt: string;
}

/** What the classifier produces for one repo. */
export interface ClassifierResult {
  name: string;
  description: string;
  category: RepoCategory;
}

/**
 * Outcome of a classification pass.
 *
 * `available` and an empty `results` are not the same thing as a failure, and
 * conflating them is what let a broken model call look like a successful run
 * that simply had nothing to say: every repo fell back to its metadata with
 * category "other" and nothing in the UI mentioned it. The caller needs all
 * three of these to tell the cases apart.
 */
export interface ClassifyOutcome {
  results: Record<string, ClassifierResult>;
  /** False when the selected provider has no credentials configured */
  available: boolean;
  /** Message from the last batch that threw, null when every batch succeeded */
  error: string | null;
}

/** How many repos go into one model call. Keeps each request well inside limits. */
const BATCH_SIZE = 12;

const SYSTEM_PROMPT = `You classify GitHub repositories that contain Rancher UI Extensions.

For each repository you are given, return:
- "name": the human-friendly name of the extension (title case, no "rancher-" or "-ui-extension" noise). Fall back to a cleaned-up repo name.
- "description": one sentence, max 140 characters, plain language, describing what the extension does for a Rancher user. No marketing language. Do not start with "This extension".
- "category": exactly one of: ${ REPO_CATEGORIES.join(', ') }.

Pick "other" only when nothing else fits. Respond with a JSON array only, no prose, no code fences, one object per input repository, in the same order, each with keys "id", "name", "description", "category".`;

function isCategory(value: unknown): value is RepoCategory {
  return typeof value === 'string' && (REPO_CATEGORIES as readonly string[]).includes(value);
}

/** One entry as the model is asked to return it, before validation. */
interface RawClassification {
  id?: string;
  name?: string;
  description?: string;
  category?: string;
}

/** Strip a markdown code fence if the model wrapped its JSON in one. */
function parseJsonArray(text: string): RawClassification[] {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();

  const parsed: unknown = JSON.parse(trimmed);

  return Array.isArray(parsed) ? parsed as RawClassification[] : [];
}

export function useRepoClassifier(store: RancherStore) {
  const { load: loadConfig } = useExtensionConfig(store);

  const classifyBatch = async(cfg: ExtensionConfig, batch: ClassifierInput[]): Promise<Record<string, ClassifierResult>> => {
    const payload = batch.map((r) => ({
      id:          r.id,
      description: r.repoDescription,
      topics:      r.topics,
      readme:      r.readmeExcerpt,
    }));

    const text = await sendMessage(cfg, {
      system:      SYSTEM_PROMPT,
      userContent: JSON.stringify(payload),
      maxTokens:   2048,
    });

    const out: Record<string, ClassifierResult> = {};

    parseJsonArray(text).forEach((item) => {
      if (!item?.id) {
        return;
      }

      out[item.id] = {
        name:        String(item.name || fallbackName(item.id)).slice(0, 80),
        description: String(item.description || '').slice(0, 200),
        category:    isCategory(item.category) ? item.category : 'other',
      };
    });

    return out;
  };

  /** Classify every input, in batches, reporting how it went. */
  const classify = async(inputs: ClassifierInput[]): Promise<ClassifyOutcome> => {
    const cfg = await loadConfig();

    if (!hasLlmCredentials(cfg)) {
      return {
        results: {}, available: false, error: null
      };
    }

    if (!inputs.length) {
      return {
        results: {}, available: true, error: null
      };
    }

    const results: Record<string, ClassifierResult> = {};
    let error: string | null = null;

    // Sequential rather than parallel: batches are small, and this keeps us
    // clear of the per-minute request limits every provider applies.
    for (let i = 0; i < inputs.length; i += BATCH_SIZE) {
      const batch = inputs.slice(i, i + BATCH_SIZE);

      try {
        Object.assign(results, await classifyBatch(cfg, batch));
      } catch (e) {
        // A failed batch leaves those repos on their metadata fallback rather
        // than aborting the whole rebuild — but it is reported, not swallowed.
        // A bad key or an unenabled model fails every batch identically, and
        // the console warning alone made that look like "the model had no
        // opinion" instead of "the model was never reached".
        error = e instanceof Error ? e.message : String(e);
        console.warn('extensions-center: classification batch failed', e); // eslint-disable-line no-console
      }
    }

    return {
      results, available: true, error
    };
  };

  return { classify };
}
