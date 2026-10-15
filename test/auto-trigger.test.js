'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createAutoAnswerTrigger,
  looksLikeQuestion
} = require('../src/services/interview/auto-trigger');

// Manual clock and timer queue, so the tests never wait on real time.
function createHarness({ enabled = true, ...options } = {}) {
  let currentTime = 0;
  let nextTimerId = 1;
  const timers = new Map();
  const triggers = [];
  const state = { enabled };

  const trigger = createAutoAnswerTrigger({
    debounceMs: 400,
    partialExtendMs: 900,
    minIntervalMs: 2500,
    ...options,
    isEnabled: () => state.enabled,
    onTrigger: (payload) => triggers.push(payload),
    now: () => currentTime,
    setTimer: (callback, delayMs) => {
      const id = nextTimerId;
      nextTimerId += 1;
      timers.set(id, { callback, at: currentTime + delayMs });
      return id;
    },
    clearTimer: (id) => timers.delete(id)
  });

  function advance(milliseconds) {
    const target = currentTime + milliseconds;
    for (;;) {
      const due = [...timers.entries()]
        .filter(([, timer]) => timer.at <= target)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      currentTime = due[1].at;
      due[1].callback();
    }
    currentTime = target;
  }

  return { trigger, triggers, advance, state };
}

test('recognises English questions', () => {
  assert.equal(looksLikeQuestion('Can you walk me through your last project?'), true);
  assert.equal(looksLikeQuestion('tell me about a time you disagreed with a teammate'), true);
  assert.equal(looksLikeQuestion('how would you design a rate limiter'), true);
  assert.equal(looksLikeQuestion('Which one is faster in practice?'), true);
});

test('recognises Chinese questions, Traditional and Simplified', () => {
  assert.equal(looksLikeQuestion('可以說明一下你怎麼設計 rate limiter 嗎？'), true);
  assert.equal(looksLikeQuestion('請你介紹一下你最近做的專案'), true);
  assert.equal(looksLikeQuestion('為什麼選擇用 Redis 做快取'), true);
  assert.equal(looksLikeQuestion('你为什么选择用 Redis 做缓存'), true);
});

test('ignores chatter, short fragments, and empty text', () => {
  assert.equal(looksLikeQuestion('Okay, great.'), false);
  assert.equal(looksLikeQuestion('Sounds good, thanks for sharing that with us today.'), false);
  assert.equal(looksLikeQuestion('好的，了解。'), false);
  assert.equal(looksLikeQuestion('Why?'), false);
  assert.equal(looksLikeQuestion(''), false);
});

test('fires once after the debounce with the question and when the turn ended', () => {
  const { trigger, triggers, advance } = createHarness();

  advance(1000);
  trigger.handleTurn({ text: 'How does garbage collection work?', final: true, turnOrder: 0 });
  advance(399);
  assert.equal(triggers.length, 0);

  advance(1);
  assert.deepEqual(triggers, [{ question: 'How does garbage collection work?', turnEndedAt: 1000 }]);

  advance(5000);
  assert.equal(triggers.length, 1);
});

test('does not fire for non-questions', () => {
  const { trigger, triggers, advance } = createHarness();

  trigger.handleTurn({ text: 'Okay, that makes sense to me.', final: true, turnOrder: 0 });
  advance(5000);

  assert.equal(triggers.length, 0);
});

test('waits while the interviewer keeps talking and sends the whole question', () => {
  const { trigger, triggers, advance } = createHarness();

  trigger.handleTurn({ text: 'So you mentioned Kafka earlier.', final: true, turnOrder: 0 });
  advance(200);
  trigger.handleTurn({ text: 'how did you', final: false, turnOrder: 1 });
  advance(600);
  assert.equal(triggers.length, 0);

  trigger.handleTurn({ text: 'How did you handle consumer lag?', final: true, turnOrder: 1 });
  advance(400);

  assert.equal(triggers.length, 1);
  assert.equal(triggers[0].question, 'So you mentioned Kafka earlier. How did you handle consumer lag?');
});

test('still fires if speech resumes but never produces another final', () => {
  const { trigger, triggers, advance } = createHarness();

  trigger.handleTurn({ text: 'What is a race condition?', final: true, turnOrder: 0 });
  advance(100);
  trigger.handleTurn({ text: 'um', final: false, turnOrder: 1 });
  advance(900);

  assert.equal(triggers.length, 1);
});

test('a formatted final replaces the unformatted one instead of doubling the question', () => {
  const { trigger, triggers, advance } = createHarness();

  trigger.handleTurn({ text: 'what is a mutex', final: true, turnOrder: 3 });
  advance(100);
  trigger.handleTurn({ text: 'What is a mutex?', final: true, turnOrder: 3 });
  advance(400);

  assert.equal(triggers.length, 1);
  assert.equal(triggers[0].question, 'What is a mutex?');
});

test('spaces out automatic answers without dropping the second question', () => {
  const { trigger, triggers, advance } = createHarness();

  trigger.handleTurn({ text: 'What is a process?', final: true, turnOrder: 0 });
  advance(400);
  assert.equal(triggers.length, 1);

  trigger.handleTurn({ text: 'And what is a thread?', final: true, turnOrder: 1 });
  advance(400);
  assert.equal(triggers.length, 1);

  advance(2100);
  assert.equal(triggers.length, 2);
  assert.equal(triggers[1].question, 'And what is a thread?');
});

test('does nothing while disabled, and drops a pending question when turned off', () => {
  const { trigger, triggers, advance, state } = createHarness({ enabled: false });

  trigger.handleTurn({ text: 'How does TCP differ from UDP?', final: true, turnOrder: 0 });
  advance(5000);
  assert.equal(triggers.length, 0);

  state.enabled = true;
  trigger.handleTurn({ text: 'How does TCP differ from UDP?', final: true, turnOrder: 1 });
  advance(200);
  state.enabled = false;
  advance(5000);
  assert.equal(triggers.length, 0);
});
