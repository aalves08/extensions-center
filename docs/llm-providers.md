# LLM providers

Notes on the three providers behind the AI features (Describe with AI, the repo
classifier), why they are the three, and the ways each one fails that the error
message does not explain.

This is background for whoever next has to debug a Test connection failure. The
implementation is in [`composables/useClaude.ts`](../pkg/extensions-center/composables/useClaude.ts);
hostnames and defaults are in [`config/constants.ts`](../pkg/extensions-center/config/constants.ts).

Verified by live probes against each API on 2026-09-18, and the Claude on AWS
section again on 2026-10-20.

## The shortlist

Everything here runs in a browser, inside Rancher's own page. That rules more
out than it sounds like: the constraint is not "can this API be called" but
"can a person paste a credential that keeps working, and does the API answer a
CORS preflight from a page origin".

| Provider | Endpoint | Model id | Version | Auth | Direct from the browser |
|---|---|---|---|---|---|
| Anthropic | `api.anthropic.com/v1/messages` | body | `anthropic-version` header | `x-api-key` + `anthropic-dangerous-direct-browser-access: true` | yes |
| Claude Platform on AWS | `aws-external-anthropic.<region>.api.aws/v1/messages` | body | `anthropic-version` header | `x-api-key` + `anthropic-workspace-id` | yes |
| Vertex AI | `<see below>/v1/…:rawPredict` | URL path | `anthropic_version` **body** field | OAuth2 bearer | no — needs `/meta/proxy` |
| Amazon Bedrock | `bedrock-runtime.<region>.amazonaws.com` | URL path | `anthropic_version` body (`bedrock-2023-05-31`) | SigV4 | not implemented |

Bedrock is listed only to be ruled out: it is the one that needs SigV4 request
signing against long-lived AWS credentials held in the browser, which is a
worse thing to ask of a user than any of the three we ship.

## Claude Platform on AWS

The best fit for an extension like this, and the one to recommend to a new
user. It is the first-party Messages API behind an AWS-billed hostname, so the
request body is ordinary Anthropic — bare model ids, no `anthropic.` prefix.
Three pasteable values and nothing else: workspace API key, `wrkspc_…`
workspace id, region.

Things that are true of this provider and not the others:

- **It is not Bedrock.** Different service, different endpoint, different IAM
  namespace. A Bedrock key is rejected here, and vice versa.
- **The region lives only in the hostname** and is mandatory — unlike Bedrock
  there is no `us-east-1` fallback, which is why
  [`prepareClaudeAws`](../pkg/extensions-center/composables/useClaude.ts) checks
  for it rather than letting the request go out. A region your account has no
  endpoint in still resolves in DNS, so getting it wrong fails as a connection
  or HTML error rather than an API one.
- **The workspace id is required on every call** and cannot be derived from the
  key, so it is checked up front too.
- The preflight returns `allow-origin: *` / `allow-headers: *`, and this
  provider does **not** need the
  `anthropic-dangerous-direct-browser-access` header that `api.anthropic.com`
  requires.

Claude Code reaches the same endpoint with `CLAUDE_CODE_USE_ANTHROPIC_AWS=1`
plus `ANTHROPIC_AWS_WORKSPACE_ID`, `ANTHROPIC_AWS_API_KEY` and `AWS_REGION`.

### The key trap

> `401 {"type":"error","error":{"type":"authentication_error","message":"Invalid bearer token"}}`

The AWS console lists API keys by the name of the shadow IAM user that backs
them — `AeaApiKey-<id>-at-<account id>`, where "aea" is AWS External Anthropic.
That name looks exactly like a credential and sits one column away from the
value, so it is very easy to copy instead of the key. Doing so produces the 401
above.

What makes this expensive to diagnose is that the error is identical for every
wrong thing you might suspect: same response for `x-api-key` and for
`Authorization: Bearer`, same response with and without the workspace header,
same response in every region. It reads like a client bug and is not one.

The real key value is a long opaque blob that encodes
`AeaApiKey-<id>-at-<account id>:<secret>` — the same scheme as Bedrock's
long-term keys, which is why the name looks like half of it. It is displayed
**once**, in the generation dialog, and cannot be recovered afterwards. The fix
is to generate a new long-term key (AWS console → Claude Platform on AWS → API
keys → Generate long-term key) and copy the value from that dialog.

