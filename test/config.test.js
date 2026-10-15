'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../src/config');
const { sanitizeAppState } = require('../src/services/state/app-state');

test('interview languages resolve, cycle, and steer transcription', () => {
  assert.equal(config.getDefaultInterviewLanguage(), 'en');
  assert.equal(config.resolveInterviewLanguage('zh'), 'zh');
  assert.equal(config.resolveInterviewLanguage('klingon'), 'en');
  assert.equal(config.getNextInterviewLanguage('en'), 'zh');
  assert.equal(config.getNextInterviewLanguage('zh'), 'en');

  assert.deepEqual(config.getInterviewLanguageConfig('en').sttLanguageCodes, ['en']);
  assert.deepEqual(config.getInterviewLanguageConfig('zh').sttLanguageCodes, ['zh', 'en']);
  assert.equal(config.getInterviewLanguageConfig('zh').convertToTraditional, true);
  assert.equal(config.getInterviewLanguageConfig('en').convertToTraditional, false);
});

test('Claude profiles exist for spoken and screen questions', () => {
  assert.equal(config.getClaudeProfile('voice').model, 'claude-haiku-5-5');
  assert.equal(config.getClaudeProfile('screen').model, 'claude-opus-5-5');
  assert.throws(() => config.getClaudeProfile('missing'), /not configured/);
});

test('every keyboard shortcut has a unique id and accelerator', () => {
  const shortcuts = config.getKeyboardShortcuts();
  const ids = shortcuts.map((shortcut) => shortcut.id);
  const accelerators = shortcuts.map((shortcut) => shortcut.accelerator);

  assert.equal(new Set(ids).size, ids.length);
  assert.equal(new Set(accelerators).size, accelerators.length);
  assert.equal(config.getKeyboardShortcutAccelerator('answer'), 'Alt+Shift+A');
  assert.equal(config.getKeyboardShortcutAccelerator('answerScreen'), 'Alt+Shift+S');
});

test('every keyboard shortcut has a Chinese and an English label', () => {
  for (const shortcut of config.getKeyboardShortcuts()) {
    assert.ok(shortcut.buttonLabel, `${shortcut.id} needs a buttonLabel`);
    assert.match(shortcut.englishLabel || '', /^[A-Za-z0-9 ]+$/, `${shortcut.id} needs an English label`);
  }
});

test('app state keeps valid settings and drops everything else', () => {
  const state = sanitizeAppState({
    anthropicApiKey: '  sk-ant-test  ',
    assemblyAiApiKey: 'aai',
    interviewLanguage: 'zh',
    autoAnswerEnabled: true,
    micEnabled: true,
    micDeviceId: ' abc123 ',
    micDeviceLabel: 'Headset Microphone (Realtek(R) Audio)',
    programmingLanguage: 'Go',
    candidateResume: 'r'.repeat(9000),
    candidateJobDescription: ' jd ',
    windowOpacityLevel: 99,
    themePreference: 'LIGHT',
    geminiApiKey: 'left over from the old version'
  });

  assert.equal(state.anthropicApiKey, 'sk-ant-test');
  assert.equal(state.interviewLanguage, 'zh');
  assert.equal(state.autoAnswerEnabled, true);
  assert.equal(state.micEnabled, true);
  assert.equal(state.micDeviceId, 'abc123');
  assert.equal(state.micDeviceLabel, 'Headset Microphone (Realtek(R) Audio)');
  assert.equal(state.candidateResume.length, 8000);
  // The job description is pasted in the overlay each time, not saved.
  assert.equal('candidateJobDescription' in state, false);
  assert.equal(state.windowOpacityLevel, 10);
  assert.equal(state.themePreference, 'light');
  assert.equal('geminiApiKey' in state, false);
});

test('app state falls back to defaults for invalid values', () => {
  const state = sanitizeAppState({ interviewLanguage: 'xx', autoAnswerEnabled: 'yes', micEnabled: 'yes', anthropicApiKey: '   ' });

  assert.equal(state.interviewLanguage, null);
  assert.equal(state.autoAnswerEnabled, false);
  assert.equal(state.micEnabled, false);
  assert.equal(state.micDeviceId, '');
  assert.equal(state.anthropicApiKey, null);
});
