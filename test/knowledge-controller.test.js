'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createKnowledgeController } = require('../src/main-process/features/assistant/knowledge-controller');

const VOICE = { model: 'voice-model', includeKnowledge: true };
const SCREEN = { model: 'screen-model', includeKnowledge: false };

function createHarness({ documents = [], hasApiKey = true, tokens = 1000 } = {}) {
  const state = { documents, hasApiKey, tokens, clock: 0, instructionsVersion: 'v1' };
  const calls = { prewarm: [], count: [], events: [] };

  const controller = createKnowledgeController({
    knowledgeBase: {
      refresh: async (folders, { onChange }) => {
        onChange?.();
        return {};
      },
      getDocuments: () => state.documents,
      getStatus: () => ({
        state: 'ready',
        folders: 1,
        textFiles: state.documents.length,
        pdfFiles: 0,
        pdfReady: 0,
        pdfFailed: 0,
        errors: []
      })
    },
    claudeService: {
      hasApiKey: () => state.hasApiKey,
      countSystemTokens: async (request) => {
        calls.count.push(request);
        return state.tokens;
      },
      prewarm: async (request) => {
        calls.prewarm.push(request);
        return { usage: { cache_creation_input_tokens: 10 } };
      }
    },
    getFolders: () => ['folder'],
    getProfile: (name) => (name === 'screen' ? SCREEN : VOICE),
    buildInstructions: ({ hasKnowledge }) => `instructions ${state.instructionsVersion} knowledge=${hasKnowledge}`,
    warnTokens: 80000,
    sendToRenderer: (channel, data) => calls.events.push({ channel, data }),
    now: () => state.clock
  });

  return { controller, calls, state };
}

const DOCUMENT = { source: 'project/Alpha/README.md', kind: 'text', text: 'Built the alpha service.' };

test('spoken questions get the documents, screen questions do not', async () => {
  const { controller } = createHarness({ documents: [DOCUMENT] });
  await controller.refresh();

  const voice = controller.getPrompt(VOICE);
  assert.match(voice.knowledge, /Built the alpha service\./);
  assert.equal(voice.instructions, 'instructions v1 knowledge=true');

  const screen = controller.getPrompt(SCREEN);
  assert.equal(screen.knowledge, '');
  assert.equal(screen.instructions, 'instructions v1 knowledge=false');
});

test('reports the prompt size and flags it when it is over budget', async () => {
  const small = createHarness({ documents: [DOCUMENT], tokens: 46000 });
  const smallStatus = await small.controller.refresh();
  assert.equal(smallStatus.tokens, 46000);
  assert.equal(smallStatus.overBudget, false);
  assert.equal(small.calls.count[0].profile, VOICE);

  const large = createHarness({ documents: [DOCUMENT], tokens: 95000 });
  const largeStatus = await large.controller.refresh();
  assert.equal(largeStatus.overBudget, true);

  const lastEvent = large.calls.events[large.calls.events.length - 1];
  assert.equal(lastEvent.channel, 'knowledge-status');
  assert.equal(lastEvent.data.tokens, 95000);
});

test('with no documents or no API key it neither counts nor warms', async () => {
  const empty = createHarness({ documents: [] });
  await empty.controller.refresh();
  await empty.controller.prewarm();
  assert.equal(empty.calls.count.length, 0);
  assert.equal(empty.calls.prewarm.length, 0);
  assert.equal(empty.controller.getStatus().tokens, null);

  const noKey = createHarness({ documents: [DOCUMENT], hasApiKey: false });
  await noKey.controller.refresh();
  await noKey.controller.prewarm();
  assert.equal(noKey.calls.count.length, 0);
  assert.equal(noKey.calls.prewarm.length, 0);
});

test('warms the cache once per prompt, and again when the prompt changes or the entry is about to expire', async () => {
  const { controller, calls, state } = createHarness({ documents: [DOCUMENT] });
  await controller.refresh();

  await controller.prewarm();
  await controller.prewarm();
  assert.equal(calls.prewarm.length, 1);
  assert.equal(calls.prewarm[0].profile, VOICE);
  assert.match(calls.prewarm[0].knowledge, /Built the alpha service\./);

  // Switching interview language rewrites the instructions.
  state.instructionsVersion = 'v2';
  await controller.prewarm();
  assert.equal(calls.prewarm.length, 2);

  state.clock += 49 * 60 * 1000;
  await controller.prewarm();
  assert.equal(calls.prewarm.length, 2);

  state.clock += 2 * 60 * 1000;
  await controller.prewarm();
  assert.equal(calls.prewarm.length, 3);
});
