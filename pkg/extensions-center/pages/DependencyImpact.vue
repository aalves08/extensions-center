<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useStore } from 'vuex';
import { Banner } from '@components/Banner';
import { LabeledInput } from '@components/Form/LabeledInput';
import AsyncButton from '@shell/components/AsyncButton.vue';

import AnalysisProgressBar from '../components/AnalysisProgressBar.vue';
import BumpImpactTable from '../components/BumpImpactTable.vue';
import SectionHeader from '../components/SectionHeader.vue';
import { BumpAdvice, useBumpAdvisor } from '../composables/useBumpAdvisor';
import { useBumpImpact } from '../composables/useBumpImpact';
import { useExtensionConfig } from '../composables/useExtensionConfig';
import { useTranslation } from '../utils/i18n';

/**
 * "Does this dependency bump break any extensions?"
 *
 * The question a reviewer has in front of a `rancher/dashboard` Dependabot PR,
 * answered from the three analyses this product already keeps rather than by
 * fetching anything. Opening the page costs three Kubernetes reads.
 *
 * The page is built around one rule: a reading taken at a version an extension
 * no longer publishes cannot support a reassuring answer any more than an
 * alarming one, so it produces "unknown" and offers to re-read that extension.
 * Everything on screen that looks like a caveat is there to keep a confident
 * green row from being the default when nobody has checked anything.
 */

type Done = (ok: boolean) => void;

const t = useTranslation();

const store = useStore();
const impact = useBumpImpact(store);
const advisor = useBumpAdvisor(store);
const { hasLlmAccess, load: loadConfig } = useExtensionConfig(store);

/** What is in the PR box, which is not yet what was read. */
const prInput = ref('');
const bumpInput = ref('');

/** Model output, keyed by package name. Empty until the button is pressed. */
const advice = ref<Record<string, BumpAdvice>>({});
const adviseError = ref<string | null>(null);
const adviseNote = ref<string | null>(null);

const impacts = computed(() => impact.impacts.value);

const checkHint = computed(() => store.getters['i18n/t']('extensionsCenter.bumpImpact.checkHint'));

/**
 * Totals across every package being asked about.
 *
 * `unknown` is counted and shown beside the other three rather than folded
 * into a footnote: on a first visit, before any freshness check has run and
 * with one analysis unbuilt, it is the only number that is not zero, and a
 * summary strip that hid it would read as "nothing is affected".
 */
const summary = computed(() => {
  const rows = impacts.value.flatMap((i) => i.rows);

  return {
    packages: impacts.value.length,
    runtime:  rows.filter((r) => r.reach === 'runtime').length,
    rebuild:  rows.filter((r) => r.reach === 'rebuild').length,
    unknown:  rows.filter((r) => r.reach === 'unknown').length,
    stale:    impact.stale.value.length,
  };
});

const missingDocsLabel = computed(() => {
  const names = impact.missingDocs.value.map((doc) => t(`extensionsCenter.bumpImpact.docs.${ doc }`));

  return names.length ? store.getters['i18n/t']('extensionsCenter.bumpImpact.missingDocs', { docs: names.join(', ') }) : '';
});

/** Packages a press would actually send: the ones with a verified path. */
const advisable = computed(() => impacts.value.filter((i) => i.counts.runtime > 0 || i.counts.rebuild > 0));

const canAdvise = computed(() => hasLlmAccess.value && advisable.value.length > 0);

/**
 * Why the button is off, or what the next press costs.
 *
 * Three reasons it can be off and they are not interchangeable: no provider
 * configured, nothing asked about yet, and nothing worth asking about. The
 * last one is the interesting case — it means the deterministic pass already
 * answered the question, and saying so is better than an inert button.
 */
const adviseHint = computed(() => {
  if (!hasLlmAccess.value) {
    return t('extensionsCenter.bumpImpact.advise.noCredentials');
  }

  if (!impacts.value.length) {
    return t('extensionsCenter.bumpImpact.advise.noBumps');
  }

  if (!advisable.value.length) {
    return t('extensionsCenter.bumpImpact.advise.nothingReached');
  }

  return '';
});

const advisePending = computed(() => {
  return store.getters['i18n/t']('extensionsCenter.bumpImpact.advise.pending', { count: advisable.value.length });
});

async function check(done?: Done) {
  await impact.checkFreshness();
  done?.(!impact.error.value);
}

async function readPr() {
  await impact.loadPr(prInput.value);
  // A new question invalidates the old answers. Keeping them would caption a
  // fresh table with sentences written about a different pull request.
  advice.value = {};
  adviseNote.value = null;
}

