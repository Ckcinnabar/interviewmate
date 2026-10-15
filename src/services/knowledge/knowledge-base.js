// Loads the candidate's own records (project write-ups, reports) from folders
// on disk. Text files are used as they are. A PDF is turned into notes once by
// `digestPdf`, and the notes are cached on disk keyed by the PDF's content.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Part of the notes cache key. Change it when the way notes are written
// changes, so that existing PDFs are processed again.
const NOTES_VERSION = 'notes-v2';

function comparePaths(a, b) {
  return a < b ? -1 : (a > b ? 1 : 0);
}

function createKnowledgeBase({
  cacheDir,
  digestPdf,
  config,
  fsModule = fs
}) {
  let documents = [];
  let status = {
    state: 'idle',
    folders: 0,
    textFiles: 0,
    pdfFiles: 0,
    pdfReady: 0,
    pdfFailed: 0,
    errors: []
  };
  let refreshSequence = 0;

  const textExtensions = new Set(config.textExtensions.map((extension) => extension.toLowerCase()));
  const pdfExtension = config.pdfExtension.toLowerCase();

  // Walks a folder in a fixed order. The order decides the order of documents
  // in the prompt, and a prompt that changes order between runs cannot be cached.
  function listFiles(folder) {
    const files = [];

    function walk(directory) {
      let entries;
      try {
        entries = fsModule.readdirSync(directory, { withFileTypes: true });
      } catch (error) {
        return;
      }

      entries.sort((a, b) => comparePaths(a.name, b.name));
      const textFiles = [];
      const pdfFiles = [];
      const subdirectories = [];

      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') {
          continue;
        }

        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          subdirectories.push(fullPath);
          continue;
        }

        const extension = path.extname(entry.name).toLowerCase();
        if (textExtensions.has(extension)) {
          textFiles.push({ path: fullPath, kind: 'text' });
        } else if (extension === pdfExtension) {
          pdfFiles.push({ path: fullPath, kind: 'pdf' });
        }
      }

      // Within a directory: text files first, then PDFs, then subdirectories.
      files.push(...textFiles, ...pdfFiles);
      subdirectories.forEach(walk);
    }

    walk(folder);
    return files;
  }

  function sourceLabel(folder, filePath) {
    // Relative to the folder's parent, so the folder's own name is kept.
    return path.relative(path.dirname(folder), filePath).split(path.sep).join('/');
  }

  function digestCachePath(pdfBuffer) {
    const hash = crypto.createHash('sha256').update(NOTES_VERSION).update(pdfBuffer).digest('hex');
    return path.join(cacheDir, `${hash}.md`);
  }

  function readCachedDigest(cachePath) {
    try {
      const text = fsModule.readFileSync(cachePath, 'utf8').trim();
      return text || null;
    } catch (_) {
      return null;
    }
  }

  async function runLimited(tasks, limit) {
    let nextIndex = 0;
    const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
      while (nextIndex < tasks.length) {
        const task = tasks[nextIndex];
        nextIndex += 1;
        await task();
      }
    });
    await Promise.all(workers);
  }

  // Reloads everything under `folders`. `onChange` fires whenever the set of
  // loaded documents grows, so callers can use what is ready so far.
  async function refresh(folders = [], { onChange } = {}) {
    refreshSequence += 1;
    const sequence = refreshSequence;
    const isCurrent = () => sequence === refreshSequence;

    const errors = [];
    const entries = [];
    const validFolders = [];

    for (const rawFolder of folders) {
      const folder = path.resolve(String(rawFolder || '').trim());
      let isDirectory = false;
      try {
        isDirectory = fsModule.statSync(folder).isDirectory();
      } catch (_) {
        isDirectory = false;
      }

      if (!isDirectory) {
        errors.push(`找不到資料夾：${rawFolder}`);
        continue;
      }

      validFolders.push(folder);
      for (const file of listFiles(folder)) {
        entries.push({ ...file, source: sourceLabel(folder, file.path), text: null });
      }
    }

    const pending = [];

    for (const entry of entries) {
      try {
        const size = fsModule.statSync(entry.path).size;

        if (entry.kind === 'text') {
          if (size > config.maxTextFileBytes) {
            errors.push(`檔案太大，已略過：${entry.source}`);
            continue;
          }
          entry.text = fsModule.readFileSync(entry.path, 'utf8').replace(/^﻿/, '').trim();
          continue;
        }

        if (size > config.maxPdfBytes) {
          errors.push(`PDF 太大，已略過：${entry.source}`);
          entry.failed = true;
          continue;
        }

        const pdfBuffer = fsModule.readFileSync(entry.path);
        const cachePath = digestCachePath(pdfBuffer);
        const cached = readCachedDigest(cachePath);
        if (cached) {
          entry.text = cached;
        } else {
          pending.push({ entry, pdfBuffer, cachePath });
        }
      } catch (error) {
        errors.push(`讀取失敗：${entry.source}（${error.message}）`);
        entry.failed = true;
      }
    }

    function publish(state) {
      if (!isCurrent()) {
        return;
      }

      const pdfEntries = entries.filter((entry) => entry.kind === 'pdf');
      documents = entries
        .filter((entry) => entry.text)
        .map((entry) => ({ source: entry.source, kind: entry.kind, text: entry.text }));
      status = {
        state,
        folders: validFolders.length,
        textFiles: entries.filter((entry) => entry.kind === 'text' && entry.text).length,
        pdfFiles: pdfEntries.length,
        pdfReady: pdfEntries.filter((entry) => entry.text).length,
        pdfFailed: pdfEntries.filter((entry) => entry.failed).length,
        errors: [...errors]
      };
      onChange?.(getStatus());
    }

    publish(pending.length > 0 ? 'loading' : 'ready');

    if (pending.length > 0) {
      fsModule.mkdirSync(cacheDir, { recursive: true });

      await runLimited(pending.map(({ entry, pdfBuffer, cachePath }) => async () => {
        if (!isCurrent()) {
          return;
        }

        try {
          // The candidate's own text from the same folder, so the notes can
          // leave out what it already says.
          const writeup = entries
            .filter((other) => (
              other.kind === 'text' && other.text && path.dirname(other.path) === path.dirname(entry.path)
            ))
            .map((other) => other.text)
            .join('\n\n');

          const notes = String(await digestPdf({
            pdfBase64: pdfBuffer.toString('base64'),
            fileName: path.basename(entry.path),
            writeup
          }) || '').trim();

          if (!notes) {
            throw new Error('沒有產生內容');
          }

          fsModule.writeFileSync(cachePath, `${notes}\n`, 'utf8');
          entry.text = notes;
        } catch (error) {
          entry.failed = true;
          errors.push(`PDF 整理失敗：${entry.source}（${error.message}）`);
        }

        publish('loading');
      }), config.pdfConcurrency);

      publish('ready');
    }

    return getStatus();
  }

  function getDocuments() {
    return documents.map((document) => ({ ...document }));
  }

  function getStatus() {
    return { ...status, errors: [...status.errors] };
  }

  return {
    getDocuments,
    getStatus,
    refresh
  };
}

module.exports = {
  createKnowledgeBase
};
