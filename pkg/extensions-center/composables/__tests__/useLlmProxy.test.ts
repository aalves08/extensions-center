import {
  ANTHROPIC_PROXY_DOMAIN,
  ANTHROPIC_PROXY_ENDPOINT_NAME,
  claudeAwsHost,
  claudeAwsProxyEndpointName,
  vertexHost,
  vertexProxyEndpointName
} from '../../config/constants';
import { ExtensionConfig } from '../../types/common';
import { RancherStore } from '../../types/rancher';
import {
  ensureProxyTargets,
  llmProxyTargets,
  resetProxyTargetCache,
  vertexProxyTarget
} from '../useLlmProxy';
import { useProxyEndpoint } from '../useProxyEndpoint';

jest.mock('../useProxyEndpoint', () => ({ useProxyEndpoint: jest.fn() }));

const ensure = jest.fn(async() => 'ready');

function makeConfig(over: Partial<ExtensionConfig> = {}): ExtensionConfig {
  return {
    githubToken:          null,
    llmProvider:          'anthropic',
    llmModel:             null,
    anthropicApiKey:      null,
    vertexServiceAccount: null,
    vertexProjectId:      null,
    vertexRegion:         null,
    claudeAwsApiKey:      null,
    claudeAwsWorkspaceId: null,
    claudeAwsRegion:      null,
    ...over,
  };
}

const store = {} as RancherStore;

beforeEach(() => {
  jest.clearAllMocks();
  resetProxyTargetCache();
  (useProxyEndpoint as jest.Mock).mockReturnValue({ ensure });
});

describe('vertexProxyTarget', () => {
  it('pairs the host with the name derived from it', () => {
    expect(vertexProxyTarget(makeConfig({ vertexRegion: 'us-east5' }))).toEqual({
      domain: 'us-east5-aiplatform.googleapis.com',
      name:   vertexProxyEndpointName('us-east5-aiplatform.googleapis.com'),
    });
  });

  it('falls back to the default location when none is configured', () => {
    expect(vertexProxyTarget(makeConfig()).domain).toBe(vertexHost('global'));
  });

  it('trims a pasted region, which would otherwise be a route that never matches', () => {
    expect(vertexProxyTarget(makeConfig({ vertexRegion: '  europe-west1  ' })).domain)
      .toBe('europe-west1-aiplatform.googleapis.com');
  });
});

describe('llmProxyTargets', () => {
  it('covers every provider, not just the selected one', () => {
    // Switching provider on the Settings page should not need a second admin
    // visit to the dashboard before the new one is reachable.
    const targets = llmProxyTargets(makeConfig({ llmProvider: 'anthropic', claudeAwsRegion: 'us-east-1' }));

    expect(targets.map((t) => t.domain)).toEqual([
      ANTHROPIC_PROXY_DOMAIN,
      vertexHost('global'),
      claudeAwsHost('us-east-1'),
    ]);
  });

  it('gives Anthropic the fixed pair, since its host does not move', () => {
    expect(llmProxyTargets(makeConfig())[0]).toEqual({ domain: ANTHROPIC_PROXY_DOMAIN, name: ANTHROPIC_PROXY_ENDPOINT_NAME });
  });

  it('leaves Claude on AWS out when no region is configured', () => {
    // Its region has no default and is part of the hostname, so a guess is a
    // route to a host the account may have no endpoint in.
    expect(llmProxyTargets(makeConfig()).map((t) => t.domain)).not.toContain(claudeAwsHost('us-east-1'));
    expect(llmProxyTargets(makeConfig())).toHaveLength(2);
  });

  it('treats a whitespace-only region as no region at all', () => {
    expect(llmProxyTargets(makeConfig({ claudeAwsRegion: '   ' }))).toHaveLength(2);
  });

  it('names the Claude-on-AWS endpoint after the host it resolves to', () => {
    const target = llmProxyTargets(makeConfig({ claudeAwsRegion: 'eu-central-1' })).at(-1);

    expect(target).toEqual({
      domain: claudeAwsHost('eu-central-1'),
      name:   claudeAwsProxyEndpointName(claudeAwsHost('eu-central-1')),
    });
  });

  it('never repeats a domain or a name', () => {
    const targets = llmProxyTargets(makeConfig({ vertexRegion: 'us-east5', claudeAwsRegion: 'us-east-1' }));

    expect(new Set(targets.map((t) => t.domain)).size).toBe(targets.length);
    expect(new Set(targets.map((t) => t.name)).size).toBe(targets.length);
  });

  it('produces valid Kubernetes names throughout', () => {
    llmProxyTargets(makeConfig({ vertexRegion: 'northamerica-northeast1', claudeAwsRegion: 'ap-southeast-2' }))
      .forEach(({ name }) => {
        expect(name).toMatch(/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/);
        expect(name.length).toBeLessThanOrEqual(253);
      });
  });
});

describe('ensureProxyTargets', () => {
  it('creates one endpoint per target, with the host and the name', async() => {
    await ensureProxyTargets(store, llmProxyTargets(makeConfig({ claudeAwsRegion: 'us-east-1' })));

    expect(ensure).toHaveBeenCalledTimes(3);
    expect((useProxyEndpoint as jest.Mock).mock.calls).toEqual([
      [store, ANTHROPIC_PROXY_DOMAIN, ANTHROPIC_PROXY_ENDPOINT_NAME],
      [store, vertexHost('global'), vertexProxyEndpointName(vertexHost('global'))],
      [store, claudeAwsHost('us-east-1'), claudeAwsProxyEndpointName(claudeAwsHost('us-east-1'))],
    ]);
  });

  it('checks a host once per page load, not once per caller', async() => {
    // Each check is a findAll over a cluster-scoped type, and a classification
    // run asks every few seconds.
    const targets = llmProxyTargets(makeConfig());

    await ensureProxyTargets(store, targets);
    await ensureProxyTargets(store, targets);
    await ensureProxyTargets(store, targets);

    expect(ensure).toHaveBeenCalledTimes(2);
  });

  it('shares the cache with the lazy path, so the dashboard mount covers it', async() => {
    // This is the whole reason the cache lives here rather than in useClaude:
    // once the dashboard has registered the Vertex host, the first model call
    // must not list them all over again.
    await ensureProxyTargets(store, llmProxyTargets(makeConfig({ vertexRegion: 'us-east4' })));
    ensure.mockClear();

    await ensureProxyTargets(store, [vertexProxyTarget(makeConfig({ vertexRegion: 'us-east4' }))]);

    expect(ensure).not.toHaveBeenCalled();
  });

  it('still checks a host it has not seen, so switching region re-checks', async() => {
    await ensureProxyTargets(store, [vertexProxyTarget(makeConfig({ vertexRegion: 'us-east4' }))]);
    await ensureProxyTargets(store, [vertexProxyTarget(makeConfig({ vertexRegion: 'us-west1' }))]);

    expect(ensure).toHaveBeenCalledTimes(2);
  });

  it('runs them one at a time, so two misses cannot race to create duplicates', async() => {
    let running = 0;
    let overlapped = false;

    ensure.mockImplementation(async() => {
      overlapped ||= running > 0;
      running++;
      await Promise.resolve();
      running--;

      return 'ready';
    });

    await ensureProxyTargets(store, llmProxyTargets(makeConfig({ claudeAwsRegion: 'us-east-1' })));

    expect(overlapped).toBe(false);
  });

  it('does nothing at all when given nothing', async() => {
    await ensureProxyTargets(store, []);

    expect(useProxyEndpoint).not.toHaveBeenCalled();
  });
});
