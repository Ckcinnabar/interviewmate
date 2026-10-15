'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createInterviewSession,
  subtractConsumedText
} = require('../src/services/interview/session');

function roles(messages) {
  return messages.map((message) => message.role);
}

test('earlier answers are sent back as assistant turns', () => {
  const session = createInterviewSession();

  session.addInterviewerFinal('Which database do you know best?', 0);
  const first = session.beginAnswer();
  assert.deepEqual(roles(first.messages), ['user']);
  assert.equal(first.messages[0].speech, 'Which database do you know best?');
  first.commit('PostgreSQL, which I ran in production for three years.');

  session.addInterviewerFinal('What are its drawbacks?', 1);
  const second = session.beginAnswer();
  assert.deepEqual(roles(second.messages), ['user', 'assistant', 'user']);
  assert.equal(second.messages[1].text, 'PostgreSQL, which I ran in production for three years.');
  assert.equal(second.messages[2].speech, 'What are its drawbacks?');
});

test('speech that was not answered yet is carried into the next request', () => {
  const session = createInterviewSession();

  session.addInterviewerFinal('Thanks for joining.', 0);
  session.addInterviewerFinal('Tell me about yourself.', 1);
  const draft = session.beginAnswer();

  assert.equal(draft.messages[0].speech, 'Thanks for joining.\nTell me about yourself.');
  assert.equal(draft.question, 'Tell me about yourself.');
});

test('a superseded answer is not recorded and its speech is kept', () => {
  const session = createInterviewSession();

  session.addInterviewerFinal('How does a hash map work?', 0);
  const superseded = session.beginAnswer();
  superseded.discard();

  session.addInterviewerFinal('And what about collisions?', 1);
  const next = session.beginAnswer();

  assert.deepEqual(roles(next.messages), ['user']);
  assert.equal(next.messages[0].speech, 'How does a hash map work?\nAnd what about collisions?');
  assert.equal(session.getHistoryLength(), 0);
});

test('a declined request forgets its speech without recording an answer', () => {
  const session = createInterviewSession();

  session.addInterviewerFinal('Something the model declined.', 0);
  session.beginAnswer().skip();

  const next = session.beginAnswer();
  assert.equal(next.hasNewInput, false);
  assert.equal(session.getHistoryLength(), 0);
});

test('speech that arrives while an answer streams stays pending', () => {
  const session = createInterviewSession();

  session.addInterviewerFinal('First question?', 0);
  const draft = session.beginAnswer();
  session.addInterviewerFinal('Second question?', 1);
  draft.commit('First answer.');

  const next = session.beginAnswer();
  assert.equal(next.messages[2].speech, 'Second question?');
});

test('a partial sent with an answer is not repeated when its final arrives later', () => {
  const session = createInterviewSession();

  session.setInterviewerPartial('can you explain how', 4);
  const draft = session.beginAnswer();
  assert.equal(draft.messages[0].livePartial, 'can you explain how');
  assert.equal(draft.question, 'can you explain how');
  draft.commit('Sure.');

  session.addInterviewerFinal('Can you explain how garbage collection works?', 4);
  const next = session.beginAnswer();
  assert.equal(next.messages[2].speech, 'garbage collection works?');
  assert.equal(next.messages[2].livePartial, '');
});

test('a partial sent with an answer is not repeated when its final arrives mid-stream', () => {
  const session = createInterviewSession();

  session.setInterviewerPartial('can you explain how', 4);
  const draft = session.beginAnswer();
  session.addInterviewerFinal('Can you explain how garbage collection works?', 4);
  draft.commit('Sure.');

  const next = session.beginAnswer();
  assert.equal(next.messages[2].speech, 'garbage collection works?');
});

test('a final that adds nothing to a consumed partial is dropped, including its formatted duplicate', () => {
  const session = createInterviewSession();

  session.setInterviewerPartial('what is a mutex', 2);
  session.beginAnswer().commit('A mutual-exclusion lock.');

  session.addInterviewerFinal('what is a mutex', 2);
  session.addInterviewerFinal('What is a mutex?', 2);

  assert.equal(session.beginAnswer().hasNewInput, false);
});

test('the formatted final replaces the unformatted final of the same turn', () => {
  const session = createInterviewSession();

  session.addInterviewerFinal('tell me about a time you failed', 7);
  session.addInterviewerFinal('Tell me about a time you failed.', 7);

  const draft = session.beginAnswer();
  assert.equal(draft.messages[0].speech, 'Tell me about a time you failed.');
});

