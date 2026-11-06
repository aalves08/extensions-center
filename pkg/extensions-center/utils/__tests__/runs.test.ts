import { GhJob, GhWorkflowRun } from '../../types/github';
import { TestStage } from '../../types/tests';
import {
  countsFromStages,
  durationBetween,
  formatDuration,
  mapRun,
  mapRunDetail,
  mapStage,
  normaliseStatus
} from '../runs';

function job(over: Partial<GhJob> = {}): GhJob {
  return {
    id:           1,
    name:         'build (elemental)',
    status:       'completed',
    conclusion:   'success',
    started_at:   '2025-03-01T10:00:00Z',
    completed_at: '2025-03-01T10:04:12Z',
    html_url:     'https://github.com/x/y/actions/runs/1/job/1',
    ...over,
  };
}

function run(over: Partial<GhWorkflowRun> = {}): GhWorkflowRun {
  return {
    id:             99,
    name:           'Nightly extension tests',
    run_number:     42,
    run_attempt:    2,
    status:         'completed',
    conclusion:     'success',
    head_branch:    'main',
    head_sha:       'abc123',
    event:          'schedule',
    actor:          { login: 'octocat' } as GhWorkflowRun['actor'],
    created_at:     '2025-03-01T09:58:00Z',
    updated_at:     '2025-03-01T10:30:00Z',
    run_started_at: '2025-03-01T10:00:00Z',
    html_url:       'https://github.com/x/y/actions/runs/99',
    ...over,
  };
}

function stage(status: TestStage['status'], id = 1): TestStage {
  return {
    id, name: `job-${ id }`, status, durationMs: null, htmlUrl: ''
  };
}

describe('normaliseStatus', () => {
  it.each(['queued', 'waiting', 'pending', 'requested'])('reads %s as queued', (status) => {
    // GitHub has four words for "has not started"; the UI colours one.
    expect(normaliseStatus(status, null)).toBe('queued');
  });

  it('reads in_progress before looking at the conclusion', () => {
    // A re-run in flight still carries the previous conclusion.
    expect(normaliseStatus('in_progress', 'failure')).toBe('in_progress');
  });

  it('reads the conclusion once the run is complete', () => {
    expect(normaliseStatus('completed', 'success')).toBe('success');
    expect(normaliseStatus('completed', 'cancelled')).toBe('cancelled');
  });

  it.each(['failure', 'timed_out', 'startup_failure'])('counts %s as a failure', (conclusion) => {
    expect(normaliseStatus('completed', conclusion)).toBe('failure');
  });

  it.each(['skipped', 'neutral'])('counts %s as skipped', (conclusion) => {
    expect(normaliseStatus('completed', conclusion)).toBe('skipped');
  });

  it('is unknown for a conclusion it does not recognise, and for none at all', () => {
    expect(normaliseStatus('completed', 'action_required')).toBe('unknown');
    expect(normaliseStatus('completed', null)).toBe('unknown');
    expect(normaliseStatus()).toBe('unknown');
  });
});

describe('durationBetween', () => {
  it('measures the gap in milliseconds', () => {
    expect(durationBetween('2025-03-01T10:00:00Z', '2025-03-01T10:04:12Z')).toBe(252_000);
  });

  it('has nothing to measure while a job is still running', () => {
    expect(durationBetween('2025-03-01T10:00:00Z', null)).toBeNull();
    expect(durationBetween(null, '2025-03-01T10:00:00Z')).toBeNull();
    expect(durationBetween()).toBeNull();
  });

  it('refuses a negative span rather than rendering it', () => {
    expect(durationBetween('2025-03-01T10:04:00Z', '2025-03-01T10:00:00Z')).toBeNull();
  });

  it('returns null rather than NaN for an unparseable timestamp', () => {
    expect(durationBetween('yesterday', '2025-03-01T10:00:00Z')).toBeNull();
  });

  it('is zero for a job that started and ended on the same instant', () => {
    expect(durationBetween('2025-03-01T10:00:00Z', '2025-03-01T10:00:00Z')).toBe(0);
  });
});

describe('formatDuration', () => {
  it('drops to seconds under a minute', () => {
    expect(formatDuration(38_000)).toBe('38s');
    expect(formatDuration(0)).toBe('0s');
  });

  it('pads the seconds under an hour', () => {
    expect(formatDuration(252_000)).toBe('4m 12s');
    expect(formatDuration(305_000)).toBe('5m 05s');
  });

  it('drops the seconds past an hour and pads the minutes', () => {
    expect(formatDuration(3_840_000)).toBe('1h 04m');
    expect(formatDuration(3_600_000)).toBe('1h 00m');
  });

  it('rounds to the nearest second', () => {
    expect(formatDuration(1_600)).toBe('2s');
  });

  it('prints a dash rather than an empty cell when there is nothing to show', () => {
    expect(formatDuration(null)).toBe('—');
  });
});

