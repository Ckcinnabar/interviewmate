'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createJobBriefController } = require('../src/main-process/features/assistant/job-brief-controller');

function setup({ hasApiKey = true, summarizeJob } = {}) {
  const sent = [];
  const requests = [];
  const controller = createJobBriefController({
    claudeService: {
      hasApiKey: () => hasApiKey,
      summarizeJob: summarizeJob || (async ({ profile, jobDescription }) => {
        requests.push({ profile, jobDescription });
        return { company: 'Acme', role: 'Backend Engineer', points: ['Go 微服务', 'Kubernetes'], usage: {} };
      })
    },
    getProfile: (name) => ({ name }),
    maxChars: 50,
    sendToRenderer: (channel, payload) => sent.push({ channel, state: payload.state })
  });
  return { controller, sent, requests };
}

test('it starts empty, with nothing for the answering prompt', () => {
  const { controller } = setup();

  assert.equal(controller.getStatus().state, 'empty');
  assert.deepEqual(controller.getPromptParts(), { jobDescription: '', jobBrief: null });
});

test('a pasted job description is read, then shown and given to answers', async () => {
  const { controller, sent, requests } = setup();

  const status = await controller.setJobDescription('  We need a Go backend engineer.  ');

  assert.deepEqual(sent.map((event) => event.state), ['loading', 'ready']);
  assert.equal(sent[0].channel, 'job-brief');
  assert.equal(requests[0].profile.name, 'jobBrief');
  assert.equal(requests[0].jobDescription, 'We need a Go backend engineer.');
  assert.equal(status.company, 'Acme');
  assert.equal(status.role, 'Backend Engineer');
  // Simplified characters in a point are turned into Traditional.
  assert.deepEqual(status.points, ['Go 微服務', 'Kubernetes']);
  assert.equal(controller.getPromptParts().jobDescription, 'We need a Go backend engineer.');
  assert.equal(controller.getPromptParts().jobBrief.role, 'Backend Engineer');
});

test('a very long job description is cut to the limit', async () => {
  const { controller, requests } = setup();

  await controller.setJobDescription('x'.repeat(80));
  assert.equal(requests[0].jobDescription.length, 50);
});

test('a failure keeps the job description, for answers and for retrying', async () => {
  const { controller, sent } = setup({
    summarizeJob: async () => {
      throw new Error('network down');
    }
  });

  const status = await controller.setJobDescription('Data engineer.');

  assert.deepEqual(sent.map((event) => event.state), ['loading', 'error']);
  assert.equal(status.jobDescription, 'Data engineer.');
  assert.ok(status.message);
  assert.deepEqual(controller.getPromptParts(), { jobDescription: 'Data engineer.', jobBrief: null });
});

test('without an API key it says so and does not call Claude', async () => {
  const { controller, requests } = setup({ hasApiKey: false });

  const status = await controller.setJobDescription('SRE.');

  assert.equal(status.state, 'error');
  assert.match(status.message, /API key/);
  assert.equal(requests.length, 0);
});

test('when a second job description is pasted quickly, the first reply is dropped', async () => {
  let release;
  const { controller } = setup({
    summarizeJob: async ({ jobDescription }) => {
      if (jobDescription === 'first') {
        await new Promise((resolve) => {
          release = resolve;
        });
        return { company: 'Old', role: 'Old', points: [], usage: {} };
      }
      return { company: 'New', role: 'New', points: [], usage: {} };
    }
  });

  const first = controller.setJobDescription('first');
  await controller.setJobDescription('second');
  release();
  await first;

  assert.equal(controller.getStatus().company, 'New');
  assert.equal(controller.getPromptParts().jobDescription, 'second');
});

test('empty text clears it', async () => {
  const { controller } = setup();

  await controller.setJobDescription('SRE.');
  const status = await controller.setJobDescription('   ');

  assert.equal(status.state, 'empty');
  assert.deepEqual(controller.getPromptParts(), { jobDescription: '', jobBrief: null });
});
