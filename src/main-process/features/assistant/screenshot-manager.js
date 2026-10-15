const screenshot = require('screenshot-desktop');
const { nativeImage, screen } = require('electron');
const { getScreenshotConfig } = require('../../../config');
const { toImageRegion } = require('./capture-region');

function createScreenshotManager({ getMainWindow, getAppEnvironment }) {
  let captureInProgress = false;

  // Returns the primary screen, or one `region` of it, as a base64 JPEG.
  // `region` is in the display's own units, as reported by the selection
  // window. No capture is kept: the library writes a temp file, which it
  // deletes as soon as it is read.
  async function captureScreenJpeg({ region = null } = {}) {
    if (captureInProgress) {
      throw new Error('Screen capture already in progress');
    }

    const mainWindow = getMainWindow();
    const appEnvironment = getAppEnvironment();
    const { maxWidth, jpegQuality } = getScreenshotConfig();

    // With content protection on, the overlay is already excluded from screen
    // capture. Without it, fade the overlay out so it is not in the picture.
    const mustHideWindow = !appEnvironment?.hideFromScreenCapture &&
      mainWindow && !mainWindow.isDestroyed();
    const previousOpacity = mustHideWindow ? mainWindow.getOpacity() : null;

    captureInProgress = true;
    try {
      if (mustHideWindow) {
        mainWindow.setOpacity(0.01);
        await new Promise((resolve) => setTimeout(resolve, appEnvironment?.screenshotDelay || 300));
      }

      const pngBuffer = await screenshot({ format: 'png' });
      let image = nativeImage.createFromBuffer(pngBuffer);
      if (image.isEmpty()) {
        throw new Error('Screen capture returned an empty image');
      }

      if (region) {
        const crop = toImageRegion(region, screen.getPrimaryDisplay().size, image.getSize());
        if (!crop) {
          throw new Error('The selected area is outside the screen');
        }
        image = image.crop(crop);
      }

      if (image.getSize().width > maxWidth) {
        image = image.resize({ width: maxWidth, quality: 'best' });
      }

      return image.toJPEG(jpegQuality).toString('base64');
    } finally {
      captureInProgress = false;
      if (mustHideWindow && !mainWindow.isDestroyed()) {
        mainWindow.setOpacity(previousOpacity);
      }
    }
  }

  // The capture helper is a separate program, and its first run after boot
  // can take seconds while Windows loads it. Listing displays starts the same
  // program without capturing anything, so that cost is paid at launch.
  function warmUp() {
    screenshot.listDisplays().catch((error) => {
      console.warn('Screen capture warm-up failed:', error.message);
    });
  }

  return {
    captureScreenJpeg,
    warmUp
  };
}

module.exports = {
  createScreenshotManager
};
