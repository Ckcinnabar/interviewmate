'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createAnswerController } = require('../src/main-process/features/assistant/answer-controller');
const { createInterviewSession } = require('../src/services/interview/session');

const VOICE_PROFILE = { model: 'voice-model', thinking: { type: 'disabled' } };
const SCREEN_PROFILE = { model: 'screen-model', thinking: { type: 'adaptive' } };

// A Claude service whose streams are finished by the test, so the order of
// overlapping requests can be controlled.
function createFakeClaudeService() {
  const requests = [];

  return {
    requests,
    streamAnswer({ profile, instructions, knowledge, turns, signal, onText }) {
      return new Promise((resolve, reject) => {
        const request = {
          profile,
          instructions,
          knowledge,
          turns,
          signal,
          emit: (text) => onText(text),
          finish: (text, extra = {}) => resolve({
            text,
            model: profile.model,
            stopReason: 'end_turn',
            refused: false,
            truncated: false,
            usage: {},
            ...extra
          }),
          fail: (error) => reject(error)
        };
        signal.addEventListener('abort', () => reject(new Error('aborted')));
        requests.push(request);
      });
    }
  };
}

function createHarness() {
  const session = createInterviewSession();
  const claudeService = createFakeClaudeService();
  const events = [];
  const captures = [];
  let clock = 1000;

  const controller = createAnswerController({
    session,
    claudeService,
    captureScreen: async (options) => {
      captures.push(options);
      return 'SCREEN';
    },
    getProfile: (name) => (name === 'screen' ? SCREEN_PROFILE : VOICE_PROFILE),
    getPrompt: (profile) => ({ instructions: 'SYSTEM', knowledge: profile === VOICE_PROFILE ? 'KNOWLEDGE' : '' }),
    sendToRenderer: (channel, data) => events.push({ channel, data }),
    now: () => clock
  });

  return {
    session,
    claudeService,
    controller,
    events,
    captures,
    tick: (milliseconds) => { clock += milliseconds; },
    channels: () => events.map((event) => event.channel),
    last: (channel) => [...events].reverse().find((event) => event.channel === channel)?.data
  };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test('streams an answer, reports timing, and records it in the session', async () => {
  const harness = createHarness();
  harness.session.addInterviewerFinal('What is a mutex?', 0);

  const pending = harness.controller.answer({ trigger: 'manual' });
  await settle();

  const [request] = harness.claudeService.requests;
  assert.equal(request.profile, VOICE_PROFILE);
  assert.equal(request.instructions, 'SYSTEM');
  assert.equal(request.knowledge, 'KNOWLEDGE');
  assert.deepEqual(harness.last('answer-start'), {
    id: 'answer-1',
    trigger: 'manual',
    question: 'What is a mutex?',
    thinking: false
  });

  harness.tick(700);
  request.emit('A lock.');
  harness.tick(300);
  request.finish('A lock.');
  await pending;

  assert.deepEqual(harness.channels(), ['answer-start', 'answer-chunk', 'answer-end']);
  assert.deepEqual(harness.last('answer-end'), {
    id: 'answer-1',
    ttftMs: 700,
    totalMs: 1000,
    sinceTurnEndMs: null,
    truncated: false
  });
  assert.equal(harness.session.getHistoryLength(), 2);
});

test('the next request includes the previous answer', async () => {
  const harness = createHarness();

  harness.session.addInterviewerFinal('Which database do you know best?', 0);
  const first = harness.controller.answer();
  await settle();
  harness.claudeService.requests[0].finish('PostgreSQL.');
  await first;

  harness.session.addInterviewerFinal('What are its drawbacks?', 1);
  const second = harness.controller.answer();
  await settle();

  const turns = harness.claudeService.requests[1].turns;
  assert.deepEqual(turns.map((turn) => turn.role), ['user', 'assistant', 'user']);
  assert.equal(turns[1].text, 'PostgreSQL.');

  harness.claudeService.requests[1].finish('Write-heavy scaling.');
  await second;
});

test('a new request aborts the previous one, which is not recorded', async () => {
  const harness = createHarness();

  harness.session.addInterviewerFinal('First question?', 0);
  const first = harness.controller.answer({ trigger: 'auto', question: 'First question?' });
  await settle();
  harness.claudeService.requests[0].emit('Partial');

  harness.session.addInterviewerFinal('Second question?', 1);
  const second = harness.controller.answer({ trigger: 'manual' });
  await settle();

  assert.equal(harness.claudeService.requests[0].signal.aborted, true);
  assert.deepEqual(await first, { id: 'answer-1', aborted: true, error: '' });
  assert.equal(harness.session.getHistoryLength(), 0);

  // The superseding request still carries the first question.
  assert.equal(harness.claudeService.requests[1].turns[0].speech, 'First question?\nSecond question?');

  harness.claudeService.requests[1].finish('Answer to both.');
  await second;

  const ends = harness.events.filter((event) => event.channel === 'answer-end').map((event) => event.data);
  assert.equal(ends[0].id, 'answer-1');
  assert.equal(ends[0].aborted, true);
  assert.equal(ends[1].id, 'answer-2');
  assert.equal(harness.session.getHistoryLength(), 2);
});

test('an answer that finishes after being superseded is not recorded either', async () => {
  const harness = createHarness();

  harness.session.addInterviewerFinal('First question?', 0);
  const first = harness.controller.answer();
  await settle();
  const firstRequest = harness.claudeService.requests[0];

  // Resolve the first stream, then supersede it before its continuation runs.
  firstRequest.finish('First answer.');
  const second = harness.controller.answer();
  await first;
  await settle();

  assert.equal(harness.session.getHistoryLength(), 0);
  harness.claudeService.requests[1].finish('Second answer.');
  await second;
  assert.equal(harness.session.getHistoryLength(), 2);
});

test('a screen request captures the screen and uses the screen profile', async () => {
  const harness = createHarness();

  const pending = harness.controller.answer({ trigger: 'screen' });
  await settle();

  const [request] = harness.claudeService.requests;
  assert.equal(harness.captures.length, 1);
  assert.equal(request.profile, SCREEN_PROFILE);
  assert.equal(request.turns[0].image, 'SCREEN');
  assert.equal(harness.last('answer-start').thinking, true);

  request.finish('Use two pointers.');
  await pending;
});

test('automatic answers report time since the interviewer finished', async () => {
  const harness = createHarness();
  harness.session.addInterviewerFinal('How does TCP work?', 0);

  const pending = harness.controller.answer({ trigger: 'auto', question: 'How does TCP work?', turnEndedAt: 600 });
  await settle();
  harness.tick(500);
  harness.claudeService.requests[0].emit('It');
  harness.claudeService.requests[0].finish('It is reliable.');
  await pending;

  assert.equal(harness.last('answer-end').sinceTurnEndMs, 900);
});

test('with nothing heard yet it shows a notice instead of calling the model', async () => {
  const harness = createHarness();

  const result = await harness.controller.answer();

  assert.equal(result.skipped, true);
  assert.equal(harness.claudeService.requests.length, 0);
  assert.deepEqual(harness.channels(), ['answer-notice']);
});

test('a refused answer is reported and its speech is not retried', async () => {
  const harness = createHarness();
  harness.session.addInterviewerFinal('Declined question?', 0);

  const pending = harness.controller.answer();
  await settle();
  harness.claudeService.requests[0].finish('', { refused: true, stopReason: 'refusal' });
  await pending;

  const end = harness.last('answer-end');
  assert.equal(end.refused, true);
  assert.match(end.error, /拒絕回答/);
  assert.equal(harness.session.getHistoryLength(), 0);
  assert.equal(harness.session.beginAnswer().hasNewInput, false);
});

test('a failed request reports the error and keeps the speech for a retry', async () => {
  const harness = createHarness();
  harness.session.addInterviewerFinal('What is a semaphore?', 0);

  const pending = harness.controller.answer();
  await settle();
  harness.claudeService.requests[0].fail(new Error('network down'));
  await pending;

  assert.match(harness.last('answer-end').error, /network down/);
  assert.equal(harness.session.beginAnswer().messages[0].speech, 'What is a semaphore?');
});

test('clear aborts the active answer and resets the session', async () => {
  const harness = createHarness();
  harness.session.addInterviewerFinal('Question?', 0);

  const pending = harness.controller.answer();
  await settle();
  harness.controller.clear();
  await pending;

  assert.equal(harness.claudeService.requests[0].signal.aborted, true);
  assert.equal(harness.last('session-cleared') !== undefined, true);
  assert.equal(harness.session.beginAnswer().hasNewInput, false);
});

test('a whole-screen request captures without a region', async () => {
  const harness = createHarness();

  const pending = harness.controller.answer({ trigger: 'screen' });
  await settle();

  assert.deepEqual(harness.captures, [{ region: null }]);
  harness.claudeService.requests[0].finish('Done.');
  await pending;
});

test('a region request captures only that region and uses the screen profile', async () => {
  const harness = createHarness();
  const region = { x: 100, y: 200, width: 640, height: 360 };

  const pending = harness.controller.answer({ trigger: 'region', region });
  await settle();

  const [request] = harness.claudeService.requests;
  assert.deepEqual(harness.captures, [{ region }]);
  assert.equal(request.profile, SCREEN_PROFILE);
  assert.equal(request.turns[0].image, 'SCREEN');
  assert.equal(request.turns[0].trigger, 'region');
  assert.equal(harness.last('answer-start').trigger, 'region');

  request.finish('It returns True.');
  await pending;
  assert.equal(harness.session.getHistoryLength(), 2);
});

test('spoken requests never capture the screen', async () => {
  const harness = createHarness();
  harness.session.addInterviewerFinal('What is a mutex?', 0);

  const pending = harness.controller.answer({ trigger: 'manual' });
  await settle();

  assert.deepEqual(harness.captures, []);
  harness.claudeService.requests[0].finish('A lock.');
  await pending;
});