function addBump() {
  impact.addBump(bumpInput.value);
  bumpInput.value = '';
}

function clearAll() {
  impact.clearBumps();
  prInput.value = '';
  bumpInput.value = '';
  advice.value = {};
  adviseError.value = null;
  adviseNote.value = null;
}

/**
 * The one AI-powered action on this page, and it is opt-in on every press.
 *
 * It only ever sees packages the deterministic pass found a verified path for;
 * stale and unanalysed rows are withheld by `useBumpAdvisor` rather than
 * filtered here, so this cannot be the place the rule gets forgotten.
 */
async function describe(done: Done) {
  adviseError.value = null;
  adviseNote.value = null;

  const outcome = await advisor.advise(impacts.value);

  if (!outcome.available) {
    adviseError.value = t('extensionsCenter.bumpImpact.advise.noCredentials');
    done(false);

    return;
  }

  advice.value = { ...advice.value, ...outcome.advice };
  adviseError.value = outcome.error;

  if (outcome.skipped.length) {
    adviseNote.value = store.getters['i18n/t']('extensionsCenter.bumpImpact.advise.skipped', { packages: outcome.skipped.join(', ') });
  }

  done(!outcome.error);
}

async function refreshExtension(name: string) {
  await impact.refreshExtension(name);
}

// Reads the three saved analyses. Opening this page costs three Kubernetes
// calls and no GitHub traffic. The config load alongside them is what tells
// the AI button whether it is usable, and is almost always already cached.
onMounted(async() => {
  await Promise.all([impact.load(), loadConfig()]);
});
</script>

