import {
  BUMP_ADVISOR_BATCH_SIZE,
  BUMP_RELEASE_NOTES_CHARS,
  BUMP_RELEASE_NOTES_LIMIT,
  NPM_PACKUMENT
} from '../config/constants';
import { ExtensionConfig } from '../types/common';
import { RancherStore } from '../types/rancher';
import { PackageImpact } from '../utils/bumpImpact';
import { compareSemver } from '../utils/version';
import { useClaude } from './useClaude';
import { hasLlmCredentials, useExtensionConfig } from './useExtensionConfig';
import { useGitHubApi } from './useGitHubApi';

/**
 * Asking a model the one part of the bump question that is not a lookup.
 *
 * The deterministic join already knows which extensions run the host's copy of
 * a package and which versions they pin — all of that is in three cached
 * documents and none of it needs a model. What it cannot know is whether the
 * release in question actually broke anything, because that lives in prose in
 * a changelog.
 *
 * So this is narrow on purpose. It is handed packages, not extensions; it is
 * only ever asked about a package the deterministic pass found a real path
 * for; and its answer is an extra column. Following `triage.ts`, it annotates
 * — it never reranks the table and never removes a row from it. A row the
 * model calls safe still shows every version and every gap it showed before.
 *
 * Driven by one opt-in button, like `useRepoClassifier`, and for the same
 * reason: every press costs money and sends repository data to whichever
 * provider is configured in Settings.
 */

/** How dangerous the model thinks this bump is for the extensions below it. */
export type BumpRisk = 'breaking' | 'watch' | 'safe' | 'unclear';

export const BUMP_RISKS: readonly BumpRisk[] = ['breaking', 'watch', 'safe', 'unclear'];

/** What the model returns for one package. */
export interface BumpAdvice {
  risk: BumpRisk;
  /** One sentence saying why */
  note: string;
  /** Something specific to look at before merging, or empty */
  check: string;
  /** False when no release notes could be found, so the verdict is thinner */
  hadNotes: boolean;
}

/**
 * Outcome of an advisory pass.
 *
 * Three states rather than two, for the reason spelled out in
 * `ClassifyOutcome`: a provider with no credentials, a run that reached the
 * model and had nothing to say, and a run that failed are different things,
 * and collapsing them is what makes a broken call look like a clean result.
 */
export interface AdviseOutcome {
  advice: Record<string, BumpAdvice>;
  /** False when the selected provider has no credentials configured */
  available: boolean;
  error: string | null;
  /** Packages skipped because nothing deterministic reached an extension */
  skipped: string[];
}

/** The slice of an npm packument this reads. */
interface Packument {
  repository?: { url?: string } | string;
}

/** The slice of a GitHub release this reads. */
interface GhReleaseNote {
  tag_name: string;
  name?: string;
  body?: string;
  draft?: boolean;
  prerelease?: boolean;
}

/** Release notes gathered for one package, already bounded and truncated. */
interface PackageNotes {
  /** Lowest version any affected extension pins, which bounds the range read */
  from: string | null;
  text: string;
}

const SYSTEM_PROMPT = `You advise reviewers of dependency bumps in rancher/dashboard, the Rancher UI. Rancher UI Extensions are separate repositories that plug into it. Some packages are supplied by the host at runtime, so a bump reaches extensions that are already installed; others are resolved by each extension when it next builds.

For each package you are given: the version being moved to, whether the host supplies it at runtime, which extensions are affected and what versions they currently pin, and the release notes between those versions where they could be found.

Return for each package:
- "risk": exactly one of "breaking", "watch", "safe", "unclear".
  - "breaking": the release notes describe a removed, renamed or behaviour-changed API that the affected extensions plausibly use.
  - "watch": a real change worth a look, but nothing that obviously breaks a consumer.
  - "safe": a patch, a fix, or internal-only change with no consumer-visible surface.
  - "unclear": you do not have enough to say. Prefer this over guessing.
- "note": one sentence, max 160 characters, plain language, saying why. Name the specific change where there is one. Do not restate the version numbers.
- "check": one short, concrete thing to look at before merging — a symbol, an option, a migration note. Empty string when there is nothing specific.

You are annotating a table that is already correct about which extensions are affected. Do not dispute it, do not re-rank it, and do not say an extension is unaffected. Judge the change itself.

A major-version gap between what an extension pins and what the host is moving to matters most when the host supplies the package at runtime, because the extension never gets to use its own pin.

Respond with a JSON array only, no prose, no code fences, one object per input package, in the same order, each with keys "package", "risk", "note", "check".`;

