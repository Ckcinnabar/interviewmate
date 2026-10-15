const path = require('path');
const { BrowserWindow } = require('electron');

// A see-through window over the whole primary display, on which the user
// drags out the area to capture.
function createRegionSelectWindow({ display, hideFromScreenCapture }) {
  const { x, y, width, height } = display.bounds;

  const selectWindow = new BrowserWindow({
    x,
    y,
    width,
    height,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    // Not focusable: the window underneath keeps focus while the mouse drags
    // here, so a shared browser tab never sees itself lose focus.
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    hasShadow: false,
    type: 'toolbar',
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // Above the assistant window, so an area behind it can be selected too.
  selectWindow.setAlwaysOnTop(true, 'screen-saver');
  // Hidden from screen sharing, like the assistant window.
  selectWindow.setContentProtection(hideFromScreenCapture);
  selectWindow.loadFile(path.join(__dirname, 'select.html'));
  selectWindow.once('ready-to-show', () => {
    if (!selectWindow.isDestroyed()) {
      selectWindow.showInactive();
    }
  });

  return selectWindow;
}

module.exports = {
  createRegionSelectWindow
};
