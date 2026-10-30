import { ExtensionConfig } from '../../types/common';
import { RancherStore } from '../../types/rancher';
import { useClaude } from '../useClaude';
import { useExtensionConfig } from '../useExtensionConfig';
import { ClassifierInput, REPO_CATEGORIES, useRepoClassifier } from '../useRepoClassifier';

jest.mock('../useClaude', () => ({ useClaude: jest.fn() }));
jest.mock('../useExtensionConfig', () => ({
  useExtensionConfig: jest.fn(),
  // Kept real: whether a provider counts as configured is the gate `classify`
  // opens on, and stubbing it would make the "no credentials" case vacuous.
  hasLlmCredentials:  jest.requireActual('../useExtensionConfig').hasLlmCredentials,
}));

const sendMessage = jest.fn();

function makeConfig(over: Partial<ExtensionConfig> = {}): ExtensionConfig {
  return {
    githubToken:          null,
    llmProvider:          'anthropic',
    llmModel:             null,
    anthropicApiKey:      'sk-ant-key',
    vertexServiceAccount: null,
    vertexProjectId:      null,
    vertexRegion:         null,
    claudeAwsApiKey:      null,
    claudeAwsWorkspaceId: null,
    claudeAwsRegion:      null,
    ...over,
  };
}

function input(id: string, over: Partial<ClassifierInput> = {}): ClassifierInput {
  return {
    id,
    repoDescription: `description of ${ id }`,
    topics:          ['rancher', 'extension'],
    readmeExcerpt:   `# ${ id }\n\nDoes a thing.`,
    ...over,
  };
}

/** Swap in the config `classify` will read. */
function withConfig(cfg: ExtensionConfig) {
  (useExtensionConfig as jest.Mock).mockReturnValue({ load: jest.fn(async() => cfg) });
}

const store = {} as RancherStore;

let warn: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  (useClaude as jest.Mock).mockReturnValue({ sendMessage });
  sendMessage.mockReset();
  withConfig(makeConfig());
  // The classifier warns on a failed batch by design; keep it out of the run.
  warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => warn.mockRestore());

