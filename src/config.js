// Claude request profiles.
// `voice` answers what the interviewer just said, so it is tuned for the
// fastest first token. `screen` solves what is on the screen, where accuracy
// matters more than speed.
// `digest` is used once per PDF in the experience folders, to turn it into notes.
// `jobBrief` reads the pasted job description once and picks out the company,
// the role, and the skills it asks for. Thinking is off so the reply can be
// forced into a tool call, which guarantees a structured result.
const CLAUDE_PROFILES = {
  voice: {
    model: 'claude-haiku-5-5',
    thinking: { type: 'disabled' },
    effort: 'low',
    maxTokens: 4000,
    // Spoken questions are where the candidate's own experience matters.
    includeKnowledge: true
  },
  screen: {
    model: 'claude-opus-5-5',
    // Thinking cannot be turned off on this model; effort is the only control.
    thinking: { type: 'adaptive' },
    effort: 'medium',
    maxTokens: 16000,
    // Re-run on another model server-side if a safety classifier declines.
    fallbacks: 'default',
    // Screen problems are coding problems; leaving the experience documents
    // out keeps these requests small.
    includeKnowledge: false
  },
  digest: {
    model: 'claude-opus-5-5',
    thinking: { type: 'adaptive' },
    effort: 'medium',
    maxTokens: 16000,
    fallbacks: 'default',
    includeKnowledge: false
  },
  jobBrief: {
    model: 'claude-haiku-5-5',
    thinking: { type: 'disabled' },
    effort: 'medium',
    maxTokens: 1500,
    includeKnowledge: false
  }
};

// Experience folders: every text file and PDF under them is loaded into the
// prompt. `warnTokens` is where the Settings panel starts warning, because the
// voice model's lower price applies to prompts of up to 100K tokens.
const KNOWLEDGE = {
  textExtensions: ['.md', '.markdown', '.txt'],
  pdfExtension: '.pdf',
  maxTextFileBytes: 512 * 1024,
  maxPdfBytes: 30 * 1024 * 1024,
  pdfConcurrency: 3,
  warnTokens: 80000
};

// How long the system prompt stays cached. An interview has pauses longer than
// the default five minutes.
const SYSTEM_CACHE_TTL = '1h';

// AssemblyAI streaming model. It accepts `language_codes` steering, which the
// interview language below drives.
const ASSEMBLY_AI_SPEECH_MODEL = 'universal-3-6-pro';

// Interview language configuration.
// The first language in this list is treated as the default everywhere.
// `sttLanguageCodes` steers transcription; Chinese keeps `en` because spoken
// Mandarin in technical interviews is full of English terms.
const INTERVIEW_LANGUAGES = [
  { id: 'en', label: 'EN', sttLanguageCodes: ['en'], convertToTraditional: false },
  { id: 'zh', label: '中', sttLanguageCodes: ['zh', 'en'], convertToTraditional: true }
];

// Programming language configuration.
// The first language in this list is treated as the default language everywhere.
const PROGRAMMING_LANGUAGES = [
  'Python',
  'Java',
  'JavaScript',
  'TypeScript',
  'C++',
  'Go',
  'Rust',
  'C#',
  'Kotlin'
];

// Auto-answer timing. `debounceMs` is how long to wait after the interviewer
// finishes a turn; `partialExtendMs` is the wait once they start talking again;
// `minIntervalMs` spaces out automatic requests.
const AUTO_ANSWER = {
  debounceMs: 400,
  partialExtendMs: 900,
  minIntervalMs: 2500
};

// Screen captures are JPEG-encoded before upload. 2576 px is the largest
// width the screen model reads at full detail, so captures up to that size
// are sent as they are: code in a shared-screen window is often small.
const SCREENSHOT = {
  maxWidth: 2576,
  jpegQuality: 85
};

// Conversation history is trimmed from the oldest turn once it grows past this.
const SESSION_MAX_CHARS = 120000;

// Characters kept from the resume (Settings) and the job description (pasted
// in the overlay's "這次面試" box).
const CANDIDATE_PROFILE_LIMITS = {
  resume: 8000,
  jobDescription: 8000
};

