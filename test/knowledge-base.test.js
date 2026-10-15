'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createKnowledgeBase } = require('../src/services/knowledge/knowledge-base');
const { getKnowledgeConfig } = require('../src/config');

// Builds a throwaway folder tree from { 'relative/path': contents }.
function createWorkspace(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-test-'));
  for (const [relativePath, contents] of Object.entries(files)) {
    const fullPath = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, contents);
  }
  return root;
}

function createHarness(files, { digest } = {}) {
  const root = createWorkspace(files);
  const digested = [];
  const knowledgeBase = createKnowledgeBase({
    cacheDir: path.join(root, '_cache'),
    config: getKnowledgeConfig(),
    digestPdf: async ({ pdfBase64, fileName }) => {
      digested.push(fileName);
      const contents = Buffer.from(pdfBase64, 'base64').toString('utf8');
      return digest ? digest(contents, fileName) : `Notes on ${contents}`;
    }
  });

  return {
    root,
    knowledgeBase,
    digested,
    folder: (name) => path.join(root, name),
    cleanup: () => fs.rmSync(root, { recursive: true, force: true })
  };
}

test('loads text files and PDF notes from every folder in a fixed order', async (t) => {
  const harness = createHarness({
    'project/Beta/README.md': '# Beta\nBuilt the beta service.',
    'project/Beta/report.pdf': 'beta report',
    'project/Alpha/notes.txt': 'Alpha notes',
    'project/Alpha/README.md': '# Alpha',
    'exp/Lab/README.md': '# Lab',
    'exp/Lab/paper.pdf': 'lab paper',
    'exp/Lab/data.csv': 'ignored',
    'project/.hidden/secret.md': 'ignored'
  });
  t.after(harness.cleanup);

  const status = await harness.knowledgeBase.refresh([harness.folder('project'), harness.folder('exp')]);

  assert.deepEqual(
    harness.knowledgeBase.getDocuments().map((document) => `${document.kind}:${document.source}`),
    [
      'text:project/Alpha/README.md',
      'text:project/Alpha/notes.txt',
      'text:project/Beta/README.md',
      'pdf:project/Beta/report.pdf',
      'text:exp/Lab/README.md',
      'pdf:exp/Lab/paper.pdf'
    ]
  );
  assert.equal(harness.knowledgeBase.getDocuments()[3].text, 'Notes on beta report');
  assert.deepEqual(
    { state: status.state, folders: status.folders, textFiles: status.textFiles, pdfFiles: status.pdfFiles, pdfReady: status.pdfReady, pdfFailed: status.pdfFailed },
    { state: 'ready', folders: 2, textFiles: 4, pdfFiles: 2, pdfReady: 2, pdfFailed: 0 }
  );
  assert.deepEqual(status.errors, []);
});

test('a PDF is only turned into notes once', async (t) => {
  const harness = createHarness({ 'exp/Lab/paper.pdf': 'lab paper' });
  t.after(harness.cleanup);

  await harness.knowledgeBase.refresh([harness.folder('exp')]);
  await harness.knowledgeBase.refresh([harness.folder('exp')]);

  assert.deepEqual(harness.digested, ['paper.pdf']);
  assert.equal(harness.knowledgeBase.getDocuments()[0].text, 'Notes on lab paper');
});

test('a changed PDF is processed again, and a renamed one is not', async (t) => {
  const harness = createHarness({ 'exp/Lab/paper.pdf': 'version one' });
  t.after(harness.cleanup);

  await harness.knowledgeBase.refresh([harness.folder('exp')]);
  fs.renameSync(path.join(harness.root, 'exp/Lab/paper.pdf'), path.join(harness.root, 'exp/Lab/renamed.pdf'));
  await harness.knowledgeBase.refresh([harness.folder('exp')]);
  assert.deepEqual(harness.digested, ['paper.pdf']);

  fs.writeFileSync(path.join(harness.root, 'exp/Lab/renamed.pdf'), 'version two');
  await harness.knowledgeBase.refresh([harness.folder('exp')]);
  assert.deepEqual(harness.digested, ['paper.pdf', 'renamed.pdf']);
  assert.equal(harness.knowledgeBase.getDocuments()[0].text, 'Notes on version two');
});

test('a PDF that fails is reported and the rest still load', async (t) => {
  const harness = createHarness(
    {
      'exp/Lab/README.md': '# Lab',
      'exp/Lab/bad.pdf': 'bad',
      'exp/Lab/good.pdf': 'good'
    },
    {
      digest: (contents) => {
        if (contents === 'bad') throw new Error('boom');
        return 'Good notes';
      }
    }
  );
  t.after(harness.cleanup);

  const status = await harness.knowledgeBase.refresh([harness.folder('exp')]);

  assert.deepEqual(
    harness.knowledgeBase.getDocuments().map((document) => document.source),
    ['exp/Lab/README.md', 'exp/Lab/good.pdf']
  );
  assert.equal(status.pdfReady, 1);
  assert.equal(status.pdfFailed, 1);
  assert.match(status.errors[0], /bad\.pdf/);
  assert.match(status.errors[0], /boom/);

  // A failure is not cached: the next refresh tries the file again.
  await harness.knowledgeBase.refresh([harness.folder('exp')]);
  assert.equal(harness.digested.filter((name) => name === 'bad.pdf').length, 2);
});

test('text files are usable while PDFs are still being processed', async (t) => {
  const harness = createHarness({
    'exp/Lab/README.md': '# Lab',
    'exp/Lab/paper.pdf': 'lab paper'
  });
  t.after(harness.cleanup);

  const snapshots = [];
  await harness.knowledgeBase.refresh([harness.folder('exp')], {
    onChange: (status) => snapshots.push({
      state: status.state,
      pdfReady: status.pdfReady,
      documents: harness.knowledgeBase.getDocuments().length
    })
  });

  assert.deepEqual(snapshots[0], { state: 'loading', pdfReady: 0, documents: 1 });
  assert.deepEqual(snapshots[snapshots.length - 1], { state: 'ready', pdfReady: 1, documents: 2 });
});

test('a missing folder is reported and no folders means nothing loaded', async (t) => {
  const harness = createHarness({ 'exp/Lab/README.md': '# Lab' });
  t.after(harness.cleanup);

  const missing = await harness.knowledgeBase.refresh([harness.folder('nope'), harness.folder('exp')]);
  assert.equal(missing.folders, 1);
  assert.equal(missing.textFiles, 1);
  assert.match(missing.errors[0], /找不到資料夾/);

  const empty = await harness.knowledgeBase.refresh([]);
  assert.equal(empty.state, 'ready');
  assert.deepEqual(harness.knowledgeBase.getDocuments(), []);
});

test('an oversized text file is skipped and reported', async (t) => {
  const harness = createHarness({
    'exp/Lab/README.md': '# Lab',
    'exp/Lab/huge.md': 'x'.repeat(getKnowledgeConfig().maxTextFileBytes + 1)
  });
  t.after(harness.cleanup);

  const status = await harness.knowledgeBase.refresh([harness.folder('exp')]);

  assert.equal(status.textFiles, 1);
  assert.match(status.errors[0], /huge\.md/);
});
