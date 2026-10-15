const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('selectionAPI', {
  done: (rect) => ipcRenderer.send('region-select-done', rect),
  cancel: () => ipcRenderer.send('region-select-cancel')
});
