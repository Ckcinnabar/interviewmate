// Streaming wrapper around the Anthropic Messages API.

const Anthropic = require('@anthropic-ai/sdk');
const { getSystemCacheTtl } = require('../../config');
const { buildApiMessages, buildJobBriefPrompt, buildPdfDigestPrompt } = require('./prompts');

// Beta flag for the `fallbacks: "default"` request parameter.
const SERVER_SIDE_FALLBACK_BETA = 'server-side-fallback-2026-07-01';

// The reply to a job description is forced into this tool call, so it always
// comes back as fields rather than prose.
const RECORD_JOB_TOOL = {
  name: 'record_job',
  description: 'Records the hiring company, the job title, and the skills the role needs most, as read from a job description.',
  input_schema: {
    type: 'object',
    properties: {
      company: { type: 'string', description: 'The hiring company as written, or an empty string if it is not named.' },
      role: { type: 'string', description: 'The job title as written, or an empty string if none is given.' },
      points: {
        type: 'array',
        items: { type: 'string' },
        description: 'The 3 or 4 skills the role needs most, most important first, each a short phrase.'
      }
    },
    required: ['company', 'role', 'points']
  }
};
const MAX_JOB_POINTS = 4;

class MissingApiKeyError extends Error {
  constructor() {
    super('Anthropic API key not configured.');
    this.name = 'MissingApiKeyError';
  }
}

// The system prompt is two cached blocks. The candidate's documents come
// first: they are the largest part and change least, so switching interview
// language (which rewrites the instructions) still reuses their cache entry.
function buildSystemBlocks({ instructions, knowledge = '' }) {
  const cacheControl = { type: 'ephemeral', ttl: getSystemCacheTtl() };
  const blocks = [];

  if (knowledge) {
    blocks.push({ type: 'text', text: knowledge, cache_control: cacheControl });
  }

  blocks.push({ type: 'text', text: instructions, cache_control: cacheControl });
  return blocks;
}

function applyProfile(params, profile) {
  params.model = profile.model;
  params.output_config = { effort: profile.effort };

  if (profile.thinking) {
    params.thinking = profile.thinking;
  }

  if (profile.fallbacks) {
    params.fallbacks = profile.fallbacks;
    params.betas = [SERVER_SIDE_FALLBACK_BETA];
  }

  return params;
}

function buildRequestParams({ profile, instructions, knowledge, turns }) {
  return applyProfile({
    max_tokens: profile.maxTokens,
    system: buildSystemBlocks({ instructions, knowledge }),
    // Caches the growing conversation behind the system prompt.
    cache_control: { type: 'ephemeral' },
    messages: buildApiMessages(turns)
  }, profile);
}

function describeClaudeError(error) {
  if (error instanceof MissingApiKeyError) {
    return { message: '尚未設定 Anthropic API key，請到設定頁填入。' };
  }

  if (error instanceof Anthropic.APIUserAbortError) {
    return { aborted: true, message: '' };
  }

  if (error instanceof Anthropic.AuthenticationError) {
    return { message: 'Anthropic API key 無效，請到設定頁確認。' };
  }

  if (error instanceof Anthropic.PermissionDeniedError) {
    return { message: '這把 Anthropic API key 沒有使用此模型的權限。' };
  }

  if (error instanceof Anthropic.RateLimitError) {
    return { message: 'Anthropic API 達到速率限制，請稍後再試。' };
  }

  if (error instanceof Anthropic.BadRequestError) {
    return { message: `請求被拒絕：${error.message}` };
  }

  if (error instanceof Anthropic.APIConnectionError) {
    return { message: '無法連線到 Anthropic API，請檢查網路。' };
  }

  if (error instanceof Anthropic.APIError) {
    return { message: `Anthropic API 錯誤（${error.status ?? '未知'}）：${error.message}` };
  }

  return { message: error?.message || '回答失敗。' };
}

function textOf(message) {
  return message.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');
}

