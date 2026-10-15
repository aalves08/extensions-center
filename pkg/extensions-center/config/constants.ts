/**
 * Shared constants for the Extensions Center extension.
 */

import { SecurityTarget } from '../types/security';

/** Product name, as registered with `addProduct` */
export const PRODUCT_NAME = 'extensions-center';

/**
 * The same product name, with hyphens removed.
 *
 * The shell strips hyphens from a product's name before it registers the
 * product and generates its routes (see `replaceAll` in
 * `@shell/core/plugin-products-top-level`), so the product the router resolves
 * is `extensionscenter`, not `extensions-center`. Anything we build by hand —
 * route names, route paths, the `product` param — has to use this form, or the
 * shell fails the route with "Product extensions-center not found".
 */
export const PRODUCT_ROUTE_NAME = PRODUCT_NAME.replaceAll('-', '');

/** Rancher uses `_` as the cluster id for top-level (non cluster-scoped) products */
export const BLANK_CLUSTER = '_';

/**
 * Route names.
 *
 * The shell generates `<product>-c-cluster-<pageName>` for every custom page
 * registered through `addProduct`. Detail pages are registered manually via
 * `addRoutes` and follow the same convention so they sit inside the product.
 */
export const ROUTES = {
  DASHBOARD:            `${ PRODUCT_ROUTE_NAME }-c-cluster-dashboard`,
  WORKFLOW_TESTS:       `${ PRODUCT_ROUTE_NAME }-c-cluster-workflow-tests`,
  WORKFLOW_TEST_DETAIL: `${ PRODUCT_ROUTE_NAME }-c-cluster-workflow-tests-detail`,
  COMPAT_TESTS:         `${ PRODUCT_ROUTE_NAME }-c-cluster-compat-tests`,
  COMPAT_TEST_DETAIL:   `${ PRODUCT_ROUTE_NAME }-c-cluster-compat-tests-detail`,
  KNOWN_REPOS:          `${ PRODUCT_ROUTE_NAME }-c-cluster-known-repos`,
  NPM_METRICS:          `${ PRODUCT_ROUTE_NAME }-c-cluster-npm-metrics`,
  IMPORT_ANALYSIS:      `${ PRODUCT_ROUTE_NAME }-c-cluster-import-analysis`,
  BUNDLE_ANALYSIS:      `${ PRODUCT_ROUTE_NAME }-c-cluster-bundle-analysis`,
  SECURITY:             `${ PRODUCT_ROUTE_NAME }-c-cluster-security`,
  SETTINGS:             `${ PRODUCT_ROUTE_NAME }-c-cluster-settings`,
} as const;

/** Namespace and names of the Kubernetes objects this extension owns */
export const CONFIG_NAMESPACE = 'cattle-system';
export const CONFIG_SECRET_NAME = 'extensions-center-config';
export const KNOWN_REPOS_CONFIGMAP_NAME = 'extensions-center-known-repos';
export const IMPORT_ANALYSIS_CONFIGMAP_NAME = 'extensions-center-import-analysis';
export const BUNDLE_ANALYSIS_CONFIGMAP_NAME = 'extensions-center-bundle-analysis';

export const CONFIG_SECRET_ID = `${ CONFIG_NAMESPACE }/${ CONFIG_SECRET_NAME }`;
export const KNOWN_REPOS_CONFIGMAP_ID = `${ CONFIG_NAMESPACE }/${ KNOWN_REPOS_CONFIGMAP_NAME }`;