test('a late duplicate of an already answered turn is ignored', () => {
  const session = createInterviewSession();

  session.addInterviewerFinal('what is a deadlock', 3);
  session.beginAnswer().commit('Two threads each waiting on the other.');
  session.addInterviewerFinal('What is a deadlock?', 3);

  assert.equal(session.beginAnswer().hasNewInput, false);
});

test('an empty final clears a stale partial', () => {
  const session = createInterviewSession();

  session.setInterviewerPartial('uh', 5);
  session.addInterviewerFinal('', 5);

  const draft = session.beginAnswer();
  assert.equal(draft.messages[0].livePartial, '');
  assert.equal(draft.hasNewInput, false);
});

test('consecutive Chinese sentences are all kept', () => {
  const session = createInterviewSession();

  session.addInterviewerFinal('請你先自我介紹。', 0);
  session.addInterviewerFinal('然後說說你最熟悉的資料庫。', 1);

  const draft = session.beginAnswer();
  assert.equal(draft.messages[0].speech, '請你先自我介紹。\n然後說說你最熟悉的資料庫。');
});

test('turn numbers from a previous stream are not matched after a restart', () => {
  const session = createInterviewSession();

  session.addInterviewerFinal('First stream question?', 0);
  session.beginAnswer().commit('First stream answer.');

  session.resetTurnTracking();
  session.addInterviewerFinal('New stream question?', 0);

  const draft = session.beginAnswer();
  assert.equal(draft.messages[2].speech, 'New stream question?');
});

test('a screen capture is sent once and replaced by a note afterwards', () => {
  const session = createInterviewSession();

  const first = session.beginAnswer({ trigger: 'screen', image: 'FIRST' });
  assert.equal(first.messages[0].image, 'FIRST');
  assert.equal(first.messages[0].imageNote, '');
  first.commit('Solution one.');

  session.addInterviewerFinal('Can you optimise it?', 0);
  const followUp = session.beginAnswer();
  assert.equal(followUp.messages[0].image, null);
  assert.match(followUp.messages[0].imageNote, /earlier screen capture/);
  assert.equal(followUp.messages[1].text, 'Solution one.');
  assert.equal(followUp.messages[2].image, null);
  followUp.commit('Yes.');

  const second = session.beginAnswer({ trigger: 'screen', image: 'SECOND' });
  assert.equal(second.messages[0].image, null);
  assert.equal(second.messages[4].image, 'SECOND');
});

test('clear forgets the whole interview', () => {
  const session = createInterviewSession();

  session.addInterviewerFinal('Question?', 0);
  session.beginAnswer().commit('Answer.');
  session.addInterviewerFinal('Pending question?', 1);
  session.clear();

  const draft = session.beginAnswer();
  assert.deepEqual(roles(draft.messages), ['user']);
  assert.equal(draft.hasNewInput, false);
  assert.equal(draft.hasHistory, false);
});

test('history is trimmed from the oldest pair and still starts with a user turn', () => {
  const session = createInterviewSession({ maxChars: 400 });

  for (let index = 0; index < 10; index += 1) {
    session.addInterviewerFinal(`Question number ${index}? ${'q'.repeat(40)}`, index);
    session.beginAnswer().commit(`Answer number ${index}. ${'a'.repeat(40)}`);
  }

  session.addInterviewerFinal('Latest question?', 99);
  const draft = session.beginAnswer();
  const historyTurns = draft.messages.slice(0, -1);
  const totalChars = historyTurns.reduce((sum, turn) => sum + (turn.speech || turn.text || '').length, 0);

  assert.ok(totalChars <= 400, `history is ${totalChars} chars`);
  assert.equal(draft.messages[0].role, 'user');
  assert.equal(historyTurns.length % 2, 0);
  assert.match(historyTurns[historyTurns.length - 1].text, /Answer number 9/);
});

test('subtractConsumedText ignores punctuation and casing differences', () => {
  assert.equal(subtractConsumedText('Hello, world. How are you?', 'hello world'), 'How are you?');
  assert.equal(subtractConsumedText('你好，請問你會什麼？', '你好請問'), '你會什麼？');
  assert.equal(subtractConsumedText('Same text.', 'same text'), '');
});

