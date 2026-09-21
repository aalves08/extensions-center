/**
 * Data models for the two GitHub Actions test suites this extension tracks:
 * the nightly extension workflow tests and the extension compatibility tests.
 */

/** GitHub Actions run conclusion, normalised to what we actually render */
export type RunStatus =
  | 'success'
  | 'failure'
  | 'cancelled'
  | 'skipped'
  | 'in_progress'
  | 'queued'
  | 'unknown';

/** One job inside a run — rendered as a "stage" column on the dashboard */
export interface TestStage {
  id: number;
  name: string;
  status: RunStatus;
  /** Milliseconds between job start and completion, null while still running */
  durationMs: number | null;
  htmlUrl: string;
}

/** Aggregated pass/fail counts for a run, derived from its jobs and steps */
export interface TestCounts {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
}

/** A single workflow run, shared shape for both workflow and compatibility tests */
export interface TestRun {
  /** GitHub run id — used as the row id and the detail route param */
  id: number;
  runNumber: number;
  /** Run attempt, >1 when the run was re-run */
  runAttempt: number;
  name: string;
  status: RunStatus;
  headBranch: string;
  headSha: string;
  event: string;
  actor: string;
  createdAt: string;
  updatedAt: string;
  /** Milliseconds from run creation to last update, null while still running */
  durationMs: number | null;
  htmlUrl: string;
  counts: TestCounts;
  stages: TestStage[];
}

/** Everything the detail page shows on top of what the list already has */
export interface TestRunDetail extends TestRun {
  workflowName: string;
  triggeringActor: string;
  /** Link to the commit the run was built from */
  headCommitUrl: string;
  headCommitMessage: string;
  /** Per-job step breakdown */
  jobs: TestRunJob[];
}

export interface TestRunJob extends TestStage {
  startedAt: string | null;
  completedAt: string | null;
  runnerName: string | null;
  steps: TestRunStep[];
}

export interface TestRunStep {
  number: number;
  name: string;
  status: RunStatus;
  durationMs: number | null;
}

/** What SortableTable expects when it is paged externally */
export interface PaginationResult {
  count: number;
  pages: number;
}
