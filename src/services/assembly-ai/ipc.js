function registerAssemblyAiIpc({ ipcMain, assemblyAiService, micService }) {
  ipcMain.handle('start-listening', () => {
    return assemblyAiService.start();
  });

  ipcMain.handle('stop-listening', () => {
    return assemblyAiService.stop();
  });

  ipcMain.on('audio-chunk', (_event, data) => {
    assemblyAiService.handleAudioChunk(data);
  });

  ipcMain.handle('get-desktop-sources', async () => {
    return assemblyAiService.getDesktopSources();
  });

  // The candidate's microphone has a stream of its own.
  ipcMain.handle('start-mic', () => {
    return micService.start();
  });

  ipcMain.handle('stop-mic', () => {
    return micService.stop();
  });

  ipcMain.on('mic-audio-chunk', (_event, data) => {
    micService.handleAudioChunk(data);
  });
}

module.exports = {
  registerAssemblyAiIpc
};
