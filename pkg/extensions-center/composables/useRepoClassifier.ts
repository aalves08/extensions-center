import { ExtensionConfig } from '../types/common';
import { RancherStore } from '../types/rancher';
import { fallbackName } from '../utils/names';
import { useClaude } from './useClaude';
import { hasLlmCredentials, useExtensionConfig } from './useExtensionConfig';

/**
 * Writes a name, a one-line description and a category for a batch of repos.
 *
 * Driven by the Describe with AI action on the known-repos page, and by
 * nothing else. It used to run inside `useKnownRepos.rebuild()`, where a model
 * call that could not be made took the whole table with it and looked like a
 * GitHub problem; as a separate action it is re-runnable and cannot break the
 * table, and the table keeps categorising by repo owner — SUSE or external —
 * with no model involved at all.
 *
 * The categories and the result type live here rather than in
 * `types/repos.ts` because they belong to this prompt: change the list and you
 * are changing what the model is asked, not what a repo is.
 *
 * Credentials are read from the extension's Secret and used from the browser,
 * so they never touch source control or a build artifact. Which provider gets
 * called is a setting — see `useClaude`.
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
  'cost',
  'gitops',
  'ai',
  'developer-tools',
  'ui-customisation',
  'sample',
  'fork',
  'collection',
  'other',
] as const;

export type RepoCategory = typeof REPO_CATEGORIES[number];

/** The category a repo gets when the model could not place it. */
export const UNCLASSIFIED: RepoCategory = 'other';

/**
 * One line per category, shown to the model instead of a bare word list.
 *
 * The bare list put a seventh of the table in `other`, and the rows it put
 * there were not miscellaneous — they were forks of the dashboard, repos
 * holding several extensions at once, and samples. Those have nothing wrong
 * with them except that no *functional* category can describe them, so the
 * fix is partly new buckets and partly saying out loud what each bucket is
 * for. The glosses that disambiguate near-neighbours earn their place:
 * `fork` versus `ui-customisation`, `collection` versus whatever its contents
 * happen to do, `sample` versus `developer-tools`.
 */
const CATEGORY_GUIDE: Record<RepoCategory, string> = {
  provisioning:       'creating or managing clusters, cloud credentials, or cluster templates',
  'node-driver':      'adds a node driver so Rancher can create machines on some infrastructure',
  'cluster-driver':   'adds a hosted-Kubernetes cluster driver (EKS/AKS/GKE and the like)',
  virtualisation:     'virtual machines, KubeVirt, Harvester',
  observability:      'metrics, logging, tracing, dashboards, alerting, cluster health',
  security:           'policy, compliance, scanning, secrets, RBAC, certificates',
  storage:            'persistent volumes, CSI, object storage',
  networking:         'CNI, ingress, service mesh, load balancing, DNS',
  backup:             'backup, restore, disaster recovery, migration of workloads',
  cost:               'cost visibility, chargeback, FinOps, resource-spend reporting',
  gitops:             'Fleet, GitOps, CI/CD pipelines, continuous delivery',
  ai:                 'LLM assistants, chatbots, AI-driven troubleshooting or recommendations',
  'developer-tools':  'tooling aimed at people building or debugging extensions and workloads',
  'ui-customisation': 'changes how the existing Rancher UI looks or navigates — theming, branding, layout, accessibility — without adding a domain feature',
  sample:             'an example, template, tutorial or boilerplate whose purpose is to demonstrate how to build an extension',
  fork:               'a copy of Rancher Dashboard itself, or of another extension, rather than an extension that plugs into it',
  collection:         'a repository that holds several extensions, or charts and assets, rather than one extension',
  other:              'genuinely none of the above',
};

const CATEGORY_LIST = REPO_CATEGORIES
  .map((category) => `- "${ category }": ${ CATEGORY_GUIDE[category] }`)
  .join('\n');

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
 * What the re-categorisation pass needs for one repo it is re-examining.
 *
 * Carries the description already written for it, which `ClassifierInput`
 * cannot have: on the first pass there isn't one yet.
 */
export interface RecategoriseInput {
  /** `owner/name` */
  id: string;
  /** The description the first pass wrote — evidence, not something to redo */
  description: string;
  topics: string[];
  /** A longer README excerpt than the first pass was given */
  readmeExcerpt: string;
}

/**
 * Outcome of a re-categorisation pass.
 *
 * `categories` holds only the repos the model placed. A repo it looked at and
 * still could not place is absent rather than present as `other`, so the
 * caller can leave its row untouched instead of rewriting it with the value
 * it already had.
 */