<template>
  <div class="dependency-impact">
    <SectionHeader
      :title="t('extensionsCenter.bumpImpact.title')"
      :description="t('extensionsCenter.bumpImpact.description')"
      :last-refreshed="impact.checkedAt.value"
      :loading="impact.loading.value || impact.checking.value || !!impact.refreshing.value"
      :refresh-hint="checkHint"
      @refresh="check"
    />

    <AnalysisProgressBar
      :progress="impact.progress.value"
      title-key="extensionsCenter.bumpImpact.reanalyse.title"
    />

    <Banner
      v-if="impact.error.value"
      color="error"
      :label="impact.error.value"
    />

    <Banner
      v-if="missingDocsLabel"
      color="warning"
      :label="missingDocsLabel"
    />

    <!--
      Two input routes because reviewers arrive from two places: a PR link in a
      review queue, and a package name someone mentioned in chat before a PR
      exists. The second is not a lesser case — it is the one where an answer
      changes what gets merged.
    -->
    <div class="inputs">
      <form
        class="input-row"
        @submit.prevent="readPr"
      >
        <LabeledInput
          v-model:value="prInput"
          class="pr-input"
          :label="t('extensionsCenter.bumpImpact.input.prLabel')"
          :placeholder="t('extensionsCenter.bumpImpact.input.prPlaceholder')"
          :disabled="impact.reading.value"
        />
        <button
          type="submit"
          class="btn role-primary"
          :disabled="impact.reading.value || !prInput.trim()"
        >
          {{ impact.reading.value ? t('extensionsCenter.bumpImpact.input.prReading') : t('extensionsCenter.bumpImpact.input.prSubmit') }}
        </button>
      </form>

      <form
        class="input-row"
        @submit.prevent="addBump"
      >
        <LabeledInput
          v-model:value="bumpInput"
          class="bump-input"
          :label="t('extensionsCenter.bumpImpact.input.bumpLabel')"
          :placeholder="t('extensionsCenter.bumpImpact.input.bumpPlaceholder')"
        />
        <button
          type="submit"
          class="btn role-secondary"
          :disabled="!bumpInput.trim()"
        >
          {{ t('extensionsCenter.bumpImpact.input.bumpSubmit') }}
        </button>
        <button
          v-if="impacts.length"
          type="button"
          class="btn role-link"
          @click="clearAll"
        >
          {{ t('extensionsCenter.bumpImpact.input.clear') }}
        </button>
      </form>
    </div>

    <Banner
      v-if="impact.inputError.value"
      color="info"
      :label="impact.inputError.value"
    />

    <template v-if="impacts.length">
      <div class="summary">
        <div
          v-for="item in [
            { key: 'packages', value: summary.packages },
            { key: 'runtime', value: summary.runtime, bad: summary.runtime > 0 },
            { key: 'rebuild', value: summary.rebuild },
            { key: 'unknown', value: summary.unknown, warn: summary.unknown > 0 },
            { key: 'stale', value: summary.stale, warn: summary.stale > 0 },
          ]"
          :key="item.key"
          class="stat"
          :class="{ bad: item.bad, warn: item.warn }"
        >
          <span class="value">{{ item.value }}</span>
          <span class="label text-muted">{{ t(`extensionsCenter.bumpImpact.summary.${ item.key }`) }}</span>
        </div>
      </div>

      <!--
        Said before any table is read, not after. Until a check has run every
        version on this page is a reading of unknown age, and the difference
        between that and a verified-current one is the difference between
        "nothing is affected" and "nothing was affected when we last looked".
      -->
      <Banner
        v-if="!impact.current.value"
        color="info"
        :label="t('extensionsCenter.bumpImpact.notChecked')"
      />

      <Banner
        v-else-if="summary.stale"
        color="warning"
        :label="t('extensionsCenter.bumpImpact.staleFound', { count: summary.stale, extensions: impact.stale.value.join(', ') })"
      />

      <Banner
        v-else
        color="success"
        :label="t('extensionsCenter.bumpImpact.allCurrent')"
      />

      <Banner
        v-if="adviseError"
        color="error"
        :label="adviseError"
      />

      <Banner
        v-if="adviseNote"
        color="info"
        :label="adviseNote"
      />

      <div class="ai-actions">
        <AsyncButton
          class="role-secondary"
          :action-label="t('extensionsCenter.bumpImpact.advise.action')"
          :waiting-label="t('extensionsCenter.bumpImpact.advise.waiting')"
          :success-label="t('extensionsCenter.bumpImpact.advise.done')"
          :error-label="t('extensionsCenter.bumpImpact.advise.failed')"
          :disabled="!canAdvise"
          @click="describe"
        />

        <span class="text-muted hint">
          <template v-if="adviseHint">{{ adviseHint }}</template>
          <template v-else>
            {{ t('extensionsCenter.bumpImpact.advise.hint') }}
            <strong>{{ advisePending }}</strong>
          </template>
        </span>
      </div>

      <section
        v-for="entry in impacts"
        :key="entry.bump.name"
        class="package"
      >
        <header class="package-header">
          <div class="naming">
            <h3>
              <code>{{ entry.bump.name }}</code>
              <span class="arrow text-muted">→</span>
              <code>{{ entry.bump.version }}</code>
            </h3>

            <span
              v-clean-tooltip="entry.hostProvided
                ? t('extensionsCenter.bumpImpact.hostProvidedNote')
                : t('extensionsCenter.bumpImpact.selfResolvedNote')"
              class="supply"
              :class="entry.hostProvided ? 'host' : 'self'"
            >
              {{ entry.hostProvided
                ? t('extensionsCenter.bumpImpact.hostProvided')
                : t('extensionsCenter.bumpImpact.selfResolved') }}
            </span>

            <a
              v-if="entry.bump.url"
              :href="entry.bump.url"
              target="_blank"
              rel="noopener noreferrer"
              class="pr-link"
            >{{ t('extensionsCenter.bumpImpact.prLink', { number: entry.bump.number }) }}</a>
          </div>

          <span class="counts text-muted">
            {{ t('extensionsCenter.bumpImpact.counts', {
              runtime: entry.counts.runtime,
              rebuild: entry.counts.rebuild,
              unknown: entry.counts.unknown,
            }) }}
          </span>
        </header>

        <!--
          The model's sentence, when there is one, sits above the table and
          never inside it. It is commentary on the release, not evidence about
          an extension, and putting it in a column would make it look like the
          latter.
        -->
        <div
          v-if="advice[entry.bump.name]"
          class="advice"
          :class="`risk-${ advice[entry.bump.name].risk }`"
        >
          <span class="risk-badge">{{ t(`extensionsCenter.bumpImpact.risk.${ advice[entry.bump.name].risk }`) }}</span>
          <div class="advice-body">
            <p class="note">
              {{ advice[entry.bump.name].note }}
            </p>
            <p
              v-if="advice[entry.bump.name].check"
              class="check text-muted"
            >
              {{ t('extensionsCenter.bumpImpact.advise.check', { check: advice[entry.bump.name].check }) }}
            </p>
            <p
              v-if="!advice[entry.bump.name].hadNotes"
              class="check text-muted"
            >
              {{ t('extensionsCenter.bumpImpact.advise.noNotes') }}
            </p>
          </div>
        </div>

        <BumpImpactTable
          :rows="entry.rows"
          :refreshing="impact.refreshing.value"
          @refresh="refreshExtension"
        />
      </section>
    </template>

    <Banner
      v-else
      color="info"
      :label="t('extensionsCenter.bumpImpact.empty')"
    />

    <!--
      Every way this page can be wrong, in one place and always visible.
      Folding it away would be the wrong trade: the failure mode here is a
      reviewer reading a confident "not affected" off a table built from a
      reading taken weeks ago, and a caveat nobody expands does not prevent
      that.
    -->
    <section class="caveats">
      <h4>{{ t('extensionsCenter.bumpImpact.caveats.title') }}</h4>
      <ul>
        <li
          v-for="key in ['staleness', 'lockfile', 'specifiers', 'transitive', 'branch', 'hostList', 'model']"
          :key="key"
        >
          <strong>{{ t(`extensionsCenter.bumpImpact.caveats.${ key }.title`) }}</strong>
          {{ t(`extensionsCenter.bumpImpact.caveats.${ key }.body`) }}
        </li>
      </ul>
    </section>
  </div>
