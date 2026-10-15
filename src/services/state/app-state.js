const fs = require('fs');
const path = require('path');
const {
  getCandidateProfileLimits,
  isConfiguredInterviewLanguage
} = require('../../config');

const APP_STATE_DIR_NAME = 'cache';
const APP_STATE_FILE_NAME = 'app-state.json';

function getDefaultAppState() {
  return {
    anthropicApiKey: null,
    assemblyAiApiKey: null,
    interviewLanguage: null,
    autoAnswerEnabled: false,
    micEnabled: false,
    micDeviceId: '',
    micDeviceLabel: '',
    programmingLanguage: null,
    candidateResume: '',
    knowledgeFolders: [],
    windowOpacityLevel: 10,
    themePreference: null
  };
}

function sanitizeText(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function sanitizeAppState(state) {
  const nextState = getDefaultAppState();

  if (state && typeof state === 'object' && !Array.isArray(state)) {
    if (typeof state.anthropicApiKey === 'string') {
      const anthropicApiKey = state.anthropicApiKey.trim();
      nextState.anthropicApiKey = anthropicApiKey || null;
    }

    if (typeof state.assemblyAiApiKey === 'string') {
      const assemblyAiApiKey = state.assemblyAiApiKey.trim();
      nextState.assemblyAiApiKey = assemblyAiApiKey || null;
    }

    if (isConfiguredInterviewLanguage(state.interviewLanguage)) {
      nextState.interviewLanguage = state.interviewLanguage;
    }

    nextState.autoAnswerEnabled = state.autoAnswerEnabled === true;
    nextState.micEnabled = state.micEnabled === true;
    nextState.micDeviceId = sanitizeText(state.micDeviceId, 512);
    nextState.micDeviceLabel = sanitizeText(state.micDeviceLabel, 256);

    if (typeof state.programmingLanguage === 'string' && state.programmingLanguage.trim()) {
      nextState.programmingLanguage = state.programmingLanguage.trim();
    }

    const profileLimits = getCandidateProfileLimits();
    nextState.candidateResume = sanitizeText(state.candidateResume, profileLimits.resume);

    if (Array.isArray(state.knowledgeFolders)) {
      const folders = state.knowledgeFolders
        .map((folder) => (typeof folder === 'string' ? folder.trim() : ''))
        .filter(Boolean);
      nextState.knowledgeFolders = [...new Set(folders)];
    }

    const windowOpacityLevel = Number.parseInt(String(state.windowOpacityLevel ?? ''), 10);
    if (Number.isFinite(windowOpacityLevel)) {
      nextState.windowOpacityLevel = Math.min(Math.max(windowOpacityLevel, 1), 10);
    }

    const themePreference = String(state.themePreference ?? '').trim().toLowerCase();
    if (themePreference === 'dark' || themePreference === 'light') {
      nextState.themePreference = themePreference;
    }
  }

  return nextState;
}

function getAppStateBaseDir(app) {
  // Dev: project root next to package.json so devs can inspect state easily.
  if (app && !app.isPackaged) {
    return path.join(__dirname, '..', '..', '..');
  }

  // Packaged: userData (e.g. %APPDATA%/<productName> on Windows). Critical for
  // portable builds — the EXE extracts to a temp dir each launch, so writing
  // beside the EXE means state is wiped every run.
  if (app) {
    return app.getPath('userData');
  }

  return path.join(__dirname, '..', '..', '..');
}

function getAppStateDir(app) {
  return path.join(getAppStateBaseDir(app), APP_STATE_DIR_NAME);
}

function getAppStatePath(app) {
  return path.join(getAppStateDir(app), APP_STATE_FILE_NAME);
}

function ensureAppStateDir(app) {
  fs.mkdirSync(getAppStateDir(app), { recursive: true });
}

function writeAppStateFile(app, state) {
  ensureAppStateDir(app);
  fs.writeFileSync(
    getAppStatePath(app),
    `${JSON.stringify(state, null, 2)}\n`,
    'utf8'
  );
}

function loadAppState(app) {
  const appStatePath = getAppStatePath(app);

  try {
    ensureAppStateDir(app);

    if (!fs.existsSync(appStatePath)) {
      const defaultState = getDefaultAppState();
      writeAppStateFile(app, defaultState);
      return defaultState;
    }

    const fileContent = fs.readFileSync(appStatePath, 'utf8');
    const sanitizedState = sanitizeAppState(JSON.parse(fileContent));
    writeAppStateFile(app, sanitizedState);
    return sanitizedState;
  } catch (error) {
    console.error('Failed to load app state:', error);
    return getDefaultAppState();
  }
}

function saveAppState(app, partialState = {}) {
  ensureAppStateDir(app);

  const currentState = loadAppState(app);
  const nextState = sanitizeAppState({
    ...currentState,
    ...partialState
  });

  writeAppStateFile(app, nextState);

  return nextState;
}

module.exports = {
  getDefaultAppState,
  sanitizeAppState,
  getAppStatePath,
  loadAppState,
  saveAppState
};