function isRisk(value: unknown): value is BumpRisk {
  return typeof value === 'string' && (BUMP_RISKS as readonly string[]).includes(value);
}

/** One entry as the model is asked to return it, before validation. */
interface RawAdvice {
  package?: string;
  risk?: string;
  note?: string;
  check?: string;
}

/** Strip a markdown code fence if the model wrapped its JSON in one. */
function parseJsonArray(text: string): RawAdvice[] {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  const parsed: unknown = JSON.parse(trimmed);

  return Array.isArray(parsed) ? parsed as RawAdvice[] : [];
}

/**
 * `owner/name` out of whatever npm has in its `repository` field.
 *
 * The field is famously inconsistent — a string, an object, `git+https`,
 * `git://`, with and without `.git` — so this normalises rather than trusting
 * any one shape. Null for the packages hosted somewhere other than GitHub,
 * whose notes are then simply absent.
 */
function repoFromPackument(doc: Packument | null): string | null {
  const raw = typeof doc?.repository === 'string' ? doc.repository : doc?.repository?.url;
  const match = /github\.com[:/]([^/]+)\/([^/.]+)/.exec(raw || '');

  return match ? `${ match[1] }/${ match[2] }` : null;
}

/**
 * Whether a release tag is one of this package's, and inside the range asked
 * about.
 *
 * Tag naming is not standardised: `v4.2.1`, `4.2.1` and, in a monorepo,
 * `@scope/pkg@4.2.1` all occur. Rather than guess the scheme, this pulls any
 * trailing semver out of the tag and compares that — a monorepo tag for a
 * *different* package in the same repo would pass, which is why the model is
 * told the notes are best-effort.
 */
const TRAILING_SEMVER = /(\d+\.\d+\.\d+(?:-[0-9A-Za-z-.]+)?)$/;

function versionOfTag(tag: string): string | null {
  return TRAILING_SEMVER.exec(tag || '')?.[1] || null;
}