// Keyboard shortcuts configuration.
// Edit accelerators here to customize app shortcuts in one place.
// Every shortcut is registered globally so the overlay never needs focus.
// `buttonLabel` and `englishLabel` are shown side by side in the shortcut column.
const KEYBOARD_SHORTCUTS = [
  {
    id: 'answer',
    buttonLabel: '回答',
    englishLabel: 'Answer',
    description: '根據面試官剛講的話回答',
    accelerator: 'Alt+Shift+A'
  },
  {
    id: 'answerScreen',
    buttonLabel: '看螢幕',
    englishLabel: 'Screen',
    description: '截取螢幕並解題',
    accelerator: 'Alt+Shift+S'
  },
  {
    id: 'answerRegion',
    buttonLabel: '截片段',
    englishLabel: 'Region',
    description: '拖曳選取螢幕上的一塊範圍，只針對那一塊作答',
    accelerator: 'Alt+Shift+D'
  },
  {
    id: 'toggleListening',
    buttonLabel: '聆聽',
    englishLabel: 'Listen',
    description: '開始或停止聆聽面試官',
    accelerator: 'Alt+Shift+T'
  },
  {
    id: 'toggleTranscript',
    buttonLabel: '逐字稿',
    englishLabel: 'Transcript',
    description: '展開或收合完整逐字稿，用來核對語音辨識',
    accelerator: 'Alt+Shift+R'
  },
  {
    id: 'toggleInterviewLanguage',
    buttonLabel: '語言',
    englishLabel: 'Language',
    description: '切換英文／中文模式',
    accelerator: 'Alt+Shift+L'
  },
  {
    id: 'toggleAutoAnswer',
    buttonLabel: '自動回答',
    englishLabel: 'Auto',
    description: '切換自動回答',
    accelerator: 'Alt+Shift+Q'
  },
  {
    id: 'clearSession',
    buttonLabel: '清空',
    englishLabel: 'Clear',
    description: '清空這場面試的對話與答案',
    accelerator: 'Alt+Shift+C'
  },
  {
    id: 'scrollAnswerUp',
    buttonLabel: '向上捲',
    englishLabel: 'Scroll up',
    description: '答案往上捲',
    accelerator: 'Alt+Shift+PageUp'
  },
  {
    id: 'scrollAnswerDown',
    buttonLabel: '向下捲',
    englishLabel: 'Scroll down',
    description: '答案往下捲',
    accelerator: 'Alt+Shift+PageDown'
  },
  {
    id: 'emergencyHide',
    buttonLabel: '隱藏',
    englishLabel: 'Hide',
    description: '緊急隱藏',
    accelerator: 'Alt+Shift+X'
  },
  {
    id: 'toggleStealth',
    buttonLabel: '隱身',
    englishLabel: 'Stealth',
    description: '切換幾乎全透明',
    accelerator: 'Alt+Shift+H'
  },
  {
    id: 'moveWindowLeft',
    buttonLabel: '左移',
    englishLabel: 'Move left',
    description: '視窗移到左側',
    accelerator: 'Alt+Shift+Left'
  },
  {
    id: 'moveWindowRight',
    buttonLabel: '右移',
    englishLabel: 'Move right',
    description: '視窗移到右側',
    accelerator: 'Alt+Shift+Right'
  },
  {
    id: 'moveWindowUp',
    buttonLabel: '上移',
    englishLabel: 'Move up',
    description: '視窗移到上方',
    accelerator: 'Alt+Shift+Up'
  },
  {
    id: 'moveWindowDown',
    buttonLabel: '下移',
    englishLabel: 'Move down',
    description: '視窗移到下方',
    accelerator: 'Alt+Shift+Down'
  },
  {
    id: 'windowSizePreset1',
    buttonLabel: '尺寸 1',
    englishLabel: 'Size 1',
    description: '最小尺寸',
    accelerator: 'Alt+Shift+1'
  },
  {
    id: 'windowSizePreset2',
    buttonLabel: '尺寸 2',
    englishLabel: 'Size 2',
    description: '最小尺寸 +25%',
    accelerator: 'Alt+Shift+2'
  },
  {
    id: 'windowSizePreset3',
    buttonLabel: '尺寸 3',
    englishLabel: 'Size 3',
    description: '最小尺寸 +50%',
    accelerator: 'Alt+Shift+3'
  },
  {
    id: 'windowSizePreset4',
    buttonLabel: '尺寸 4',
    englishLabel: 'Size 4',
    description: '最小尺寸 +75%',
    accelerator: 'Alt+Shift+4'
  }
];

// Claude profile configuration functions
function getClaudeProfile(profileName) {
  const profile = CLAUDE_PROFILES[profileName];
  if (!profile) {
    throw new Error(`Claude profile "${profileName}" is not configured in src/config.js.`);
  }

  return { ...profile };
}

