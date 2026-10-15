function registerAssistantIpc({
  ipcMain,
  windowController,
  jobBriefController,
  clearSession,
  quitApplication
}) {
  ipcMain.handle('get-window-bounds', () => {
    return windowController.getWindowBounds();
  });

  ipcMain.handle('set-window-bounds', (_event, nextBounds) => {
    return windowController.setWindowBounds(nextBounds);
  });

  ipcMain.handle('toggle-stealth', () => {
    return windowController.toggleStealthMode();
  });

  ipcMain.handle('emergency-hide', () => {
    return windowController.emergencyHide();
  });

  // The "這次面試" box: paste a job description (empty text clears it).
  ipcMain.handle('set-job-description', (_event, payload = {}) => {
    return jobBriefController.setJobDescription(payload?.text);
  });

  ipcMain.handle('get-job-brief', () => {
    return jobBriefController.getStatus();
  });

  ipcMain.handle('clear-session', () => {
    clearSession();
    return { success: true };
  });

  ipcMain.handle('close-app', () => {
    setTimeout(() => {
      quitApplication();
    }, 0);

    return { success: true };
  });
}

module.exports = {
  registerAssistantIpc
};