test('what the candidate said is listed with the interviewer, in the order they spoke', () => {
  const session = createInterviewSession();

  session.addInterviewerFinal('How would you rate-limit an API?', 0);
  session.beginAnswer().commit('I would use a token bucket per user.');

  session.addCandidateFinal('I would use a token bucket for each user.', 0);
  session.addInterviewerFinal('And across several servers?', 1);
  const draft = session.beginAnswer();
  const turn = draft.messages[2];

  assert.equal(turn.speech, 'And across several servers?');
  assert.deepEqual(turn.exchange, [
    { speaker: 'candidate', text: 'I would use a token bucket for each user.' },
    { speaker: 'interviewer', text: 'And across several servers?' }
  ]);
  assert.equal(draft.candidateCount, 1);
});

test('without microphone input a turn has no exchange', () => {
  const session = createInterviewSession();

  session.addInterviewerFinal('What is a mutex?', 0);
  assert.deepEqual(session.beginAnswer().messages[0].exchange, []);
});

test('a formatted candidate final replaces the unformatted one of the same turn', () => {
  const session = createInterviewSession();

  session.addCandidateFinal('i used redis for the cache', 3);
  session.addCandidateFinal('I used Redis for the cache.', 3);
  session.addInterviewerFinal('Why Redis?', 0);

  assert.deepEqual(session.beginAnswer().messages[0].exchange, [
    { speaker: 'candidate', text: 'I used Redis for the cache.' },
    { speaker: 'interviewer', text: 'Why Redis?' }
  ]);
});

test('candidate speech alone counts as new input', () => {
  const session = createInterviewSession();

  session.addCandidateFinal('So the first step is to sort the intervals.', 0);
  const draft = session.beginAnswer();

  assert.equal(draft.hasNewInput, true);
  assert.equal(draft.messages[0].speech, '');
});

test('what the candidate says while an answer streams is kept for the next request', () => {
  const session = createInterviewSession();

  session.addCandidateFinal('Let me think about that.', 0);
  session.addInterviewerFinal('What is a deadlock?', 0);
  const draft = session.beginAnswer();
  session.addCandidateFinal('A deadlock is when two threads wait on each other.', 1);
  draft.commit('Two threads each hold a lock the other needs.');

  session.addInterviewerFinal('How do you prevent it?', 1);
  const next = session.beginAnswer();
  assert.deepEqual(next.messages[2].exchange, [
    { speaker: 'candidate', text: 'A deadlock is when two threads wait on each other.' },
    { speaker: 'interviewer', text: 'How do you prevent it?' }
  ]);
});

test('a late formatted final of candidate speech already sent is not added again', () => {
  const session = createInterviewSession();

  session.addCandidateFinal('i used kafka', 2);
  session.addInterviewerFinal('Why Kafka?', 0);
  session.beginAnswer().commit('For ordered, replayable events.');

  session.addCandidateFinal('I used Kafka.', 2);
  session.addInterviewerFinal('What about retention?', 1);
  assert.deepEqual(session.beginAnswer().messages[2].exchange, []);
});

test('the recorded turn keeps what the candidate said', () => {
  const session = createInterviewSession();

  session.addCandidateFinal('I led the migration.', 0);
  session.addInterviewerFinal('What was hardest?', 0);
  session.beginAnswer().commit('Keeping both systems in sync.');

  session.addInterviewerFinal('How long did it take?', 1);
  assert.deepEqual(session.beginAnswer().messages[0].exchange, [
    { speaker: 'candidate', text: 'I led the migration.' },
    { speaker: 'interviewer', text: 'What was hardest?' }
  ]);
});

test('clearing the session forgets the candidate speech too', () => {
  const session = createInterviewSession();

  session.addCandidateFinal('Something I said.', 0);
  session.clear();

  const draft = session.beginAnswer();
  assert.equal(draft.hasNewInput, false);
  assert.equal(draft.candidateCount, 0);
});

test('candidate turn numbers from an earlier microphone stream do not match the new one', () => {
  const session = createInterviewSession();

  session.addCandidateFinal('First stream, turn zero.', 0);
  session.resetCandidateTurnTracking();
  session.addCandidateFinal('Second stream, turn zero.', 0);

  assert.deepEqual(
    session.beginAnswer().messages[0].exchange.map((line) => line.text),
    ['First stream, turn zero.', 'Second stream, turn zero.']
  );
});
