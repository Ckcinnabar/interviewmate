const { createEventListener } = require('./helpers');

// Renderer-facing name -> main-process channel.
const EVENT_CHANNELS = {
  onSttStatus: 'stt-status',
  onMicStatus: 'mic-status',
  onCaption: 'caption',
  onCandidateCaption: 'candidate-caption',
  onAnswerStart: 'answer-start',
  onAnswerChunk: 'answer-chunk',
  onAnswerEnd: 'answer-end',
  onAnswerNotice: 'answer-notice',
  onSessionCleared: 'session-cleared',
  onKnowledgeStatus: 'knowledge-status',
  onJobBrief: 'job-brief',
  onInterviewLanguageChanged: 'interview-language-changed',
  onAutoAnswerChanged: 'auto-answer-changed',
  onMicEnabledChanged: 'mic-enabled-changed',
  onToggleListening: 'toggle-listening',
  onToggleTranscript: 'toggle-transcript',
  onScrollAnswer: 'scroll-answer',
  onSetStealthMode: 'set-stealth-mode',
  onEmergencyClear: 'emergency-clear'
};

function createEventActions(ipcRenderer) {
  const eventActions = {};

  for (const [label, channel] of Object.entries(EVENT_CHANNELS)) {
    eventActions[label] = createEventListener(ipcRenderer, { channel, label });
  }

  return eventActions;
}

module.exports = {
  createEventActions
};