export interface RecategoriseOutcome {
  categories: Record<string, RepoCategory>;
  /** False when the selected provider has no credentials configured */
  available: boolean;
  /** Message from the last batch that threw, null when every batch succeeded */
  error: string | null;
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

/**
 * Smaller than `BATCH_SIZE` because each input carries four times the README.
 * Twelve of those would be a large request for one word of output each.
 */
const DEEP_BATCH_SIZE = 5;

const SYSTEM_PROMPT = `You classify GitHub repositories that contain Rancher UI Extensions.

For each repository you are given, return:
- "name": the human-friendly name of the extension (title case, no "rancher-" or "-ui-extension" noise). Fall back to a cleaned-up repo name.
- "description": one sentence, max 140 characters, plain language, describing what the extension does for a Rancher user. No marketing language. Do not start with "This extension".
- "category": exactly one of the following.

${ CATEGORY_LIST }

Choose on what the repository is *for*, not on which technologies it mentions: an extension that charts Prometheus data to show spend is "cost", not "observability". Prefer "fork", "sample" or "collection" over a functional category when the repository is one of those — what it contains matters less than what it is. Use "other" only when you have considered every category above and none of them is defensible.

Respond with a JSON array only, no prose, no code fences, one object per input repository, in the same order, each with keys "id", "name", "description", "category".`;

/**
 * Second pass, for repos the first pass could not place.
 *
 * Category only. The descriptions the first pass wrote are good — it is the
 * placement that failed — so re-asking for them would pay output tokens to
 * overwrite text that is already right, and risk churning wording that a
 * reader has already seen. This gets a longer README instead, and is told
 * what the first pass already concluded.
 */
const DEEP_SYSTEM_PROMPT = `You are re-examining GitHub repositories that contain Rancher UI Extensions. An earlier pass could not place these into a category and fell back to "other", so assume the answer is not obvious from the first paragraph of the README and read further.

Each input carries the description already written for it, which is accurate — use it as evidence, do not rewrite it.

Choose exactly one of the following.

${ CATEGORY_LIST }

Many repositories that resist a functional category are a fork, a sample or a collection; check those three before settling. Answer "other" only if the repository genuinely fits none of them — "other" is a valid answer and a wrong specific category is worse than an honest "other".

Respond with a JSON array only, no prose, no code fences, one object per input repository, in the same order, each with keys "id" and "category" and nothing else.`;

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
  const { sendMessage } = useClaude(store);

  const classifyBatch = async(cfg: ExtensionConfig, batch: ClassifierInput[]): Promise<Record<string, ClassifierResult>> => {
    const payload = batch.map((r) => ({
      id:          r.id,
      description: r.repoDescription,
      topics:      r.topics,
      readme:      r.readmeExcerpt,
    }));

    // Thinking is off because the budget is shared. A thinking block spends
    // `max_tokens` before the JSON starts, and the array then stops mid-object
    // — `parseJsonArray` throws, and the whole batch falls back to metadata
    // without saying why. Nothing here needs reasoning tokens anyway: it is a
    // one-line summary and a label off a fixed list.
    const text = await sendMessage(cfg, {
      system:          SYSTEM_PROMPT,
      userContent:     JSON.stringify(payload),
      maxTokens:       2048,
      disableThinking: true,
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

  const recategoriseBatch = async(cfg: ExtensionConfig, batch: RecategoriseInput[]): Promise<Record<string, RepoCategory>> => {
    const payload = batch.map((r) => ({
      id:          r.id,
      description: r.description,
      topics:      r.topics,
      readme:      r.readmeExcerpt,
    }));

    const text = await sendMessage(cfg, {
      system:          DEEP_SYSTEM_PROMPT,
      userContent:     JSON.stringify(payload),
      maxTokens:       1024,
      disableThinking: true,
    });

    const out: Record<string, RepoCategory> = {};

    parseJsonArray(text).forEach((item) => {
      // Only a category the model actually chose is recorded. Falling back to
      // `other` here would be indistinguishable from the model answering
      // `other`, and the caller needs to leave an unanswered row alone rather
      // than rewrite it with the value it already had.
      if (item?.id && isCategory(item.category)) {
        out[item.id] = item.category;
      }
    });

    return out;
  };

  /**
   * Re-examine repos that came back `other`, and return only the ones the
   * model placed somewhere. A repo it still cannot place is simply absent.
   */
  const recategorise = async(inputs: RecategoriseInput[]): Promise<RecategoriseOutcome> => {
    const cfg = await loadConfig();

    if (!hasLlmCredentials(cfg)) {
      return {
        categories: {}, available: false, error: null
      };
    }

    if (!inputs.length) {
      return {
        categories: {}, available: true, error: null
      };
    }

    const categories: Record<string, RepoCategory> = {};
    let error: string | null = null;

    for (let i = 0; i < inputs.length; i += DEEP_BATCH_SIZE) {
      const batch = inputs.slice(i, i + DEEP_BATCH_SIZE);

      try {
        Object.assign(categories, await recategoriseBatch(cfg, batch));
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
        console.warn('extensions-center: recategorisation batch failed', e); // eslint-disable-line no-console
      }
    }

    return {
      categories, available: true, error
    };
  };

  return { classify, recategorise };
}