Also worth knowing when a 401 shows up:

- A **wrong workspace id gives 403**, not 401. A 401 is always the key.
- **Long-term keys are not region-locked. Short-term keys are**, at both
  generation and use — a short-term key minted in `us-east-1` will not work
  against a `eu-west-2` endpoint.
- The default `AnthropicLimitedAccess` policy on the backing IAM user grants
  access to *every* workspace, which is worth scoping down in IAM.

### Telling "bad credential" from "bad code" in one step

Run the same credential through Anthropic's own client with a `fetch` spy. If
`@anthropic-ai/aws-sdk` builds a byte-identical request and gets the same
error, the credential is wrong and no amount of changing headers will help:

```js
import AnthropicAws from '@anthropic-ai/aws-sdk';

const spyFetch = async(url, init = {}) => {
  console.log(url, Object.fromEntries(new Headers(init.headers)));

  return fetch(url, init);
};

const client = new AnthropicAws({ apiKey: process.env.ANTHROPIC_AWS_API_KEY, fetch: spyFetch });
```

Mask the key before logging, and do this in a scratch directory — never add the
SDK to this repo's dependencies for a one-off probe.

## Vertex AI

The most work to set up, and the only one that cannot be called directly.

- **It needs Rancher's `/meta/proxy`.** `rawPredict` refuses the browser
  preflight. The host has to be allow-listed before the hop works, and until it
  is, Rancher refuses it with an error that says nothing about Vertex — hence
  the `vertexProxyFailed` hint appended in `sendMessage`.
- **Every mechanical detail differs from the other two**: the model goes in the
  URL path, a dated snapshot spells its date with `@` rather than `-`
  (`claude-haiku-4-5@20251001`), `anthropic_version` is a *body* field with a
  Vertex-specific value, and `model` must not appear in the body at all.
- **There is no API key form.** `rawPredict` answers an API key with
  `401 "API keys are not supported by this API"`, and Vertex Express Mode keys
  are `publishers/google` only, so they 404 against the Anthropic publisher.
  Auth is an OAuth2 bearer or nothing.
- **The model has to be enabled for the project in Model Garden first**,
  otherwise a correct request still fails.
- Host shape depends on the location: `global` → `aiplatform.googleapis.com`,
  `us`/`eu` → `aiplatform.<loc>.rep.googleapis.com`, anything else →
  `<region>-aiplatform.googleapis.com`. Get it wrong and Google's frontend
  returns an **HTML 404**, not an API error.

### Credentials

Two kinds of Google credential JSON are accepted, both pasted into the field as
downloaded — see [`utils/gcpJwt.ts`](../pkg/extensions-center/utils/gcpJwt.ts):

- `service_account` — a key file, exchanged with the JWT-bearer grant, signed
  RS256 in Web Crypto. Many orgs block creating these with
  `iam.disableServiceAccountKeyCreation`.
- `authorized_user` — what `gcloud auth application-default login` writes,
  exchanged with `grant_type=refresh_token`.

Application Default Credentials cannot *resolve* in a browser: ADC reads
`~/.config/gcloud/…` or the GCE metadata server and a page has neither. Pasting
the file's contents is what makes it work.

One non-obvious consequence: `authorized_user` files have no `client_email`,
and every gcloud ADC file on earth shares the same `client_id`. Neither is
usable as a token-cache key, so the cache keys on a SHA-256 fingerprint of the
refresh token instead — which also keeps the credential itself out of a `Map`
key. Token minting at `oauth2.googleapis.com/token` is CORS-simple and goes
direct, so only the inference call takes the proxy hop.

## Costs

The describe/classify pass sends roughly 435 input and 60 output tokens per
repo. On the default Sonnet 4.6 that is about **$0.22 per 100 repos**; Opus 5 is
roughly 5× that, Haiku roughly $0.07. Rebuilding the known-repos table does
**not** call a model — the classifier is deliberately separate from `rebuild()`
so a model failure cannot take the table down.