/** Secret data keys */
export const SECRET_KEYS = {
  GITHUB_TOKEN: 'github-token',

  /** Which of LLM_PROVIDERS the classifier should call */
  LLM_PROVIDER: 'llm-provider',
  /** Optional per-provider model id override */
  LLM_MODEL:    'llm-model',

  ANTHROPIC_KEY: 'anthropic-api-key',

  AWS_ACCESS_KEY_ID:     'aws-access-key-id',
  AWS_SECRET_ACCESS_KEY: 'aws-secret-access-key',
  AWS_SESSION_TOKEN:     'aws-session-token',
  AWS_REGION:            'aws-region',

  CLAUDE_AWS_API_KEY:      'claude-aws-api-key',
  CLAUDE_AWS_WORKSPACE_ID: 'claude-aws-workspace-id',
  CLAUDE_AWS_REGION:       'claude-aws-region',
} as const;

/** Upstream sources */
export const GITHUB_API = 'https://api.github.com';

/**
 * Host that has to be allow-listed on Rancher's `/meta/proxy` before code
 * search can be called at all, and the name of the `ProxyEndpoint` we create
 * for it. Fixed rather than generated so repeated visits reuse one object.
 */
export const GITHUB_PROXY_DOMAIN = 'api.github.com';
export const PROXY_ENDPOINT_NAME = 'extensions-center-github';
export const NPM_DOWNLOADS_API = 'https://api.npmjs.org';
export const NPM_REGISTRY_API = 'https://registry.npmjs.org';

/** rancher/dashboard nightly extension workflow tests */
export const WORKFLOW_TESTS_REPO = 'rancher/dashboard';
export const WORKFLOW_TESTS_FILE = 'test-extension-workflows-master.yml';

/** Extension compatibility tests */
export const COMPAT_TESTS_REPO = 'rancher/dashboard';
export const COMPAT_TESTS_FILE = 'extension-compatibility-test.yml';

/** Official extensions manifest */
export const OFFICIAL_MANIFEST_URL =
  'https://raw.githubusercontent.com/rancher/ui-plugin-charts/main/manifest.json';

/** The same manifest, as repo and path, for callers that go through the API */
export const OFFICIAL_MANIFEST_REPO = 'rancher/ui-plugin-charts';
export const OFFICIAL_MANIFEST_PATH = 'manifest.json';

/** Branch of rancher/dashboard that import paths are resolved against */
export const DASHBOARD_REPO = 'rancher/dashboard';
export const DASHBOARD_BRANCH = 'master';

/** Branch every extension publishes its built plugin assets to */
export const PUBLISH_BRANCH = 'gh-pages';

/** npm packages tracked on the metrics page */
export const TRACKED_PACKAGES = ['@rancher/shell', '@rancher/components'] as const;

/**
 * The repos the Security page always shows, on top of every official extension.
 *
 * These three are not extensions themselves — they are the catalogue, the
 * worked example and the partner index — so they are not in `manifest.json`
 * and have to be named here. Everything else on that page comes from the
 * manifest, so a new official extension gets a tab with no code change.
 */
export const SECURITY_FIXED_REPOS = [
  'rancher/ui-plugin-charts',
  'rancher/ui-plugin-examples',
  'rancher/partner-extensions',
] as const;

/**
 * The two published NPM packages, as tabs on the Security page.
 *
 * Neither has a repository of its own — both are directories inside
 * `rancher/dashboard` — so neither can be a plain repo target. Each is a slice
 * of one monorepo's alert list, and the two slices are not cut the same way.
 *
 * `@rancher/shell` has its own lockfile. Dependabot records the manifest every
 * alert was raised against, so `shell/yarn.lock` plus `shell/package.json`
 * yields exactly the shell's dependency tree and nothing else — as accurate as
 * a dedicated repo would be, and 304 alerts deep, so the chart has real
 * history rather than a stub.
 *
 * `@rancher/components` is the awkward one. It has a `package.json` Dependabot
 * files direct-dependency alerts against, and it had a `yarn.lock` until 2022,
 * so those two manifests are exact as far as they go. What they cannot see is
 * anything transitive since the lockfile went away: those resolve through the
 * workspace root and land in the root `yarn.lock` with the entire dashboard,
 * where no manifest path separates them. The `shared` rule picks them back out
 * by name, which recovers its direct dependencies and still cannot recover
 * transitive ones — which is what the tab says on its face.
 *
 * Declared means `dependencies` and `peerDependencies`, not `devDependencies`:
 * those are the ones a consumer actually installs, and the package shares most
 * of its build-time tooling with the dashboard, so counting those would charge
 * the whole monorepo's toolchain to this tab.
 */