function createClaudeService({
  getApiKey,
  createClient = (apiKey) => new Anthropic({ apiKey })
}) {
  let client = null;
  let clientApiKey = '';

  function getClient() {
    const apiKey = String(getApiKey() || '').trim();
    if (!apiKey) {
      throw new MissingApiKeyError();
    }

    if (!client || apiKey !== clientApiKey) {
      client = createClient(apiKey);
      clientApiKey = apiKey;
    }

    return client;
  }

  function hasApiKey() {
    return String(getApiKey() || '').trim().length > 0;
  }

  // `fallbacks` is a beta parameter, so those requests go through the beta endpoint.
  function openStream(activeClient, params, requestOptions) {
    return params.fallbacks
      ? activeClient.beta.messages.stream(params, requestOptions)
      : activeClient.messages.stream(params, requestOptions);
  }

  async function streamAnswer({ profile, instructions, knowledge, turns, signal, onText }) {
    const activeClient = getClient();
    const params = buildRequestParams({ profile, instructions, knowledge, turns });
    const stream = openStream(activeClient, params, signal ? { signal } : undefined);

    if (typeof onText === 'function') {
      stream.on('text', (textDelta) => onText(textDelta));
    }

    const message = await stream.finalMessage();

    return {
      text: textOf(message),
      model: message.model,
      stopReason: message.stop_reason,
      refused: message.stop_reason === 'refusal',
      refusalCategory: message.stop_details?.category ?? null,
      truncated: message.stop_reason === 'max_tokens',
      usage: message.usage
    };
  }

  // Writes the system prompt into the cache ahead of the first question, so
  // that question does not pay for reading a large prompt cold. `max_tokens: 0`
  // makes the API store the prompt and return without generating anything.
  async function prewarm({ profile, instructions, knowledge }) {
    const activeClient = getClient();
    const params = applyProfile({
      max_tokens: 0,
      system: buildSystemBlocks({ instructions, knowledge }),
      messages: [{ role: 'user', content: 'warmup' }]
    }, profile);

    const message = params.fallbacks
      ? await activeClient.beta.messages.create(params)
      : await activeClient.messages.create(params);
    return { usage: message.usage };
  }

  // Size of the system prompt for `profile`, in that model's tokens.
  async function countSystemTokens({ profile, instructions, knowledge }) {
    const activeClient = getClient();
    const result = await activeClient.messages.countTokens({
      model: profile.model,
      system: buildSystemBlocks({ instructions, knowledge }).map(({ type, text }) => ({ type, text })),
      messages: [{ role: 'user', content: 'x' }]
    });
    return result.input_tokens;
  }

  // Turns one PDF into reference notes. Runs once per file; the caller caches
  // the result. `writeup` is the candidate's own text about the same work.
  async function digestPdf({ profile, pdfBase64, writeup, signal }) {
    const activeClient = getClient();
    const params = applyProfile({
      max_tokens: profile.maxTokens,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 }
          },
          { type: 'text', text: buildPdfDigestPrompt({ writeup }) }
        ]
      }]
    }, profile);

    const message = await openStream(activeClient, params, signal ? { signal } : undefined).finalMessage();
    if (message.stop_reason === 'refusal') {
      throw new Error('模型拒絕處理這份文件');
    }

    return { text: textOf(message), truncated: message.stop_reason === 'max_tokens', usage: message.usage };
  }

  // Reads a job description once: the company, the role, and the skills it
  // asks for most. Forcing the tool call needs thinking off (see `jobBrief`).
  async function summarizeJob({ profile, jobDescription, signal }) {
    const activeClient = getClient();
    const params = applyProfile({
      max_tokens: profile.maxTokens,
      tools: [RECORD_JOB_TOOL],
      tool_choice: { type: 'tool', name: RECORD_JOB_TOOL.name },
      messages: [{ role: 'user', content: buildJobBriefPrompt(jobDescription) }]
    }, profile);

    const message = await activeClient.messages.create(params, signal ? { signal } : undefined);
    const call = message.content.find((block) => block.type === 'tool_use' && block.name === RECORD_JOB_TOOL.name);
    if (!call) {
      throw new Error(message.stop_reason === 'refusal' ? '模型拒絕處理這份 JD' : '沒有讀到職缺資訊');
    }

    const input = call.input || {};
    return {
      company: String(input.company || '').trim(),
      role: String(input.role || '').trim(),
      points: (Array.isArray(input.points) ? input.points : [])
        .map((point) => String(point || '').trim())
        .filter(Boolean)
        .slice(0, MAX_JOB_POINTS),
      usage: message.usage
    };
  }

  return {
    countSystemTokens,
    digestPdf,
    hasApiKey,
    prewarm,
    streamAnswer,
    summarizeJob
  };
}

module.exports = {
  MissingApiKeyError,
  SERVER_SIDE_FALLBACK_BETA,
  buildRequestParams,
  buildSystemBlocks,
  createClaudeService,
  describeClaudeError
};