export function useBumpAdvisor(store: RancherStore) {
  const { load: loadConfig } = useExtensionConfig(store);
  const { sendMessage } = useClaude(store);
  const api = useGitHubApi(store);

  /**
   * Release notes between what the extensions have and what the host is
   * moving to.
   *
   * Bounded by the lowest version any affected extension pins, because that is
   * the actual span of change a reviewer is exposed to. Reading from the
   * beginning of the project's history instead would bury the relevant release
   * in years of notes and cost tokens for all of it.
   *
   * Every failure here is swallowed into "no notes". A package published from
   * GitLab, a repo with no releases, a rate-limited call — none of them is a
   * reason to refuse an opinion, and the model is told when it is working
   * without notes so it can answer "unclear".
   */
  const releaseNotes = async(impact: PackageImpact): Promise<PackageNotes> => {
    const pinned = impact.rows
      .filter((row) => row.reach === 'runtime' || row.reach === 'rebuild')
      .flatMap((row) => row.pinned);

    const from = pinned.length ? [...pinned].sort(compareSemver)[0] : null;

    try {
      const packument = await fetch(NPM_PACKUMENT(impact.bump.name), { headers: { Accept: 'application/json' } })
        .then((res) => (res.ok ? res.json() as Promise<Packument> : null))
        .catch(() => null);

      const repo = repoFromPackument(packument);

      if (!repo) {
        return { from, text: '' };
      }

      const releases = await api.get<GhReleaseNote[]>(`/repos/${ repo }/releases`, { per_page: 100 });

      const relevant = releases
        .filter((release) => !release.draft && !release.prerelease)
        .map((release) => ({ release, version: versionOfTag(release.tag_name) }))
        .filter((entry): entry is { release: GhReleaseNote; version: string } => {
          if (!entry.version || compareSemver(entry.version, impact.bump.version) > 0) {
            return false;
          }

          return !from || compareSemver(entry.version, from) > 0;
        })
        .sort((a, b) => compareSemver(b.version, a.version))
        .slice(0, BUMP_RELEASE_NOTES_LIMIT);

      const text = relevant
        .map((entry) => `## ${ entry.release.name || entry.release.tag_name }\n${ entry.release.body || '' }`)
        .join('\n\n')
        .slice(0, BUMP_RELEASE_NOTES_CHARS);

      return { from, text };
    } catch {
      return { from, text: '' };
    }
  };

  /** What one package looks like to the model: the facts, and only the solid ones. */
  const payloadFor = (impact: PackageImpact, notes: PackageNotes) => {
    return {
      package:      impact.bump.name,
      movingTo:     impact.bump.version,
      hostProvided: impact.hostProvided,
      // Stale and unanalysed rows are deliberately left out. They are exactly
      // the rows we cannot vouch for, and handing them over as evidence would
      // get back a confident sentence built on a reading of code nobody runs.
      affected:     impact.rows
        .filter((row) => row.reach === 'runtime' || row.reach === 'rebuild')
        .map((row) => ({
          extension: row.ext,
          reach:     row.reach,
          pins:      row.pinned,
          importsIt: row.importsIt,
        })),
      unverified:   impact.counts.unknown,
      releaseNotes: notes.text || '(none found)',
      notesFrom:    notes.from,
    };
  };

  const adviseBatch = async(
    cfg: ExtensionConfig,
    batch: { impact: PackageImpact; notes: PackageNotes }[],
  ): Promise<Record<string, BumpAdvice>> => {
    const text = await sendMessage(cfg, {
      system:          SYSTEM_PROMPT,
      userContent:     JSON.stringify(batch.map(({ impact, notes }) => payloadFor(impact, notes))),
      maxTokens:       1536,
      // Off for the same reason the classifier turns it off: the budget is
      // shared, and a thinking block that eats it leaves the JSON array
      // truncated mid-object with nothing to say why.
      disableThinking: true,
    });

    const hadNotes = new Map(batch.map(({ impact, notes }) => [impact.bump.name, !!notes.text]));
    const out: Record<string, BumpAdvice> = {};

    parseJsonArray(text).forEach((item) => {
      if (!item?.package || !isRisk(item.risk)) {
        return;
      }

      out[item.package] = {
        risk:     item.risk,
        note:     String(item.note || '').slice(0, 240),
        check:    String(item.check || '').slice(0, 240),
        hadNotes: hadNotes.get(item.package) ?? false,
      };
    });

    return out;
  };

  /**
   * Advise on every package the deterministic pass found a path for.
   *
   * A package whose every row came back `none` or `unknown` is skipped and
   * named in `skipped`. There is nothing for a model to reason about when
   * nothing verified is affected, and paying for a sentence about it would
   * produce a confident-sounding opinion on an empty question.
   */
  const advise = async(impacts: PackageImpact[]): Promise<AdviseOutcome> => {
    const cfg = await loadConfig();

    if (!hasLlmCredentials(cfg)) {
      return {
        advice: {}, available: false, error: null, skipped: []
      };
    }

    const worth = impacts.filter((i) => i.counts.runtime > 0 || i.counts.rebuild > 0);
    const skipped = impacts.filter((i) => !worth.includes(i)).map((i) => i.bump.name);

    if (!worth.length) {
      return {
        advice: {}, available: true, error: null, skipped
      };
    }

    // Notes first, in parallel, because they are network-bound and the model
    // calls that follow are rate-limit-bound. Interleaving them would make the
    // slowest of each wait on the other.
    const prepared = await Promise.all(worth.map(async(impact) => ({ impact, notes: await releaseNotes(impact) })));

    const advice: Record<string, BumpAdvice> = {};
    let error: string | null = null;

    // Sequential, like the classifier: batches are small and this keeps clear
    // of the per-minute request limits every provider applies.
    for (let i = 0; i < prepared.length; i += BUMP_ADVISOR_BATCH_SIZE) {
      try {
        Object.assign(advice, await adviseBatch(cfg, prepared.slice(i, i + BUMP_ADVISOR_BATCH_SIZE)));
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
        console.warn('extensions-center: bump advisory batch failed', e); // eslint-disable-line no-console
      }
    }

    return {
      advice, available: true, error, skipped
    };
  };

  return { advise };
}
