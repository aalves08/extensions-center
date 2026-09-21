/**
 * The slices of the GitHub REST payloads this extension actually reads.
 *
 * These are deliberately partial: GitHub returns far more per object than we
 * need, and declaring only the fields we touch keeps the mappers honest about
 * what they depend on.
 */

export interface GhUser {
  login: string;
}

export interface GhStep {
  number: number;
  name: string;
  status?: string | null;
  conclusion?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
}

export interface GhJob {
  id: number;
  name: string;
  status?: string | null;
  conclusion?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  html_url: string;
  runner_name?: string | null;
  steps?: GhStep[];
}

export interface GhJobsResponse {
  total_count: number;
  jobs: GhJob[];
}

export interface GhWorkflowRun {
  id: number;
  name?: string | null;
  display_title?: string | null;
  run_number: number;
  run_attempt?: number;
  status?: string | null;
  conclusion?: string | null;
  head_branch: string;
  head_sha: string;
  event: string;
  actor?: GhUser;
  triggering_actor?: GhUser;
  created_at: string;
  updated_at: string;
  run_started_at?: string | null;
  html_url: string;
  head_commit?: { message?: string } | null;
  repository?: { html_url?: string } | null;
}

export interface GhWorkflowRunsResponse {
  total_count: number;
  workflow_runs: GhWorkflowRun[];
}

export interface GhRepo {
  full_name: string;
  html_url: string;
  default_branch: string;
  description?: string | null;
  topics?: string[];
  stargazers_count?: number;
  pushed_at?: string | null;
  fork?: boolean;
}

export interface GhRelease {
  id: number;
  tag_name: string;
}

export interface GhCodeSearchItem {
  path: string;
  repository: { full_name: string };
}

export interface GhCodeSearchResponse {
  total_count: number;
  items: GhCodeSearchItem[];
}

/** A parsed `package.json` — only the dependency maps matter to us. */
export interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  resolutions?: Record<string, string>;
}
