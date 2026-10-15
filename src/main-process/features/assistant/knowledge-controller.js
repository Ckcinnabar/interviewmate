const crypto = require('crypto');
const { buildKnowledgeBlock } = require('../../../services/ai/prompts');

// The cache entry lasts an hour; warming again a little before that keeps it alive.
const PREWARM_REUSE_MS = 50 * 60 * 1000;

// Keeps the candidate's experience documents loaded and ready to send:
// reloads them from the configured folders, reports progress to the renderer,
// measures the prompt size, and warms the prompt cache before an interview.
function createKnowledgeController({
  knowledgeBase,
  claudeService,
  getFolders,
  getProfile,
  buildInstructions,
  warnTokens,
  sendToRenderer,
  now = Date.now
}) {
  let knowledgeText = '';
  let tokens = null;
  let lastPrewarm = { key: '', at: 0 };

  function getStatus() {
    return {
      ...knowledgeBase.getStatus(),
      tokens,
      overBudget: typeof tokens === 'number' && tokens > warnTokens
    };
  }

  function publishStatus() {
    sendToRenderer('knowledge-status', getStatus());
  }

  // The prompt for one request. Profiles that do not use the documents get
  // instructions that do not mention them.
  function getPrompt(profile) {
    const knowledge = profile.includeKnowledge ? knowledgeText : '';
    return {
      knowledge,
      instructions: buildInstructions({ hasKnowledge: Boolean(knowledge) })
    };
  }

  async function measure() {
    if (!knowledgeText || !claudeService.hasApiKey()) {
      tokens = null;
      return;
    }

    const profile = getProfile('voice');
    try {
      tokens = await claudeService.countSystemTokens({ profile, ...getPrompt(profile) });
    } catch (error) {
      tokens = null;
      console.warn('Could not count knowledge tokens:', error.message);
    }
  }

  async function prewarm() {
    const profile = getProfile('voice');
    const prompt = getPrompt(profile);
    // A small prompt gains nothing from warming.
    if (!prompt.knowledge || !claudeService.hasApiKey()) {
      return;
    }

    const key = crypto.createHash('sha256')
      .update(prompt.knowledge)
      .update('\u0000')
      .update(prompt.instructions)
      .digest('hex');
    if (lastPrewarm.key === key && now() - lastPrewarm.at < PREWARM_REUSE_MS) {
      return;
    }

    lastPrewarm = { key, at: now() };
    try {
      const { usage } = await claudeService.prewarm({ profile, ...prompt });
      console.log(
        '[Knowledge] cache warmed:',
        `write=${usage?.cache_creation_input_tokens ?? 0}`,
        `read=${usage?.cache_read_input_tokens ?? 0}`
      );
    } catch (error) {
      lastPrewarm = { key: '', at: 0 };
      console.warn('[Knowledge] cache warm-up failed:', error.message);
    }
  }

  async function refresh() {
    await knowledgeBase.refresh(getFolders(), {
      onChange: () => {
        knowledgeText = buildKnowledgeBlock(knowledgeBase.getDocuments());
        publishStatus();
      }
    });

    knowledgeText = buildKnowledgeBlock(knowledgeBase.getDocuments());
    await measure();
    publishStatus();

    const status = getStatus();
    console.log(
      `[Knowledge] ${status.textFiles} text file(s), ${status.pdfReady}/${status.pdfFiles} PDF(s),`,
      `${status.tokens ?? '?'} tokens`,
      status.errors.length ? `errors: ${status.errors.join(' | ')}` : ''
    );
    return status;
  }

  return {
    getPrompt,
    getStatus,
    prewarm,
    refresh
  };
}

module.exports = {
  createKnowledgeController
};