</template>

<style lang="scss" scoped>
@import '../styles/severity';

.dependency-impact {
  padding-bottom: 40px;

  .inputs {
    display: flex;
    flex-wrap: wrap;
    gap: 24px;
    margin-bottom: 16px;
  }

  .input-row {
    align-items: flex-end;
    display: flex;
    gap: 12px;
  }

  // Wide enough for a full GitHub pull request URL without wrapping, which is
  // the form most people will paste.
  .pr-input {
    min-width: 420px;
  }

  .bump-input {
    min-width: 240px;
  }

  .summary {
    display: grid;
    gap: 12px;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    margin-bottom: 12px;
  }

  .stat {
    background: var(--box-bg);
    border: 1px solid var(--border);
    border-radius: var(--border-radius);
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 12px 16px;

    &.bad .value {
      color: var(--error);
    }

    &.warn .value {
      color: var(--warning);
    }

    .value {
      font-size: 22px;
      font-weight: 600;
    }

    .label {
      font-size: 12px;
    }
  }

  .ai-actions {
    align-items: center;
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    margin-bottom: 16px;

    .hint {
      font-size: 12px;
    }
  }

  .package {
    margin-bottom: 32px;
  }

  .package-header {
    align-items: baseline;
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    justify-content: space-between;
    margin-bottom: 8px;

    h3 {
      margin: 0;
    }

    .arrow {
      margin: 0 6px;
    }

    .counts {
      font-size: 12px;
    }

    .pr-link {
      font-size: 12px;
    }
  }

  .naming {
    align-items: baseline;
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }

  .supply {
    border-radius: 10px;
    font-size: 11px;
    font-weight: 600;
    padding: 1px 8px;
    text-transform: uppercase;
  }

  .supply.host {
    background: $high-color;
    color: $on-severity;
  }

  .supply.self {
    background: $zero-color-light;
    color: var(--disabled-text);

    body.theme-dark & {
      background: $zero-color-dark;
    }
  }

  .advice {
    background: var(--box-bg);
    border: 1px solid var(--border);
    border-left-width: 4px;
    border-radius: var(--border-radius);
    display: flex;
    gap: 12px;
    margin-bottom: 8px;
    padding: 10px 14px;

    p {
      margin: 0;
    }

    .note {
      font-size: 13px;
    }

    .check {
      font-size: 12px;
      margin-top: 4px;
    }
  }

  .risk-badge {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    white-space: nowrap;
  }

  .advice.risk-breaking {
    border-left-color: $critical-color;

    .risk-badge {
      color: $critical-color;
    }
  }

  .advice.risk-watch {
    border-left-color: $medium-color;

    .risk-badge {
      color: $medium-color;
    }
  }

  .advice.risk-safe {
    border-left-color: var(--success);

    .risk-badge {
      color: var(--success);
    }
  }

  .advice.risk-unclear {
    border-left-color: $na-color;

    .risk-badge {
      color: var(--muted);
    }
  }

  .caveats {
    background: var(--box-bg);
    border: 1px solid var(--border);
    border-radius: var(--border-radius);
    margin-top: 32px;
    padding: 16px;

    h4 {
      margin: 0 0 8px;
    }

    ul {
      font-size: 12px;
      margin: 0;
      padding-left: 18px;
    }

    li + li {
      margin-top: 6px;
    }

    strong {
      margin-right: 4px;
    }
  }
}
</style>