export const SECURITY_NPM_TARGETS: SecurityTarget[] = [
  {
    id:    'rancher-shell',
    repo:  DASHBOARD_REPO,
    label: '@rancher/shell',
    fixed: true,
    scope: {
      ownManifests: ['shell/yarn.lock', 'shell/package.json'],
      noteKey:      'extensionsCenter.security.scopeNote.shell',
    },
  },
  {
    id:    'rancher-components',
    repo:  DASHBOARD_REPO,
    label: '@rancher/components',
    fixed: true,
    scope: {
      ownManifests: ['pkg/rancher-components/yarn.lock', 'pkg/rancher-components/package.json'],
      shared:       {
        manifests:  ['yarn.lock', 'package.json'],
        declaredBy: 'pkg/rancher-components/package.json',
      },
      noteKey: 'extensionsCenter.security.scopeNote.components',
    },
  },
];

/**
 * OSV.dev, used for repos whose Dependabot alerts the token cannot read.
 *
 * Called straight from the browser: it answers a preflight with
 * `access-control-allow-origin` for any origin and needs no credential, so
 * unlike GitHub code search it does not have to go through Rancher's proxy.
 */
export const OSV_API = 'https://api.osv.dev';

/** OSV caps a `querybatch` body, and 100 is the size the docs use. */
export const OSV_BATCH_SIZE = 100;

/**
 * In-flight requests when reading one repo's vulnerabilities.
 *
 * Measured against the heaviest repo (2,230 packages, 225 distinct advisories):
 * serial takes 76s, eight at a time takes 9s. Going wider stops helping — the
 * batch phase is only ~20 requests — and risks tripping OSV's rate limiting.
 */
export const SECURITY_CONCURRENCY = 8;

/**
 * Days per bucket in the "open alerts over time" chart.
 *
 * Weekly. The series is reconstructed from alert lifecycles rather than
 * sampled, so a finer bucket is free to compute but draws noise: Dependabot
 * opens and closes alerts in bursts when a lockfile lands.
 */
export const SECURITY_BUCKET_DAYS = 7;

/**
 * Where the Security page's results are persisted.
 *
 * Stored gzipped, unlike the two analysis documents: the estate comes to
 * roughly 870KB of JSON, which is close enough to etcd's ~1MiB object limit to
 * be a problem waiting to happen, and it compresses to around 40KB because it
 * is mostly repeated advisory text and package names.
 */
export const SECURITY_CONFIGMAP_NAME = 'extensions-center-security';

/**
 * Same contract as the other cache versions: bump when the shape changes.
 *
 * 2 adds triage, exposure and the matched Dependabot PR to every advisory. A v1
 * document has none of them, and a stored finding with no triage would render
 * as a blank column rather than as missing data, so v1 is discarded.
 */
export const SECURITY_CACHE_VERSION = 2;

/**
 * How many of a repo's open PRs are checked for a Dependabot version bump.
 *
 * Each costs a commits call on top of the one list call, so this is a ceiling
 * on the scan rather than a page size. `rancher/dashboard` — by far the busiest
 * repo here — sits around 20 open Dependabot PRs, so 60 absorbs a backlog
 * without the scan outgrowing the alert pull it annotates.
 */
export const DEPENDABOT_PR_SCAN_LIMIT = 60;

/** In-flight commit reads while scanning those PRs. */
export const DEPENDABOT_PR_CONCURRENCY = 6;

/** The package the shell-upgrade tab is entirely about. */
export const SHELL_PACKAGE = '@rancher/shell';

