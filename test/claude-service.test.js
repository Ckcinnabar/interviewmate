'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Anthropic = require('@anthropic-ai/sdk');
const {
  MissingApiKeyError,
  SERVER_SIDE_FALLBACK_BETA,
  createClaudeService,
  describeClaudeError
} = require('../src/services/ai/claude-service');
const { getClaudeProfile } = require('../src/config');

// Stands in for the SDK client: records each request and replays a canned
// stream through the same `on('text')` / `finalMessage()` surface.
function createFakeClient({ deltas = ['Hello', ' world'], message, error } = {}) {
  const calls = [];

  function stream(endpoint) {
    return (params, options) => {
      calls.push({ endpoint, params, options });
      const listeners = [];

      return {
        on(event, listener) {
          if (event === 'text') listeners.push(listener);
          return this;
        },
        async finalMessage() {
          if (error) throw error;
          deltas.forEach((delta) => listeners.forEach((listener) => listener(delta)));
          return message || {
            model: params.model,
            content: [{ type: 'text', text: deltas.join('') }],
            stop_reason: 'end_turn',
            stop_details: null,
            usage: { input_tokens: 10, output_tokens: 2 }
          };
        }
      };
    };
  }

  // Non-streaming calls, used for cache warm-up.
  function create(endpoint) {
    return async (params) => {
      calls.push({ endpoint, method: 'create', params });
      return {
        content: [],
        stop_reason: 'max_tokens',
        usage: { cache_creation_input_tokens: 1200, cache_read_input_tokens: 0 }
      };
    };
  }

  return {
    calls,
    client: {
      messages: {
        stream: stream('stable'),
        create: create('stable'),
        countTokens: async (params) => {
          calls.push({ endpoint: 'stable', method: 'countTokens', params });
          return { input_tokens: 4321 };
        }
      },
      beta: { messages: { stream: stream('beta'), create: create('beta') } }
    }
  };
}

const TURNS = [{ role: 'user', speech: 'What is a mutex?', livePartial: '', image: null, imageNote: '' }];

test('spoken questions go to the fast model with thinking off and the system prompt cached', async () => {
  const fake = createFakeClient();
  const service = createClaudeService({ getApiKey: () => 'key', createClient: () => fake.client });
  const received = [];

  const result = await service.streamAnswer({
    profile: getClaudeProfile('voice'),
    instructions: 'SYSTEM',
    turns: TURNS,
    onText: (text) => received.push(text)
  });

  assert.equal(fake.calls.length, 1);
  const { endpoint, params } = fake.calls[0];
  assert.equal(endpoint, 'stable');
  assert.equal(params.model, 'claude-haiku-5-5');
  assert.deepEqual(params.thinking, { type: 'disabled' });
  assert.deepEqual(params.output_config, { effort: 'low' });
  assert.deepEqual(params.system, [
    { type: 'text', text: 'SYSTEM', cache_control: { type: 'ephemeral', ttl: '1h' } }
  ]);
  assert.deepEqual(params.cache_control, { type: 'ephemeral' });
  assert.deepEqual(params.messages, [{ role: 'user', content: 'What is a mutex?' }]);
  assert.equal(params.fallbacks, undefined);
  assert.equal(params.betas, undefined);

  assert.deepEqual(received, ['Hello', ' world']);
  assert.equal(result.text, 'Hello world');
  assert.equal(result.refused, false);
  assert.equal(result.truncated, false);
});

test('screen questions go to the strong model with server-side fallback', async () => {
  const fake = createFakeClient();
  const service = createClaudeService({ getApiKey: () => 'key', createClient: () => fake.client });

  await service.streamAnswer({
    profile: getClaudeProfile('screen'),
    instructions: 'SYSTEM',
    turns: [{ role: 'user', speech: '', livePartial: '', image: 'BASE64', imageNote: '' }]
  });

  const { endpoint, params } = fake.calls[0];
  assert.equal(endpoint, 'beta');
  assert.equal(params.model, 'claude-opus-5-5');
  assert.deepEqual(params.thinking, { type: 'adaptive' });
  assert.deepEqual(params.output_config, { effort: 'medium' });
  assert.equal(params.fallbacks, 'default');
  assert.deepEqual(params.betas, [SERVER_SIDE_FALLBACK_BETA]);
  assert.equal(params.messages[0].content[0].type, 'image');
  assert.equal(params.messages[0].content[0].source.media_type, 'image/jpeg');
});

