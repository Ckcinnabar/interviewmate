'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createEchoFilter } = require('../src/services/interview/echo-filter');

function filterAt(clock) {
  return createEchoFilter({ windowMs: 20000, threshold: 0.6, now: () => clock.now });
}

test('the interviewer heard through the speakers is recognised as an echo', () => {
  const clock = { now: 0 };
  const filter = filterAt(clock);

  filter.noteInterviewer('Can you walk me through how you would design a rate limiter?');
  assert.equal(filter.isEcho('can you walk me through how you would design a rate limiter'), true);
});

test('a real answer in English is not an echo, even though it shares common words', () => {
  const clock = { now: 0 };
  const filter = filterAt(clock);

  filter.noteInterviewer('Can you walk me through how you would design a rate limiter?');
  assert.equal(
    filter.isEcho('Sure, I would keep a token bucket for each user in Redis and refill it every second.'),
    false
  );
});

test('Chinese echoes are caught and Chinese answers are kept', () => {
  const clock = { now: 0 };
  const filter = filterAt(clock);

  filter.noteInterviewer('你可以說明一下你怎麼設計限流器嗎？');
  assert.equal(filter.isEcho('你可以說明一下你怎麼設計限流器'), true);
  assert.equal(filter.isEcho('我會用 token bucket，每個使用者一個桶，放在 Redis 裡。'), false);
});

test('only what the interviewer said recently counts', () => {
  const clock = { now: 0 };
  const filter = filterAt(clock);

  filter.noteInterviewer('Tell me about a time you disagreed with your manager.');
  clock.now = 25000;
  assert.equal(filter.isEcho('tell me about a time you disagreed with your manager'), false);
});

test('a one-word line is never treated as an echo', () => {
  const clock = { now: 0 };
  const filter = filterAt(clock);

  filter.noteInterviewer('Okay.');
  assert.equal(filter.isEcho('Okay.'), false);
});