/**
 * The lockfile the shipped `@rancher/shell` version is read out of.
 *
 * Every official extension repo builds with yarn, so there is one filename to
 * look for — but a repo can hold several copies of it. `rancher-ai-ui` has
 * `tests/yarn.lock` and `mock-agent/yarn.lock`, `virtual-clusters-ui` has one
 * under `pkg/`, and none of those resolve shell. Which one is right is decided
 * by which one actually contains shell rather than by position, so the
 * selection validates itself instead of assuming the root.
 */
export const SHELL_LOCKFILE = 'yarn.lock';

/** Extensions whose releases are read at once, each costing a tree plus a lockfile. */
export const SHELL_UPGRADE_CONCURRENCY = 4;

// ─── Package inventory ───────────────────────────────────────────────────────

export const INVENTORY_CONFIGMAP_NAME = 'extensions-center-inventory';

/** Same contract as the other cache versions: bump when the shape changes. */
export const INVENTORY_CACHE_VERSION = 1;

/**
 * Extensions whose lockfiles are read at once. One tree plus one file each.
 *
 * Lower than it could be because each file is large — the five lockfiles
 * measured ran 594KB to 730KB — and the raw host is not the API host, so there
 * is no rate limit to spend but there is bandwidth.
 */
export const INVENTORY_CONCURRENCY = 3;

/**
 * Near-miss package names offered when an exact search finds nothing.
 *
 * Capped because the inventory holds roughly 1,500 names per extension and a
 * two-letter query would otherwise suggest hundreds.
 */
export const INVENTORY_SUGGESTION_LIMIT = 12;

/**
 * The whole `@rancher/shell` packument, which is where the upgrade tab gets
 * both its target versions and every version's dependency list.
 *
 * 700KB of JSON, but ~55KB on the wire gzipped and fetched once per session.
 * The two cheaper-looking endpoints do not work from a browser: the `dist-tags`
 * route sends no `access-control-allow-origin` at all, and the abbreviated
 * packument needs an `Accept` header that makes the request non-simple and
 * fails its preflight with a 404. One large readable response beats three small
 * unreachable ones.
 */
export const NPM_PACKUMENT = (name: string) => `${ NPM_REGISTRY_API }/${ name.replace('/', '%2F') }`;

/**
 * Ages at which the Security page starts saying something about its own data.
 *
 * The page never re-reads on its own — a repo costs a paginated alert pull or
 * an SBOM plus dozens of OSV calls, so that decision stays with the person
 * looking at it. What it does instead is refuse to be quiet about age, in two
 * steps: a note once the data is over a day old, and a warning past three days
 * telling the reader to re-read before acting on it.
 *
 * Two thresholds rather than one because they are different messages. A day
 * old is "this has probably moved"; three days is "do not make a decision on
 * this", and a single banner cannot say both without overstating the first
 * case or understating the second.
 */
export const SECURITY_STALE_HOURS = 24;
export const SECURITY_OVERDUE_DAYS = 3;

/** How many rows the dashboard summary tables show */
export const DASHBOARD_ROW_LIMIT = 10;

/**
 * How many open PRs the dashboard checks for manifest edits.
 *
 * Every one of them costs a compare call, so this is a ceiling on the scan
 * rather than a page size. `ui-plugin-charts` runs around half a dozen open
 * PRs; 50 covers a bad week without turning a page load into a crawl.
 */
export const MANIFEST_PR_SCAN_LIMIT = 50;

/** In-flight compares while scanning those PRs. */
export const MANIFEST_PR_CONCURRENCY = 6;

