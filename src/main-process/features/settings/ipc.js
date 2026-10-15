const {
  getClaudeProfile,
  getDefaultProgrammingLanguage,
  getInterviewLanguages,
  getKeyboardShortcuts,
  getProgrammingLanguages,
  resolveInterviewLanguage,
  resolveProgrammingLanguage
} = require('../../../config');

function registerSettingsIpc({
  ipcMain,
  getAppEnvironment,
  getAppState,
  updateAppState,
  windowController,
  setInterviewLanguage,
  setAutoAnswerEnabled,
  setMicEnabled,
  getKnowledgeStatus,
  refreshKnowledge
}) {
  ipcMain.handle('get-settings', () => {
    const appEnvironment = getAppEnvironment();
    const appState = getAppState();
    const anthropicApiKey = appState?.anthropicApiKey || '';
    const assemblyAiApiKey = appState?.assemblyAiApiKey || '';

    return {
      anthropicApiKey,
      assemblyAiApiKey,
      hasAnthropicApiKey: anthropicApiKey.length > 0,
      hasAssemblyAiApiKey: assemblyAiApiKey.length > 0,
      interviewLanguage: resolveInterviewLanguage(appState?.interviewLanguage),
      interviewLanguages: getInterviewLanguages().map(({ id, label }) => ({ id, label })),
      autoAnswerEnabled: appState?.autoAnswerEnabled === true,
      micEnabled: appState?.micEnabled === true,
      micDeviceId: appState?.micDeviceId || '',
      micDeviceLabel: appState?.micDeviceLabel || '',
      programmingLanguage: resolveProgrammingLanguage(appState?.programmingLanguage),
      programmingLanguages: getProgrammingLanguages(),
      defaultProgrammingLanguage: getDefaultProgrammingLanguage(),
      candidateResume: appState?.candidateResume || '',
      knowledgeFolders: appState?.knowledgeFolders || [],
      knowledgeStatus: getKnowledgeStatus(),
      voiceModel: getClaudeProfile('voice').model,
      screenModel: getClaudeProfile('screen').model,
      keyboardShortcuts: getKeyboardShortcuts(),
      hideFromScreenCapture: appEnvironment?.hideFromScreenCapture !== false,
      windowOpacityLevel: windowController.getWindowOpacityLevel(),
      themePreference: appState?.themePreference === 'light' ? 'light' : 'dark'
    };
  });

  ipcMain.handle('save-settings', async (_event, settings = {}) => {
    try {
      const nextWindowOpacityLevel = windowController.setWindowOpacityLevel(settings.windowOpacityLevel);

      updateAppState({
        anthropicApiKey: String(settings.anthropicApiKey || '').trim(),
        assemblyAiApiKey: String(settings.assemblyAiApiKey || '').trim(),
        programmingLanguage: resolveProgrammingLanguage(settings.programmingLanguage),
        micDeviceId: String(settings.micDeviceId || ''),
        micDeviceLabel: String(settings.micDeviceLabel || ''),
        candidateResume: String(settings.candidateResume || ''),
        knowledgeFolders: Array.isArray(settings.knowledgeFolders) ? settings.knowledgeFolders : [],
        windowOpacityLevel: nextWindowOpacityLevel
      });

      // Reload in the background: new folders, or a newly added API key that
      // lets pending PDFs be processed. Progress goes out as `knowledge-status`.
      refreshKnowledge();

      return { success: true };
    } catch (error) {
      console.error('Error saving settings:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('set-theme-preference', (_event, payload = {}) => {
    try {
      const themePreference = payload?.theme === 'light' ? 'light' : 'dark';
      updateAppState({ themePreference });
      return { success: true, themePreference };
    } catch (error) {
      console.error('Error saving theme preference:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('set-interview-language', (_event, payload = {}) => {
    return setInterviewLanguage(payload?.language);
  });

  ipcMain.handle('set-auto-answer-enabled', (_event, payload = {}) => {
    return setAutoAnswerEnabled(payload?.enabled === true);
  });

  ipcMain.handle('set-mic-enabled', (_event, payload = {}) => {
    return setMicEnabled(payload?.enabled === true);
  });
}

module.exports = {
  registerSettingsIpc
};
