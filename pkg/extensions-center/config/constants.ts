/**
 * Shared constants for the Extensions Center extension.
 */

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
  SETTINGS:             `${ PRODUCT_ROUTE_NAME }-c-cluster-settings`,
} as const;

/** Namespace and names of the Kubernetes objects this extension owns */
export const CONFIG_NAMESPACE = 'cattle-system';
export const CONFIG_SECRET_NAME = 'extensions-center-config';
export const KNOWN_REPOS_CONFIGMAP_NAME = 'extensions-center-known-repos';

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

/** npm packages tracked on the metrics page */
export const TRACKED_PACKAGES = ['@rancher/shell', '@rancher/components'] as const;

/** How many rows the dashboard summary tables show */
export const DASHBOARD_ROW_LIMIT = 10;

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
