const { isUsableRegion } = require('./capture-region');

const CANCEL_ACCELERATOR = 'Escape';

// Shows the selection window and resolves with the area the user dragged out,
// or null if they cancelled.
function createRegionSelector({
  ipcMain,
  screen,
  globalShortcut,
  createWindow,
  getAppEnvironment
}) {
  let active = null;

  function finish(region) {
    if (!active) {
      return;
    }

    const { window, resolve } = active;
    active = null;

    try {
      globalShortcut.unregister(CANCEL_ACCELERATOR);
    } catch (error) {
      console.warn('Could not release the cancel key:', error.message);
    }

    if (!window.isDestroyed()) {
      window.destroy();
    }

    resolve(region);
  }

  function isFromSelectionWindow(event) {
    return Boolean(active) && !active.window.isDestroyed() && event.sender === active.window.webContents;
  }

  ipcMain.on('region-select-done', (event, rect) => {
    if (!isFromSelectionWindow(event)) {
      return;
    }

    const region = {
      x: Number(rect?.x),
      y: Number(rect?.y),
      width: Number(rect?.width),
      height: Number(rect?.height)
    };
    // A click without a real drag cancels.
    finish(isUsableRegion(region) ? region : null);
  });

  ipcMain.on('region-select-cancel', (event) => {
    if (isFromSelectionWindow(event)) {
      finish(null);
    }
  });

  function select() {
    // The shortcut pressed again while selecting cancels the selection.
    if (active) {
      finish(null);
      return Promise.resolve(null);
    }

    return new Promise((resolve) => {
      const window = createWindow({
        display: screen.getPrimaryDisplay(),
        hideFromScreenCapture: getAppEnvironment()?.hideFromScreenCapture !== false
      });
      active = { window, resolve };

      // The selection window cannot take keyboard focus, so Escape is caught
      // globally for as long as it is open.
      const registered = globalShortcut.register(CANCEL_ACCELERATOR, () => finish(null));
      if (!registered) {
        console.warn('Could not register Escape; cancel a selection with the right mouse button');
      }

      window.on('closed', () => {
        if (active && active.window === window) {
          finish(null);
        }
      });
    });
  }

  return {
    cancel: () => finish(null),
    isSelecting: () => active !== null,
    select
  };
}

module.exports = {
  createRegionSelector
};
