const path = require('path');
const {
  app,
  dialog,
  desktopCapturer,
  globalShortcut,
  ipcMain,
  screen
} = require('electron');
const WebSocket = require('ws');

const { loadApplicationEnvironment } = require('../bootstrap/environment');
const {
  getAssemblyAiSpeechModel,
  getAutoAnswerConfig,
  getCandidateProfileLimits,
  getClaudeProfile,
  getInterviewLanguageConfig,
  getKeyboardShortcutAccelerator,
  getKnowledgeConfig,
  getNextInterviewLanguage,
  getSessionMaxChars,
  resolveInterviewLanguage,
  resolveProgrammingLanguage
} = require('../config');
const {
  getAppStatePath,
  loadAppState,
  saveAppState
} = require('../services/state/app-state');
const { createAssistantWindow } = require('../windows/assistant/window');
const { createSafeSender } = require('./shared/safe-send');
const { createClaudeService } = require('../services/ai/claude-service');
const { buildSystemPrompt } = require('../services/ai/prompts');
const { createInterviewSession } = require('../services/interview/session');
const { createAutoAnswerTrigger } = require('../services/interview/auto-trigger');
const { createEchoFilter } = require('../services/interview/echo-filter');
const { createKnowledgeBase } = require('../services/knowledge/knowledge-base');
const { createAnswerController } = require('./features/assistant/answer-controller');
const { createKnowledgeController } = require('./features/assistant/knowledge-controller');
const { createJobBriefController } = require('./features/assistant/job-brief-controller');
const { createScreenshotManager } = require('./features/assistant/screenshot-manager');
const { createRegionSelector } = require('./features/assistant/region-selector');
const { createRegionSelectWindow } = require('../windows/region-select/window');
const { registerAssistantIpc } = require('./features/assistant/ipc');
const { createAssemblyAiService } = require('../services/assembly-ai/service');
const { registerAssemblyAiIpc } = require('../services/assembly-ai/ipc');
const { registerSettingsIpc } = require('./features/settings/ipc');
const { createWindowController } = require('./features/window/window-controller');
const { DEFAULT_WINDOW_OPACITY_LEVEL } = require('./features/window/window-constants');
const { logStartupConfiguration } = require('./startup-logging');

function resolveStartupOptions(argv = process.argv) {
  const normalizedArgs = Array.isArray(argv)
    ? argv.map((value) => String(value || '').trim().toLowerCase())
    : [];

  const hasFlag = (flag) => normalizedArgs.includes(flag);

  return {
    startHidden: hasFlag('--start-hidden') || hasFlag('--background')
  };
}

