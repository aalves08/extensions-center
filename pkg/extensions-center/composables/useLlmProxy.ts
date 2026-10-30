import {
  ANTHROPIC_PROXY_DOMAIN,
  ANTHROPIC_PROXY_ENDPOINT_NAME,
  DEFAULT_VERTEX_REGION,
  claudeAwsHost,
  claudeAwsProxyEndpointName,
  vertexHost,
  vertexProxyEndpointName
} from '../config/constants';
import { ExtensionConfig } from '../types/common';
import { RancherStore } from '../types/rancher';
import { useProxyEndpoint } from './useProxyEndpoint';

/**
 * Allow-listing the LLM hosts on Rancher's `/meta/proxy`.
 *
 * Separate from `useProxyEndpoint` itself, which knows how to create one
 * object and nothing about who needs it. This is the layer that decides *which*
 * hosts the configured providers resolve to, and makes sure each is only ever
 * checked once a page load.
 */

/** One host to allow-list, and the `ProxyEndpoint` that will carry it. */
export interface ProxyTarget {
  domain: string;
  name: string;
}

/** The Vertex host for a config, as a target. */
export function vertexProxyTarget(cfg: ExtensionConfig): ProxyTarget {
  const domain = vertexHost(cfg.vertexRegion?.trim() || DEFAULT_VERTEX_REGION);

  return { domain, name: vertexProxyEndpointName(domain) };
}

/**
 * Every LLM host worth allow-listing for the given config.
 *
 * All three providers, not just the selected one — switching provider on the
 * Settings page should not need a second admin visit to the dashboard to make
 * the new one reachable.
 *
 * Only the hosts we can actually name are included, which is why Claude on AWS
 * is conditional: its region has no default and is part of the hostname, so
 * without one there is nothing to allow-list and a guess would create a route
 * to a host the account has no endpoint in. Anthropic's host is fixed and
 * Vertex's region falls back to `global`, so both are always known.
 */
export function llmProxyTargets(cfg: ExtensionConfig): ProxyTarget[] {
  const targets: ProxyTarget[] = [
    { domain: ANTHROPIC_PROXY_DOMAIN, name: ANTHROPIC_PROXY_ENDPOINT_NAME },
    vertexProxyTarget(cfg),
  ];

  const awsRegion = cfg.claudeAwsRegion?.trim();

  if (awsRegion) {
    const domain = claudeAwsHost(awsRegion);

    targets.push({ domain, name: claudeAwsProxyEndpointName(domain) });
  }

  return targets;
}

/**
 * Hosts whose `ProxyEndpoint` has already been checked this page load.
 *
 * The check is a `findAll` over a cluster-scoped type, and a classification run
 * sends a request every few seconds, so doing it per call would be dozens of
 * list calls to learn the same thing. Module-level so it survives both the
 * composable being re-created on each page mount and the dashboard having
 * already done the work before the first model call.
 */
const checked = new Set<string>();

/**
 * Make sure each target is reachable through the proxy, at most once per host.
 *
 * Sequential rather than parallel: each `ensure` starts with a `findAll` over
 * the same cluster-scoped type, and running them together would have all of
 * them miss the newly created objects and race to write duplicates.
 *
 * Failures are swallowed by `ensure` itself, which reports through its own
 * state — a user who may not create these gets the same outcome they had
 * before, so this can only improve things and is never fatal.
 */
export async function ensureProxyTargets(store: RancherStore, targets: ProxyTarget[]): Promise<void> {
  for (const target of targets) {
    if (checked.has(target.domain)) {
      continue;
    }

    await useProxyEndpoint(store, target.domain, target.name).ensure();
    checked.add(target.domain);
  }
}

/** Forget what has been checked. Only for tests. */
export function resetProxyTargetCache(): void {
  checked.clear();
}