/**
 * Where Claude is called from.
 *
 * All three are reachable straight from the browser — each answers a CORS
 * preflight with `access-control-allow-origin: *` — so none of them needs a
 * server-side proxy. What differs is the credential, the URL shape and where
 * the model id goes, which `useClaude` handles.
 *
 * `claudeAws` is Claude Platform on AWS: Anthropic's own platform billed
 * through an AWS account, which despite the name is not Bedrock. It is a
 * separate endpoint, a separate IAM namespace and separate keys — a Bedrock key
 * will not work on it and vice versa — so the two are offered side by side
 * rather than folded together.
 *
 * Google Vertex AI was here and was removed. It is the only one of the four
 * that cannot authenticate from a browser with something a person can paste:
 * it rejects API keys outright and wants an OAuth2 bearer, which means either a
 * service-account key file (blocked by policy in a lot of organisations) or a
 * token that expires every hour.
 */
export const LLM_PROVIDERS = ['anthropic', 'claudeAws', 'bedrock'] as const;

export const DEFAULT_LLM_PROVIDER = 'anthropic';

export const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

/**
 * Claude Platform on AWS, which is regional in the hostname and nowhere else.
 * The path, the body and the version header are all the first-party Messages
 * API exactly as-is.
 */
export const CLAUDE_AWS_API_URL = (region: string) => `https://aws-external-anthropic.${ region }.api.aws/v1/messages`;

/** Sent in the `anthropic-version` header by Anthropic and Claude on AWS alike… */
export const ANTHROPIC_VERSION = '2023-06-01';
/** …and in the request body, with its own value, by Bedrock. */
export const BEDROCK_ANTHROPIC_VERSION = 'bedrock-2023-05-31';

/**
 * Default model per provider.
 *
 * Haiku rather than Sonnet because the only thing this calls Claude for is
 * classifying repo metadata in bulk. Claude Platform on AWS takes first-party
 * model ids unchanged; Bedrock has its own naming. Which ids an account can
 * actually reach varies — Bedrock needs the model enabled in the region — so
 * Settings lets the id be overridden.
 */
export const DEFAULT_MODELS = {
  anthropic: 'claude-haiku-4-5-20251001',
  claudeAws: 'claude-haiku-4-5-20251001',
  bedrock:   'global.anthropic.claude-haiku-4-5-20251001-v1:0',
} as const;

export const DEFAULT_AWS_REGION = 'us-east-1';

/**
 * Claude Platform on AWS has no default region of its own: unlike Bedrock it
 * refuses to guess, and the region is part of the hostname, so a wrong one is a
 * DNS answer rather than an API error. This is only the placeholder shown in
 * the form.
 */
export const DEFAULT_CLAUDE_AWS_REGION = 'us-east-1';

/**
 * Days before the cached known-repos document is considered stale.
 *
 * Staleness only changes what the UI *says*. It never triggers a rebuild on its
 * own: rebuilding costs hundreds of GitHub requests, so it happens when someone
 * asks for it and at no other time.
 */
export const KNOWN_REPOS_TTL_DAYS = 30;

/**
 * Bumped whenever the shape of the cached document changes, so an older cache
 * is ignored rather than deserialised into rows with missing fields.
 *
 * v2 dropped the model-assigned `category` from each row, and the
 * document-level `degraded` flag that went with it.
 */
export const KNOWN_REPOS_CACHE_VERSION = 2;

/**
 * Cache versions for the two analysis documents.
 *
 * Same contract as `KNOWN_REPOS_CACHE_VERSION`: bump when the document shape
 * changes and the stored copy is discarded rather than half-read.
 */
// 2: `inManifest` on every row, and siblings discovered from `pkg/`.
export const IMPORT_ANALYSIS_CACHE_VERSION = 2;
// 2: per-package `cause` and `versions`, plus the source-to-disk `ratio`.
// 3: `inManifest` on every row, and siblings discovered from `pkg/`.
export const BUNDLE_ANALYSIS_CACHE_VERSION = 3;

/**
 * Days before an analysis document is called stale.
 *
 * Shorter than the known-repos TTL because these track released versions, and a
 * new extension release lands often enough that a month-old reading is likely
 * to be describing versions nobody is running.
 */
export const ANALYSIS_TTL_DAYS = 14;
