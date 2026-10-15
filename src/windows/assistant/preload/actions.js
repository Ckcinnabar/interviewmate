const { invokeWithFallback } = require('./helpers');

function createInvokeActions(ipcRenderer) {
  return {
    getSettings: invokeWithFallback(ipcRenderer, {
      channel: 'get-settings',
      label: 'getSettings',
      fallback: (error) => ({ error: error.message })
    }),

    saveSettings: invokeWithFallback(ipcRenderer, {
      channel: 'save-settings',
      label: 'saveSettings',
      fallback: (error) => ({ success: false, error: error.message })
    }),

    setThemePreference: invokeWithFallback(ipcRenderer, {
      channel: 'set-theme-preference',
      label: 'setThemePreference',
      transformArgs: (args) => [{ theme: args[0] }],
      fallback: (error) => ({ success: false, error: error.message })
    }),

    setInterviewLanguage: invokeWithFallback(ipcRenderer, {
      channel: 'set-interview-language',
      label: 'setInterviewLanguage',
      transformArgs: (args) => [{ language: args[0] }],
      fallback: (error) => ({ success: false, error: error.message })
    }),

    setAutoAnswerEnabled: invokeWithFallback(ipcRenderer, {
      channel: 'set-auto-answer-enabled',
      label: 'setAutoAnswerEnabled',
      transformArgs: (args) => [{ enabled: args[0] === true }],
      fallback: (error) => ({ success: false, error: error.message })
    }),

    setMicEnabled: invokeWithFallback(ipcRenderer, {
      channel: 'set-mic-enabled',
      label: 'setMicEnabled',
      transformArgs: (args) => [{ enabled: args[0] === true }],
      fallback: (error) => ({ success: false, error: error.message })
    }),

    startListening: invokeWithFallback(ipcRenderer, {
      channel: 'start-listening',
      label: 'startListening',
      fallback: (error) => ({ success: false, error: error.message })
    }),

    stopListening: invokeWithFallback(ipcRenderer, {
      channel: 'stop-listening',
      label: 'stopListening',
      fallback: (error) => ({ success: false, error: error.message })
    }),

    sendAudioChunk: (audioData) => {
      ipcRenderer.send('audio-chunk', audioData);
    },

    startMic: invokeWithFallback(ipcRenderer, {
      channel: 'start-mic',
      label: 'startMic',
      fallback: (error) => ({ success: false, error: error.message })
    }),

    stopMic: invokeWithFallback(ipcRenderer, {
      channel: 'stop-mic',
      label: 'stopMic',
      fallback: (error) => ({ success: false, error: error.message })
    }),

    sendMicAudioChunk: (audioData) => {
      ipcRenderer.send('mic-audio-chunk', audioData);
    },

    getDesktopSources: invokeWithFallback(ipcRenderer, {
      channel: 'get-desktop-sources',
      label: 'getDesktopSources',
      fallback: () => []
    }),

    setJobDescription: invokeWithFallback(ipcRenderer, {
      channel: 'set-job-description',
      label: 'setJobDescription',
      transformArgs: (args) => [{ text: String(args[0] || '') }],
      fallback: (error) => ({ state: 'error', message: error.message })
    }),

    getJobBrief: invokeWithFallback(ipcRenderer, {
      channel: 'get-job-brief',
      label: 'getJobBrief',
      fallback: () => ({ state: 'empty' })
    }),

    clearSession: invokeWithFallback(ipcRenderer, {
      channel: 'clear-session',
      label: 'clearSession',
      fallback: (error) => ({ success: false, error: error.message })
    }),

    getWindowBounds: invokeWithFallback(ipcRenderer, {
      channel: 'get-window-bounds',
      label: 'getWindowBounds',
      fallback: (error) => ({ error: error.message })
    }),

    setWindowBounds: invokeWithFallback(ipcRenderer, {
      channel: 'set-window-bounds',
      label: 'setWindowBounds',
      fallback: (error) => ({ error: error.message })
    }),

    toggleStealth: invokeWithFallback(ipcRenderer, {
      channel: 'toggle-stealth',
      label: 'toggleStealth',
      fallback: (error) => ({ error: error.message })
    }),

    emergencyHide: invokeWithFallback(ipcRenderer, {
      channel: 'emergency-hide',
      label: 'emergencyHide',
      fallback: (error) => ({ error: error.message })
    }),

    closeApp: invokeWithFallback(ipcRenderer, {
      channel: 'close-app',
      label: 'closeApp',
      fallback: (error) => ({ error: error.message })
    })
  };
}

module.exports = {
  createInvokeActions
};