describe('countsFromStages', () => {
  it('counts each job as one test', () => {
    // A job in these workflows is one test target, which is why the job
    // outcomes are what gets counted.
    expect(countsFromStages([
      stage('success', 1), stage('success', 2), stage('failure', 3),
    ])).toEqual({
      total: 3, passed: 2, failed: 1, skipped: 0
    });
  });

  it('counts a skipped job, which is what stops a green run reading "9 tests, 8 passed"', () => {
    expect(countsFromStages([stage('success'), stage('skipped', 2)])).toEqual({
      total: 2, passed: 1, failed: 0, skipped: 1
    });
  });

  it('files a cancelled job with the skipped ones, since neither ran', () => {
    expect(countsFromStages([stage('cancelled')])).toEqual({
      total: 1, passed: 0, failed: 0, skipped: 1
    });
  });

  it('leaves an in-flight job out of every bucket but the total', () => {
    // So a running run shows a total larger than its parts until it settles.
    expect(countsFromStages([
      stage('success', 1), stage('in_progress', 2), stage('queued', 3), stage('unknown', 4),
    ])).toEqual({
      total: 4, passed: 1, failed: 0, skipped: 0
    });
  });

  it('is all zeroes for a run with no jobs', () => {
    expect(countsFromStages([])).toEqual({
      total: 0, passed: 0, failed: 0, skipped: 0
    });
  });
});

describe('mapStage', () => {
  it('carries the fields the stage column renders', () => {
    expect(mapStage(job())).toEqual({
      id:         1,
      name:       'build (elemental)',
      status:     'success',
      durationMs: 252_000,
      htmlUrl:    'https://github.com/x/y/actions/runs/1/job/1',
    });
  });

  it('leaves the duration null while the job is still running', () => {
    expect(mapStage(job({
      status: 'in_progress', conclusion: null, completed_at: null
    }))).toMatchObject({ status: 'in_progress', durationMs: null });
  });
});

describe('mapRun', () => {
  it('maps the run and derives its counts from the jobs', () => {
    const result = mapRun(run(), [job({ id: 1 }), job({ id: 2, conclusion: 'failure' })]);

    expect(result).toMatchObject({
      id:         99,
      runNumber:  42,
      runAttempt: 2,
      name:       'Nightly extension tests',
      status:     'success',
      headBranch: 'main',
      headSha:    'abc123',
      event:      'schedule',
      actor:      'octocat',
      counts:     {
        total: 2, passed: 1, failed: 1, skipped: 0
      },
    });
    expect(result.stages).toHaveLength(2);
  });

  it('times the run from when it started rather than when it was created', () => {
    // A queued run can sit for minutes; counting that as runtime inflates it.
    expect(mapRun(run(), []).durationMs).toBe(1_800_000);
  });

  it('falls back to creation time when the run never recorded a start', () => {
    expect(mapRun(run({ run_started_at: null }), []).durationMs).toBe(1_920_000);
  });

  it('assumes a first attempt when GitHub omits the count', () => {
    expect(mapRun(run({ run_attempt: undefined }), []).runAttempt).toBe(1);
  });

  it('names an unnamed run after its number rather than leaving it blank', () => {
    expect(mapRun(run({ name: null, display_title: 'Fix the thing' }), []).name).toBe('Fix the thing');
    expect(mapRun(run({ name: null, display_title: null }), []).name).toBe('Run #42');
  });

  it('copes with a run that has no actor', () => {
    expect(mapRun(run({ actor: undefined }), []).actor).toBe('');
  });
});

describe('mapRunDetail', () => {
  it('keeps everything the list already had', () => {
    const jobs = [job()];

    expect(mapRunDetail(run(), jobs)).toMatchObject(mapRun(run(), jobs));
  });

  it('adds the per-job detail the page renders', () => {
    const detail = mapRunDetail(run(), [job({
      runner_name: 'ubuntu-latest',
      steps:       [
        {
          number: 1, name: 'Checkout', status: 'completed', conclusion: 'success', started_at: '2025-03-01T10:00:00Z', completed_at: '2025-03-01T10:00:10Z'
        },
        {
          number: 2, name: 'Test', status: 'completed', conclusion: 'failure', started_at: null, completed_at: null
        },
      ],
    })]);

    expect(detail.jobs[0]).toMatchObject({
      startedAt: '2025-03-01T10:00:00Z', completedAt: '2025-03-01T10:04:12Z', runnerName: 'ubuntu-latest'
    });
    expect(detail.jobs[0].steps).toEqual([
      {
        number: 1, name: 'Checkout', status: 'success', durationMs: 10_000
      },
      {
        number: 2, name: 'Test', status: 'failure', durationMs: null
      },
    ]);
  });

  it('builds a commit link out of the repo and the sha', () => {
    const detail = mapRunDetail(run({ repository: { html_url: 'https://github.com/rancher/dashboard' } }), []);

    expect(detail.headCommitUrl).toBe('https://github.com/rancher/dashboard/commit/abc123');
  });

  it('takes only the first line of the commit message', () => {
    const detail = mapRunDetail(run({ head_commit: { message: 'Fix the thing\n\nLong explanation' } }), []);

    expect(detail.headCommitMessage).toBe('Fix the thing');
  });

  it('falls back to the actor when no triggering actor is recorded', () => {
    expect(mapRunDetail(run(), []).triggeringActor).toBe('octocat');
    expect(mapRunDetail(run({ triggering_actor: { login: 'dependabot[bot]' } as GhWorkflowRun['actor'] }), []).triggeringActor)
      .toBe('dependabot[bot]');
  });

  it('leaves the derived strings empty rather than printing "undefined"', () => {
    const detail = mapRunDetail(run({
      name: null, repository: null, head_commit: null
    }), []);

    expect(detail.workflowName).toBe('');
    expect(detail.headCommitMessage).toBe('');
    expect(detail.headCommitUrl).toBe('/commit/abc123');
  });

  it('reports no jobs rather than failing on a run whose jobs could not be listed', () => {
    expect(mapRunDetail(run(), []).jobs).toEqual([]);
  });
});
