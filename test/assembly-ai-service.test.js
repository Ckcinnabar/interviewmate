'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createAssemblyAiService } = require('../src/services/assembly-ai/service');

// Stands in for the `ws` WebSocket: records what is sent and lets the test
// play the server's side.
class FakeSocket extends EventEmitter {
  static OPEN = 1;

  constructor(url) {
    super();
    this.url = url;
    this.readyState = FakeSocket.OPEN;
    this.sent = [];
    FakeSocket.last = this;
  }

  send(data) {
    this.sent.push(data);
  }

  terminate() {
    this.readyState = 3;
  }

  serverSays(message) {
    this.emit('message', Buffer.from(JSON.stringify(message)));
  }
}

function setup({ statusChannel } = {}) {
  const sent = [];
  const turns = [];
  const service = createAssemblyAiService({
    WebSocket: FakeSocket,
    desktopCapturer: null,
    label: 'microphone',
    statusChannel,
    getApiKey: () => 'key',
    getSpeechModel: () => 'universal-3-6-pro',
    getLanguageConfig: () => ({ sttLanguageCodes: ['zh', 'en'], convertToTraditional: true }),
    onTurn: (turn) => turns.push(turn),
    sendToRenderer: (channel, payload) => sent.push({ channel, ...payload })
  });
  return { service, sent, turns };
}

test('each stream reports its state on its own channel', () => {
  const { service, sent } = setup({ statusChannel: 'mic-status' });

  service.start();
  FakeSocket.last.emit('open');
  FakeSocket.last.serverSays({ type: 'Begin', id: 'abc' });

  assert.deepEqual(sent.map((event) => `${event.channel}:${event.status}`), ['mic-status:connecting', 'mic-status:listening']);
  assert.match(FakeSocket.last.url, /language_codes=zh&language_codes=en/);
});

test('turns are reported, in Traditional Chinese in Chinese mode', () => {
  const { service, turns } = setup();

  service.start();
  FakeSocket.last.serverSays({ type: 'Turn', transcript: '我会用缓存', end_of_turn: true, turn_order: 2 });

  assert.deepEqual(turns, [{ text: '我會用快取', final: true, turnOrder: 2 }]);
});

test('a connection the server closes is reported as an error with its reason', () => {
  const { service, sent } = setup({ statusChannel: 'mic-status' });

  service.start();
  FakeSocket.last.emit('open');
  FakeSocket.last.serverSays({ type: 'Error', error: 'Audio chunk duration must be between 50ms and 1000ms' });
  FakeSocket.last.emit('close', 3007, Buffer.from(''));

  const last = sent[sent.length - 1];
  assert.equal(last.channel, 'mic-status');
  assert.equal(last.status, 'error');
  assert.match(last.message, /語音轉錄連線中斷（3007：Audio chunk duration/);
  assert.equal(service.isActive(), false);
});

test('stopping a stream ourselves stays quiet', () => {
  const { service, sent } = setup();

  service.start();
  const socket = FakeSocket.last;
  service.stop();
  socket.emit('close', 1000, Buffer.from(''));

  assert.deepEqual(sent.map((event) => event.status), ['connecting', 'stopped']);
  assert.ok(socket.sent.some((data) => String(data).includes('Terminate')));
});