function getKnowledgeConfig() {
  return { ...KNOWLEDGE, textExtensions: [...KNOWLEDGE.textExtensions] };
}

function getSystemCacheTtl() {
  return SYSTEM_CACHE_TTL;
}

function getAssemblyAiSpeechModel() {
  return ASSEMBLY_AI_SPEECH_MODEL;
}

// Interview language configuration functions
function getInterviewLanguages() {
  return INTERVIEW_LANGUAGES.map((language) => ({
    ...language,
    sttLanguageCodes: [...language.sttLanguageCodes]
  }));
}

function getDefaultInterviewLanguage() {
  return INTERVIEW_LANGUAGES[0].id;
}

function isConfiguredInterviewLanguage(languageId) {
  return INTERVIEW_LANGUAGES.some((language) => language.id === languageId);
}

function resolveInterviewLanguage(languageId) {
  return isConfiguredInterviewLanguage(languageId) ? languageId : getDefaultInterviewLanguage();
}

function getInterviewLanguageConfig(languageId) {
  const resolvedId = resolveInterviewLanguage(languageId);
  return getInterviewLanguages().find((language) => language.id === resolvedId);
}

function getNextInterviewLanguage(languageId) {
  const resolvedId = resolveInterviewLanguage(languageId);
  const index = INTERVIEW_LANGUAGES.findIndex((language) => language.id === resolvedId);
  return INTERVIEW_LANGUAGES[(index + 1) % INTERVIEW_LANGUAGES.length].id;
}

// Programming language configuration functions
function getProgrammingLanguages() {
  if (!Array.isArray(PROGRAMMING_LANGUAGES) || PROGRAMMING_LANGUAGES.length === 0) {
    throw new Error('Programming languages are not configured. Add at least one language to src/config.js.');
  }

  return [...PROGRAMMING_LANGUAGES];
}

function getDefaultProgrammingLanguage() {
  return getProgrammingLanguages()[0];
}

function isConfiguredProgrammingLanguage(languageName) {
  return getProgrammingLanguages().includes(languageName);
}

function resolveProgrammingLanguage(languageName) {
  return isConfiguredProgrammingLanguage(languageName)
    ? languageName
    : getDefaultProgrammingLanguage();
}

function getAutoAnswerConfig() {
  return { ...AUTO_ANSWER };
}

function getScreenshotConfig() {
  return { ...SCREENSHOT };
}

function getSessionMaxChars() {
  return SESSION_MAX_CHARS;
}

function getCandidateProfileLimits() {
  return { ...CANDIDATE_PROFILE_LIMITS };
}

function getKeyboardShortcuts() {
  if (!Array.isArray(KEYBOARD_SHORTCUTS) || KEYBOARD_SHORTCUTS.length === 0) {
    throw new Error('Keyboard shortcuts are not configured. Add at least one shortcut to src/config.js.');
  }

  return KEYBOARD_SHORTCUTS.map((shortcut) => ({ ...shortcut }));
}

function getKeyboardShortcutById(shortcutId) {
  const normalizedId = String(shortcutId || '').trim();
  if (!normalizedId) {
    throw new Error('Shortcut id is required.');
  }

  const shortcut = getKeyboardShortcuts().find((entry) => entry.id === normalizedId);
  if (!shortcut) {
    throw new Error(`Shortcut "${normalizedId}" is not configured in src/config.js.`);
  }

  return shortcut;
}

function getKeyboardShortcutAccelerator(shortcutId) {
  const shortcut = getKeyboardShortcutById(shortcutId);
  const accelerator = String(shortcut.accelerator || '').trim();
  if (!accelerator) {
    throw new Error(`Shortcut "${shortcutId}" is missing an accelerator in src/config.js.`);
  }

  return accelerator;
}

module.exports = {
  getAssemblyAiSpeechModel,
  getAutoAnswerConfig,
  getCandidateProfileLimits,
  getClaudeProfile,
  getDefaultInterviewLanguage,
  getDefaultProgrammingLanguage,
  getInterviewLanguageConfig,
  getInterviewLanguages,
  getKeyboardShortcutAccelerator,
  getKeyboardShortcutById,
  getKeyboardShortcuts,
  getKnowledgeConfig,
  getNextInterviewLanguage,
  getProgrammingLanguages,
  getScreenshotConfig,
  getSessionMaxChars,
  getSystemCacheTtl,
  isConfiguredInterviewLanguage,
  isConfiguredProgrammingLanguage,
  resolveInterviewLanguage,
  resolveProgrammingLanguage
};
