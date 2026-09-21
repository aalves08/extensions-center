import { GhJob, GhWorkflowRun } from '../types/github';
import {
  RunStatus, TestCounts, TestRun, TestRunDetail, TestRunJob, TestRunStep, TestStage
} from '../types/tests';

/**
 * GitHub reports `status` (queued/in_progress/completed) and, once complete,
 * `conclusion` (success/failure/…). Collapse the two into the single value the
 * UI colours on.
 */
export function normaliseStatus(status?: string | null, conclusion?: string | null): RunStatus {
  if (status === 'queued' || status === 'waiting' || status === 'pending' || status === 'requested') {
    return 'queued';
  }

  if (status === 'in_progress') {
    return 'in_progress';
  }

  switch (conclusion) {
  case 'success':
    return 'success';
  case 'failure':
  case 'timed_out':
  case 'startup_failure':
    return 'failure';
  case 'cancelled':
    return 'cancelled';
  case 'skipped':
  case 'neutral':
    return 'skipped';
  default:
    return 'unknown';
  }
}

/** Milliseconds between two ISO timestamps, null when either is missing. */
export function durationBetween(start?: string | null, end?: string | null): number | null {
  if (!start || !end) {
    return null;
  }

  const ms = new Date(end).getTime() - new Date(start).getTime();

  return Number.isFinite(ms) && ms >= 0 ? ms : null;
}

/** `1h 04m`, `4m 12s`, `38s` — compact enough for a table cell. */
export function formatDuration(ms: number | null): string {
  if (ms === null) {
    return '—';
  }

  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${ hours }h ${ String(minutes).padStart(2, '0') }m`;
  }

  if (minutes > 0) {
    return `${ minutes }m ${ String(seconds).padStart(2, '0') }s`;
  }

  return `${ seconds }s`;
}

/**
 * Each job in these workflows is one test target (an extension, or an
 * extension/Rancher-version pair), so job outcomes are what we count as tests.
 *
 * Skipped and cancelled jobs share a bucket: neither ran, and the distinction
 * does not change how you read the run. Counting them matters — a job that GitHub
 * skips is a real part of the run, so leaving it out is what makes a green run
 * report "9 tests, 8 passed, 0 failed". Jobs still queued or running are
 * deliberately in none of the buckets, so an in-flight run shows a total larger
 * than its parts until it settles.
 */
export function countsFromStages(stages: TestStage[]): TestCounts {
  return stages.reduce<TestCounts>((acc, stage) => {
    acc.total++;

    if (stage.status === 'success') {
      acc.passed++;
    } else if (stage.status === 'failure') {
      acc.failed++;
    } else if (stage.status === 'skipped' || stage.status === 'cancelled') {
      acc.skipped++;
    }

    return acc;
  }, {
    total: 0, passed: 0, failed: 0, skipped: 0
  });
}

/** Map a GitHub jobs API entry onto a stage. */
export function mapStage(job: GhJob): TestStage {
  return {
    id:         job.id,
    name:       job.name,
    status:     normaliseStatus(job.status, job.conclusion),
    durationMs: durationBetween(job.started_at, job.completed_at),
    htmlUrl:    job.html_url,
  };
}

function mapSteps(job: GhJob): TestRunStep[] {
  return (job.steps || []).map((step) => ({
    number:     step.number,
    name:       step.name,
    status:     normaliseStatus(step.status, step.conclusion),
    durationMs: durationBetween(step.started_at, step.completed_at),
  }));
}

/** Map a GitHub workflow-run API entry plus its jobs onto a `TestRun`. */
export function mapRun(run: GhWorkflowRun, jobs: GhJob[]): TestRun {
  const stages = jobs.map(mapStage);

  return {
    id:         run.id,
    runNumber:  run.run_number,
    runAttempt: run.run_attempt ?? 1,
    name:       run.name || run.display_title || `Run #${ run.run_number }`,
    status:     normaliseStatus(run.status, run.conclusion),
    headBranch: run.head_branch,
    headSha:    run.head_sha,
    event:      run.event,
    actor:      run.actor?.login || '',
    createdAt:  run.created_at,
    updatedAt:  run.updated_at,
    durationMs: durationBetween(run.run_started_at || run.created_at, run.updated_at),
    htmlUrl:    run.html_url,
    counts:     countsFromStages(stages),
    stages,
  };
}

/** Map the same payload onto the richer shape the detail page renders. */
export function mapRunDetail(run: GhWorkflowRun, jobs: GhJob[]): TestRunDetail {
  const base = mapRun(run, jobs);

  const detailJobs: TestRunJob[] = jobs.map((job) => ({
    ...mapStage(job),
    startedAt:   job.started_at || null,
    completedAt: job.completed_at || null,
    runnerName:  job.runner_name || null,
    steps:       mapSteps(job),
  }));

  return {
    ...base,
    workflowName:      run.name || '',
    triggeringActor:   run.triggering_actor?.login || base.actor,
    headCommitUrl:     `${ run.repository?.html_url || '' }/commit/${ run.head_sha }`,
    headCommitMessage: run.head_commit?.message?.split('\n')[0] || '',
    jobs:              detailJobs,
  };
}