async function startApplication() {
  let appEnvironment = null;
  let appState = null;
  let isShuttingDown = false;
  const startupOptions = resolveStartupOptions();

  let windowController = null;

  const sendToRenderer = createSafeSender(() => {
    if (!windowController) {
      return null;
    }

    return windowController.getMainWindow();
  });

  function updateAppState(partialState) {
    appState = saveAppState(app, partialState);
    return appState;
  }

  function getInterviewLanguage() {
    return resolveInterviewLanguage(appState?.interviewLanguage);
  }

  function isAutoAnswerEnabled() {
    return appState?.autoAnswerEnabled === true;
  }

  const session = createInterviewSession({ maxChars: getSessionMaxChars() });

  const claudeService = createClaudeService({
    getApiKey: () => appState?.anthropicApiKey || ''
  });

  // PDFs in the experience folders are turned into notes once; the notes are
  // cached next to the app state.
  const knowledgeBase = createKnowledgeBase({
    cacheDir: path.join(path.dirname(getAppStatePath(app)), 'knowledge'),
    config: getKnowledgeConfig(),
    digestPdf: async ({ pdfBase64, writeup }) => {
      const result = await claudeService.digestPdf({
        profile: getClaudeProfile('digest'),
        pdfBase64,
        writeup
      });
      return result.text;
    }
  });

  // The job description pasted in the overlay, and what was read from it.
  const jobBriefController = createJobBriefController({
    claudeService,
    getProfile: getClaudeProfile,
    maxChars: getCandidateProfileLimits().jobDescription,
    sendToRenderer
  });

  const knowledgeController = createKnowledgeController({
    knowledgeBase,
    claudeService,
    getFolders: () => appState?.knowledgeFolders || [],
    getProfile: getClaudeProfile,
    buildInstructions: ({ hasKnowledge }) => buildSystemPrompt({
      interviewLanguage: getInterviewLanguage(),
      programmingLanguage: resolveProgrammingLanguage(appState?.programmingLanguage),
      candidateProfile: {
        resume: appState?.candidateResume
      },
      ...jobBriefController.getPromptParts(),
      hasKnowledge,
      screenShortcut: getKeyboardShortcutAccelerator('answerScreen')
    }),
    warnTokens: getKnowledgeConfig().warnTokens,
    sendToRenderer
  });

  function refreshKnowledge() {
    knowledgeController.refresh().catch((error) => {
      console.error('Failed to load experience documents:', error);
    });
  }

  let answerController = null;

  const autoAnswerTrigger = createAutoAnswerTrigger({
    ...getAutoAnswerConfig(),
    isEnabled: isAutoAnswerEnabled,
    onTrigger: ({ question, turnEndedAt }) => {
      answerController.answer({ trigger: 'auto', question, turnEndedAt });
    }
  });

  // Lines from the candidate's microphone that are really the interviewer,
  // heard through the speakers.
  const echoFilter = createEchoFilter();
  // Turn numbers restart with every microphone stream; this tells streams apart.
  let micStreamCount = 0;

  const assemblyAiService = createAssemblyAiService({
    WebSocket,
    desktopCapturer,
    getApiKey: () => appState?.assemblyAiApiKey || '',
    getSpeechModel: getAssemblyAiSpeechModel,
    getLanguageConfig: () => getInterviewLanguageConfig(getInterviewLanguage()),
    onStreamStart: () => {
      session.resetTurnTracking();
      autoAnswerTrigger.reset();
      // Listening has started, so a question is coming: have the prompt cached.
      knowledgeController.prewarm();
    },
    onTurn: ({ text, final, turnOrder }) => {
      if (final) {
        session.addInterviewerFinal(text, turnOrder);
      } else {
        session.setInterviewerPartial(text, turnOrder);
      }

      if (text) {
        echoFilter.noteInterviewer(text);
        sendToRenderer('caption', { text, final });
      }

      autoAnswerTrigger.handleTurn({ text, final, turnOrder });
    },
    sendToRenderer
  });

  // The candidate's own microphone. What they say is context for the next
  // answer; it never triggers an answer by itself.
  const micService = createAssemblyAiService({
    WebSocket,
    desktopCapturer,
    label: 'microphone',
    statusChannel: 'mic-status',
    getApiKey: () => appState?.assemblyAiApiKey || '',
    getSpeechModel: getAssemblyAiSpeechModel,
    getLanguageConfig: () => getInterviewLanguageConfig(getInterviewLanguage()),
    onStreamStart: () => {
      micStreamCount += 1;
      session.resetCandidateTurnTracking();
    },
    onTurn: ({ text, final, turnOrder }) => {
      if (!final || !text) {
        return;
      }

      if (echoFilter.isEcho(text)) {
        console.log('[Mic] Ignored a line that repeats the interviewer (speaker echo)');
        return;
      }

      session.addCandidateFinal(text, turnOrder);
      const turnKey = turnOrder === undefined || turnOrder === null ? null : `${micStreamCount}:${turnOrder}`;
      sendToRenderer('candidate-caption', { text, turnKey });
    },
    sendToRenderer
  });

  function clearSession() {
    autoAnswerTrigger.reset();
    answerController.clear();
  }

  function setInterviewLanguage(language) {
    const interviewLanguage = resolveInterviewLanguage(language);
    if (interviewLanguage !== getInterviewLanguage()) {
      updateAppState({ interviewLanguage });
      // The language is a connection parameter, so open streams reconnect.
      assemblyAiService.restart();
      micService.restart();
    }

    sendToRenderer('interview-language-changed', { interviewLanguage });
    return { success: true, interviewLanguage };
  }

  function setAutoAnswerEnabled(enabled) {
    const autoAnswerEnabled = enabled === true;
    updateAppState({ autoAnswerEnabled });
    if (!autoAnswerEnabled) {
      autoAnswerTrigger.reset();
    }

    sendToRenderer('auto-answer-changed', { autoAnswerEnabled });
    return { success: true, autoAnswerEnabled };
  }

  // Audio capture lives in the renderer, which starts and stops the
  // microphone stream; turning it off also closes the stream here.
  function setMicEnabled(enabled) {
    const micEnabled = enabled === true;
    updateAppState({ micEnabled });
    if (!micEnabled) {
      micService.stop();
    }

    sendToRenderer('mic-enabled-changed', { micEnabled });
    return { success: true, micEnabled };
  }

  windowController = createWindowController({
    app,
    screen,
    globalShortcut,
    createAssistantWindow,
    getAppEnvironment: () => appEnvironment,
    sendToRenderer,
    actions: {
      answer: () => answerController.answer({ trigger: 'manual' }),
      answerScreen: () => answerController.answer({ trigger: 'screen' }),
      answerRegion: async () => {
        const region = await regionSelector.select();
        if (!region) {
          return;
        }

        // Give the selection window a moment to leave the screen, for the
        // case where the app is not hidden from capture.
        await new Promise((resolve) => setTimeout(resolve, 80));
        await answerController.answer({ trigger: 'region', region });
      },
      // Audio capture lives in the renderer, so it performs the toggle.
      toggleListening: () => sendToRenderer('toggle-listening'),
      toggleTranscript: () => sendToRenderer('toggle-transcript'),
      toggleInterviewLanguage: () => setInterviewLanguage(getNextInterviewLanguage(getInterviewLanguage())),
      toggleAutoAnswer: () => setAutoAnswerEnabled(!isAutoAnswerEnabled()),
      clearSession,
      scrollAnswer: (direction) => sendToRenderer('scroll-answer', { direction })
    }
  });

  const regionSelector = createRegionSelector({
    ipcMain,
    screen,
    globalShortcut,
    createWindow: createRegionSelectWindow,
    getAppEnvironment: () => appEnvironment
  });

  const screenshotManager = createScreenshotManager({
    getMainWindow: () => windowController.getMainWindow(),
    getAppEnvironment: () => appEnvironment
  });

  answerController = createAnswerController({
    session,
    claudeService,
    captureScreen: () => screenshotManager.captureScreenJpeg(),
    getProfile: getClaudeProfile,
    getPrompt: (profile) => knowledgeController.getPrompt(profile),
    sendToRenderer
  });

  function loadPersistedAppState() {
    appState = loadAppState(app);

    const activeWindowOpacityLevel = windowController.setWindowOpacityLevel(appState.windowOpacityLevel);
    if (appState.windowOpacityLevel !== activeWindowOpacityLevel) {
      updateAppState({ windowOpacityLevel: activeWindowOpacityLevel });
    }

    console.log('Loaded app state from:', getAppStatePath(app));
  }

  function cleanupTransientResources() {
    regionSelector.cancel();
    answerController.cancelActive();
    autoAnswerTrigger.reset();
    assemblyAiService.dispose();
    micService.dispose();
    windowController.unregisterShortcuts();
  }

  function quitApplication() {
    if (isShuttingDown) {
      return;
    }

    isShuttingDown = true;

    cleanupTransientResources();
    windowController.destroyWindow();

    setTimeout(() => {
      app.exit(0);
    }, 50);
  }

  registerAssistantIpc({
    ipcMain,
    windowController,
    jobBriefController,
    clearSession,
    quitApplication
  });

  registerAssemblyAiIpc({
    ipcMain,
    assemblyAiService,
    micService
  });

  registerSettingsIpc({
    ipcMain,
    getAppEnvironment: () => appEnvironment,
    getAppState: () => appState,
    updateAppState,
    windowController,
    setInterviewLanguage,
    setAutoAnswerEnabled,
    setMicEnabled,
    getKnowledgeStatus: () => knowledgeController.getStatus(),
    refreshKnowledge
  });

  app.whenReady().then(() => {
    try {
      appEnvironment = loadApplicationEnvironment(app);
    } catch (error) {
      console.error('Failed to load application environment:', error);
      dialog.showErrorBox('InterviewMate Configuration Error', error.message);
      app.exit(1);
      return;
    }

    loadPersistedAppState();
    refreshKnowledge();

    logStartupConfiguration({
      appEnvironment,
      appState,
      interviewLanguage: getInterviewLanguage(),
      voiceModel: getClaudeProfile('voice').model,
      screenModel: getClaudeProfile('screen').model,
      speechModel: getAssemblyAiSpeechModel()
    });

    app.commandLine.appendSwitch('enable-features', 'VaapiVideoDecoder');
    app.commandLine.appendSwitch('ignore-certificate-errors');
    app.commandLine.appendSwitch('allow-running-insecure-content');
    app.commandLine.appendSwitch('disable-web-security');
    app.commandLine.appendSwitch('enable-media-stream');

    const launchHidden = startupOptions.startHidden || appEnvironment.startHidden;
    console.log('App is ready, creating window...');
    console.log(`Startup mode: ${launchHidden ? 'hidden' : 'visible'}`);
    windowController.createWindow({ launchHidden });
    windowController.registerShortcuts();

    if (!launchHidden) {
      windowController.markVisible();
    }

    if (appState?.windowOpacityLevel == null) {
      windowController.setWindowOpacityLevel(DEFAULT_WINDOW_OPACITY_LEVEL);
    }

    console.log(`Window setup complete (${launchHidden ? 'hidden launch' : 'visible launch'})`);

    setTimeout(() => screenshotManager.warmUp(), 3000);
  });

  app.on('window-all-closed', () => {
    // Keep running in background for stealth operation
  });

  app.on('activate', () => {
    if (!windowController.hasWindow()) {
      windowController.createWindow();
      windowController.markVisible();
    }
  });

  app.on('will-quit', () => {
    cleanupTransientResources();
  });

  app.on('web-contents-created', (_event, contents) => {
    contents.on('new-window', (event) => {
      event.preventDefault();
    });

    contents.on('will-navigate', (event, navigationUrl) => {
      const mainWindow = windowController.getMainWindow();
      if (!mainWindow || mainWindow.isDestroyed()) {
        return;
      }

      if (navigationUrl !== mainWindow.webContents.getURL()) {
        event.preventDefault();
      }
    });
  });

  process.title = 'SystemIdleProcess';
}

module.exports = {
  startApplication
};