test('the abort signal is passed to the request', async () => {
  const fake = createFakeClient();
  const service = createClaudeService({ getApiKey: () => 'key', createClient: () => fake.client });
  const controller = new AbortController();

  await service.streamAnswer({
    profile: getClaudeProfile('voice'),
    instructions: 'SYSTEM',
    turns: TURNS,
    signal: controller.signal
  });

  assert.equal(fake.calls[0].options.signal, controller.signal);
});

test('only text blocks make up the answer', async () => {
  const fake = createFakeClient({
    message: {
      model: 'claude-opus-5-5',
      content: [
        { type: 'thinking', thinking: '', signature: 'sig' },
        { type: 'text', text: 'Part one. ' },
        { type: 'text', text: 'Part two.' }
      ],
      stop_reason: 'max_tokens',
      stop_details: null,
      usage: {}
    }
  });
  const service = createClaudeService({ getApiKey: () => 'key', createClient: () => fake.client });

  const result = await service.streamAnswer({ profile: getClaudeProfile('voice'), instructions: 'S', turns: TURNS });

  assert.equal(result.text, 'Part one. Part two.');
  assert.equal(result.truncated, true);
});

test('a refusal is reported with its category', async () => {
  const fake = createFakeClient({
    deltas: [],
    message: {
      model: 'claude-haiku-5-5',
      content: [],
      stop_reason: 'refusal',
      stop_details: { type: 'refusal', category: 'cyber', explanation: 'declined' },
      usage: {}
    }
  });
  const service = createClaudeService({ getApiKey: () => 'key', createClient: () => fake.client });

  const result = await service.streamAnswer({ profile: getClaudeProfile('voice'), instructions: 'S', turns: TURNS });

  assert.equal(result.refused, true);
  assert.equal(result.refusalCategory, 'cyber');
  assert.equal(result.text, '');
});

test('a missing API key fails before any request is made', async () => {
  const fake = createFakeClient();
  const service = createClaudeService({ getApiKey: () => '  ', createClient: () => fake.client });

  await assert.rejects(
    service.streamAnswer({ profile: getClaudeProfile('voice'), instructions: 'S', turns: TURNS }),
    MissingApiKeyError
  );
  assert.equal(fake.calls.length, 0);
});

test('the client is rebuilt when the API key changes', async () => {
  const keysUsed = [];
  let currentKey = 'first';
  const service = createClaudeService({
    getApiKey: () => currentKey,
    createClient: (apiKey) => {
      keysUsed.push(apiKey);
      return createFakeClient().client;
    }
  });
  const request = { profile: getClaudeProfile('voice'), instructions: 'S', turns: TURNS };

  await service.streamAnswer(request);
  await service.streamAnswer(request);
  currentKey = 'second';
  await service.streamAnswer(request);

  assert.deepEqual(keysUsed, ['first', 'second']);
});

test('errors are described by SDK error class', () => {
  const headers = new Headers();

  assert.deepEqual(describeClaudeError(new Anthropic.APIUserAbortError()), { aborted: true, message: '' });
  assert.match(describeClaudeError(new MissingApiKeyError()).message, /尚未設定 Anthropic API key/);
  assert.match(
    describeClaudeError(new Anthropic.AuthenticationError(401, {}, 'invalid x-api-key', headers)).message,
    /API key 無效/
  );
  assert.match(
    describeClaudeError(new Anthropic.RateLimitError(429, {}, 'slow down', headers)).message,
    /速率限制/
  );
  assert.match(
    describeClaudeError(new Anthropic.APIConnectionError({ message: 'offline' })).message,
    /無法連線/
  );
  assert.match(describeClaudeError(new Error('boom')).message, /boom/);
});

test('experience documents go first in the system prompt, each part cached for an hour', async () => {
  const fake = createFakeClient();
  const service = createClaudeService({ getApiKey: () => 'key', createClient: () => fake.client });

  await service.streamAnswer({
    profile: getClaudeProfile('voice'),
    instructions: 'INSTRUCTIONS',
    knowledge: 'DOCUMENTS',
    turns: TURNS
  });

  assert.deepEqual(fake.calls[0].params.system, [
    { type: 'text', text: 'DOCUMENTS', cache_control: { type: 'ephemeral', ttl: '1h' } },
    { type: 'text', text: 'INSTRUCTIONS', cache_control: { type: 'ephemeral', ttl: '1h' } }
  ]);
});