describe('classify — gating', () => {
  it('reports unavailable rather than empty when no provider is configured', async() => {
    // The distinction matters: empty results with `available: true` is "the
    // model had nothing to say", which is how a broken setup used to look.
    withConfig(makeConfig({ anthropicApiKey: null }));

    expect(await useRepoClassifier(store).classify([input('a/b')])).toEqual({
      results: {}, available: false, error: null
    });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('honours the selected provider when judging credentials', async() => {
    // An Anthropic key does not make Vertex usable.
    withConfig(makeConfig({ llmProvider: 'vertex' }));

    expect((await useRepoClassifier(store).classify([input('a/b')])).available).toBe(false);
  });

  it('is available but silent for an empty input list', async() => {
    expect(await useRepoClassifier(store).classify([])).toEqual({
      results: {}, available: true, error: null
    });
    expect(sendMessage).not.toHaveBeenCalled();
  });
});

describe('classify — the request', () => {
  it('sends the repo metadata the prompt asks the model to read', async() => {
    sendMessage.mockResolvedValue('[]');

    await useRepoClassifier(store).classify([input('rancher/thing', {
      repoDescription: 'A thing', topics: ['storage'], readmeExcerpt: '# Thing'
    })]);

    const [cfg, req] = sendMessage.mock.calls[0];

    expect(cfg.anthropicApiKey).toBe('sk-ant-key');
    expect(JSON.parse(req.userContent)).toEqual([{
      id: 'rancher/thing', description: 'A thing', topics: ['storage'], readme: '# Thing'
    }]);
  });

  it('names every category in the system prompt and asks for bare JSON', async() => {
    sendMessage.mockResolvedValue('[]');

    await useRepoClassifier(store).classify([input('a/b')]);

    const { system } = sendMessage.mock.calls[0][1];

    REPO_CATEGORIES.forEach((category) => expect(system).toContain(category));
    expect(system).toContain('JSON array only');
  });

  it('batches twelve at a time, sequentially', async() => {
    sendMessage.mockResolvedValue('[]');

    const inputs = Array.from({ length: 25 }, (_, i) => input(`owner/repo-${ i }`));

    await useRepoClassifier(store).classify(inputs);

    expect(sendMessage).toHaveBeenCalledTimes(3);

    const sizes = sendMessage.mock.calls.map((c) => JSON.parse(c[1].userContent).length);

    expect(sizes).toEqual([12, 12, 1]);
  });

  it('covers every input exactly once across the batches', async() => {
    sendMessage.mockResolvedValue('[]');

    const inputs = Array.from({ length: 25 }, (_, i) => input(`owner/repo-${ i }`));

    await useRepoClassifier(store).classify(inputs);

    const sent = sendMessage.mock.calls
      .flatMap((c) => JSON.parse(c[1].userContent))
      .map((r: { id: string }) => r.id);

    expect(sent).toEqual(inputs.map((r) => r.id));
  });
});

describe('classify — reading the reply', () => {
  it('keys the results by repo id', async() => {
    sendMessage.mockResolvedValue(JSON.stringify([
      {
        id: 'a/b', name: 'Thing', description: 'Does a thing.', category: 'storage'
      },
      {
        id: 'c/d', name: 'Other', description: 'Does another.', category: 'networking'
      },
    ]));

    const outcome = await useRepoClassifier(store).classify([input('a/b'), input('c/d')]);

    expect(outcome).toEqual({
      available: true,
      error:     null,
      results:   {
        'a/b': {
          name: 'Thing', description: 'Does a thing.', category: 'storage'
        },
        'c/d': {
          name: 'Other', description: 'Does another.', category: 'networking'
        },
      },
    });
  });

  it('unwraps a markdown code fence', async() => {
    sendMessage.mockResolvedValue('```json\n[{"id":"a/b","name":"T","description":"d","category":"ai"}]\n```');

    expect((await useRepoClassifier(store).classify([input('a/b')])).results['a/b'].category).toBe('ai');
  });

  it('unwraps a fence with no language tag', async() => {
    sendMessage.mockResolvedValue('```\n[{"id":"a/b","name":"T","description":"d","category":"ai"}]\n```');

    expect((await useRepoClassifier(store).classify([input('a/b')])).results['a/b'].name).toBe('T');
  });

  it('falls back to "other" for a category outside the list', async() => {
    // The model inventing a category would otherwise end up rendered as a
    // badge nobody has styled.
    sendMessage.mockResolvedValue(JSON.stringify([
      {
        id: 'a/b', name: 'T', description: 'd', category: 'quantum'
      },
      {
        id: 'c/d', name: 'T', description: 'd'
      },
    ]));

    const { results } = await useRepoClassifier(store).classify([input('a/b'), input('c/d')]);

    expect(results['a/b'].category).toBe('other');
    expect(results['c/d'].category).toBe('other');
  });

  it('falls back to a cleaned repo name when the model gives none', async() => {
    sendMessage.mockResolvedValue(JSON.stringify([{
      id: 'rancher/kubewarden-ui', description: 'd', category: 'security'
    }]));

    const { results } = await useRepoClassifier(store).classify([input('rancher/kubewarden-ui')]);

    expect(results['rancher/kubewarden-ui'].name).toBeTruthy();
    expect(results['rancher/kubewarden-ui'].description).toBe('d');
  });

  it('drops an entry with no id, since there is nothing to attach it to', async() => {
    sendMessage.mockResolvedValue(JSON.stringify([
      {
        name: 'Orphan', description: 'd', category: 'ai'
      },
      {
        id: 'a/b', name: 'T', description: 'd', category: 'ai'
      },
    ]));

    const { results } = await useRepoClassifier(store).classify([input('a/b')]);

    expect(Object.keys(results)).toEqual(['a/b']);
  });

  it('truncates a name or description that runs long', async() => {
    sendMessage.mockResolvedValue(JSON.stringify([{
      id: 'a/b', name: 'N'.repeat(200), description: 'D'.repeat(500), category: 'ai'
    }]));

    const { results } = await useRepoClassifier(store).classify([input('a/b')]);

    expect(results['a/b'].name).toHaveLength(80);
    expect(results['a/b'].description).toHaveLength(200);
  });

  it('ignores a reply that is valid JSON but not an array', async() => {
    sendMessage.mockResolvedValue('{"id":"a/b","name":"T"}');

    expect(await useRepoClassifier(store).classify([input('a/b')])).toEqual({
      results: {}, available: true, error: null
    });
  });
});

describe('classify — failures', () => {
  it('reports the error rather than returning a quietly empty result', async() => {
    sendMessage.mockRejectedValue(new Error('Anthropic API error (401): invalid x-api-key'));

    const outcome = await useRepoClassifier(store).classify([input('a/b')]);

    expect(outcome.available).toBe(true);
    expect(outcome.results).toEqual({});
    expect(outcome.error).toBe('Anthropic API error (401): invalid x-api-key');
  });

  it('reports unparseable output as an error too', async() => {
    sendMessage.mockResolvedValue('Sure! Here are the classifications:');

    expect((await useRepoClassifier(store).classify([input('a/b')])).error).toMatch(/JSON/i);
  });

  it('keeps the batches that worked when one fails', async() => {
    // 13 inputs is two batches; the first one dies.
    sendMessage
      .mockRejectedValueOnce(new Error('rate limited'))
      .mockResolvedValueOnce(JSON.stringify([{
        id: 'owner/repo-12', name: 'T', description: 'd', category: 'ai'
      }]));

    const inputs = Array.from({ length: 13 }, (_, i) => input(`owner/repo-${ i }`));
    const outcome = await useRepoClassifier(store).classify(inputs);

    expect(Object.keys(outcome.results)).toEqual(['owner/repo-12']);
    expect(outcome.error).toBe('rate limited');
  });

  it('surfaces the last failure when several batches fail', async() => {
    sendMessage
      .mockRejectedValueOnce(new Error('first failure'))
      .mockRejectedValueOnce(new Error('second failure'));

    const inputs = Array.from({ length: 13 }, (_, i) => input(`owner/repo-${ i }`));

    expect((await useRepoClassifier(store).classify(inputs)).error).toBe('second failure');
  });

  it('stringifies a non-Error throw rather than losing it', async() => {
    sendMessage.mockRejectedValue('plain string failure');

    expect((await useRepoClassifier(store).classify([input('a/b')])).error).toBe('plain string failure');
  });
});
