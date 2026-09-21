import { ref, Ref } from 'vue';

import { GhJob, GhJobsResponse, GhWorkflowRun, GhWorkflowRunsResponse } from '../types/github';
import { RancherStore } from '../types/rancher';
import { TestRun, TestRunDetail } from '../types/tests';
import { mapRun, mapRunDetail } from '../utils/runs';
import { useGitHubApi, describeGitHubError } from './useGitHubApi';

export interface TestRunsSource {
  /** `owner/name` */
  repo: string;
  /** Workflow file name, e.g. `test-extension-workflows-master.yml` */
  workflowFile: string;
}

/**
 * Loads workflow runs for one source, one page at a time.
 *
 * Runs come back from `/actions/workflows/{file}/runs`, but that payload has no
 * per-job breakdown, so each run needs a follow-up `/jobs` call. Those are
 * issued in parallel for the page being shown — a page of 10 costs 11 requests,
 * which is why a configured GitHub token is effectively required.
 */
export function useTestRuns(store: RancherStore, source: TestRunsSource, perPage = 10) {
  const api = useGitHubApi(store);

  const data: Ref<TestRun[]> = ref([]);
  const totalCount = ref(0);
  const page = ref(1);
  const loading = ref(false);
  const error: Ref<string | null> = ref(null);
  const lastRefreshed: Ref<Date | null> = ref(null);

  const fetchJobs = async(runId: number): Promise<GhJob[]> => {
    try {
      const res = await api.get<GhJobsResponse>(
        `/repos/${ source.repo }/actions/runs/${ runId }/jobs`,
        { per_page: 100 }
      );

      return res.jobs || [];
    } catch (e) {
      // A run whose jobs have been expired/purged should not sink the page —
      // it just renders with no stages and zero counts.
      console.warn(`extensions-center: could not load jobs for run ${ runId }`, e); // eslint-disable-line no-console

      return [];
    }
  };

  const refresh = async(): Promise<void> => {
    loading.value = true;
    error.value = null;

    try {
      const res = await api.get<GhWorkflowRunsResponse>(
        `/repos/${ source.repo }/actions/workflows/${ source.workflowFile }/runs`,
        { per_page: perPage, page: page.value }
      );

      // GitHub caps `total_count` at 1000 for this endpoint; that is well past
      // anything a human will page through, so it is used as-is.
      totalCount.value = res.total_count || 0;

      const runs: GhWorkflowRun[] = res.workflow_runs || [];
      const jobs = await Promise.all(runs.map((run) => fetchJobs(run.id)));

      // Newest first, stated rather than inherited. GitHub does return this
      // endpoint that way already, but the order is the one thing about this
      // table that must not be accidental — sorting within the page is safe
      // because the page is a slice of that same server-side ordering.
      data.value = runs
        .map((run, i) => mapRun(run, jobs[i]))
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      lastRefreshed.value = new Date();
    } catch (e) {
      error.value = describeGitHubError(e);
      data.value = [];
    } finally {
      loading.value = false;
    }
  };

  const setPage = async(next: number): Promise<void> => {
    page.value = next;
    await refresh();
  };

  return {
    data, totalCount, page, perPage, loading, error, lastRefreshed, refresh, setPage
  };
}

/** Loads one run plus its jobs and steps for the detail page. */
export function useTestRunDetail(store: RancherStore, repo: string, runId: Ref<string | number>) {
  const api = useGitHubApi(store);

  const data: Ref<TestRunDetail | null> = ref(null);
  const loading = ref(false);
  const error: Ref<string | null> = ref(null);
  const lastRefreshed: Ref<Date | null> = ref(null);

  const refresh = async(): Promise<void> => {
    loading.value = true;
    error.value = null;

    try {
      const [run, jobsRes] = await Promise.all([
        api.get<GhWorkflowRun>(`/repos/${ repo }/actions/runs/${ runId.value }`),
        api.get<GhJobsResponse>(`/repos/${ repo }/actions/runs/${ runId.value }/jobs`, { per_page: 100 }),
      ]);

      data.value = mapRunDetail(run, jobsRes.jobs || []);
      lastRefreshed.value = new Date();
    } catch (e) {
      error.value = describeGitHubError(e);
      data.value = null;
    } finally {
      loading.value = false;
    }
  };

  return {
    data, loading, error, lastRefreshed, refresh
  };
}