test('warm-up stores the same system prompt without generating anything', async () => {
  const fake = createFakeClient();
  const service = createClaudeService({ getApiKey: () => 'key', createClient: () => fake.client });
  const profile = getClaudeProfile('voice');

  const answerPrompt = { profile, instructions: 'INSTRUCTIONS', knowledge: 'DOCUMENTS' };
  const result = await service.prewarm(answerPrompt);
  await service.streamAnswer({ ...answerPrompt, turns: TURNS });

  const [warm, answer] = fake.calls;
  assert.equal(warm.method, 'create');
  assert.equal(warm.params.max_tokens, 0);
  assert.equal(warm.params.stream, undefined);
  // The cache key covers the model, thinking, effort, and system blocks, so
  // these must match the real request exactly.
  assert.equal(warm.params.model, answer.params.model);
  assert.deepEqual(warm.params.thinking, answer.params.thinking);
  assert.deepEqual(warm.params.output_config, answer.params.output_config);
  assert.deepEqual(warm.params.system, answer.params.system);
  // No top-level marker: it would key the cache to the placeholder message.
  assert.equal(warm.params.cache_control, undefined);
  assert.equal(result.usage.cache_creation_input_tokens, 1200);
});

test('counts the system prompt in the profile model without cache markers', async () => {
  const fake = createFakeClient();
  const service = createClaudeService({ getApiKey: () => 'key', createClient: () => fake.client });

  const tokens = await service.countSystemTokens({
    profile: getClaudeProfile('voice'),
    instructions: 'INSTRUCTIONS',
    knowledge: 'DOCUMENTS'
  });

  assert.equal(tokens, 4321);
  const { params } = fake.calls[0];
  assert.equal(params.model, 'claude-haiku-5-5');
  assert.deepEqual(params.system, [
    { type: 'text', text: 'DOCUMENTS' },
    { type: 'text', text: 'INSTRUCTIONS' }
  ]);
});

test('a PDF is sent as a document block ahead of the instructions', async () => {
  const fake = createFakeClient({ deltas: ['# Notes', '\n- detail'] });
  const service = createClaudeService({ getApiKey: () => 'key', createClient: () => fake.client });

  const result = await service.digestPdf({ profile: getClaudeProfile('digest'), pdfBase64: 'PDFDATA' });

  const { endpoint, params } = fake.calls[0];
  assert.equal(endpoint, 'beta');
  assert.equal(params.model, 'claude-opus-5-5');
  assert.equal(params.system, undefined);
  assert.deepEqual(params.messages[0].content[0], {
    type: 'document',
    source: { type: 'base64', media_type: 'application/pdf', data: 'PDFDATA' }
  });
  assert.equal(params.messages[0].content[1].type, 'text');
  assert.match(params.messages[0].content[1].text, /reference notes/);
  assert.equal(result.text, '# Notes\n- detail');
});

test('a refused PDF is an error, not empty notes', async () => {
  const fake = createFakeClient({
    deltas: [],
    message: { model: 'm', content: [], stop_reason: 'refusal', stop_details: null, usage: {} }
  });
  const service = createClaudeService({ getApiKey: () => 'key', createClient: () => fake.client });

  await assert.rejects(
    service.digestPdf({ profile: getClaudeProfile('digest'), pdfBase64: 'PDFDATA' }),
    /拒絕/
  );
});

test('reading a job description forces the record_job tool and returns its fields', async () => {
  const calls = [];
  const client = {
    messages: {
      create: async (params) => {
        calls.push(params);
        return {
          content: [{
            type: 'tool_use',
            name: 'record_job',
            input: { company: ' Acme ', role: 'SRE', points: ['a', ' ', 'b', 'c', 'd', 'e'] }
          }],
          stop_reason: 'tool_use',
          usage: { input_tokens: 900, output_tokens: 60 }
        };
      }
    }
  };
  const service = createClaudeService({ getApiKey: () => 'key', createClient: () => client });

  const result = await service.summarizeJob({ profile: getClaudeProfile('jobBrief'), jobDescription: 'Senior SRE at Acme.' });

  assert.equal(calls[0].model, getClaudeProfile('jobBrief').model);
  assert.deepEqual(calls[0].thinking, { type: 'disabled' });
  assert.deepEqual(calls[0].tool_choice, { type: 'tool', name: 'record_job' });
  assert.equal(calls[0].tools[0].name, 'record_job');
  assert.match(calls[0].messages[0].content, /Senior SRE at Acme\./);
  assert.equal(result.company, 'Acme');
  assert.equal(result.role, 'SRE');
  assert.deepEqual(result.points, ['a', 'b', 'c', 'd']);
});

test('a reply without the tool call is an error', async () => {
  const client = {
    messages: {
      create: async () => ({ content: [{ type: 'text', text: 'no' }], stop_reason: 'refusal', usage: {} })
    }
  };
  const service = createClaudeService({ getApiKey: () => 'key', createClient: () => client });

  await assert.rejects(
    service.summarizeJob({ profile: getClaudeProfile('jobBrief'), jobDescription: 'x' }),
    /拒絕/
  );
});
