const path = require('path');
const dotenv = require('dotenv');

const OPTIONAL_ENV_DEFAULTS = Object.freeze({
  HIDE_FROM_SCREEN_CAPTURE: 'true',
  START_HIDDEN: 'false',
  SCREENSHOT_DELAY: '300',
  NODE_ENV: 'production',
  NODE_OPTIONS: '--max-old-space-size=4096'
});

function getEnvPath(app) {
  return app.isPackaged
    ? path.join(process.resourcesPath, '.env')
    : path.join(__dirname, '..', '..', '.env');
}

function parseBoolean(value, defaultValue) {
  if (value == null || value === '') {
    return defaultValue;
  }

  const normalized = String(value).trim().toLowerCase();

  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }

  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return defaultValue;
}

function parsePositiveInteger(value, defaultValue) {
  const parsedValue = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : defaultValue;
}

// API keys are not read from the environment; they live in app state and are
// edited in the Settings panel.
function normalizeApplicationEnvironment(source = {}) {
  return {
    hideFromScreenCapture: parseBoolean(
      source.HIDE_FROM_SCREEN_CAPTURE ?? source.hideFromScreenCapture,
      parseBoolean(OPTIONAL_ENV_DEFAULTS.HIDE_FROM_SCREEN_CAPTURE, true)
    ),
    startHidden: parseBoolean(
      source.START_HIDDEN ?? source.startHidden,
      parseBoolean(OPTIONAL_ENV_DEFAULTS.START_HIDDEN, false)
    ),
    screenshotDelay: parsePositiveInteger(
      source.SCREENSHOT_DELAY ?? source.screenshotDelay,
      parsePositiveInteger(OPTIONAL_ENV_DEFAULTS.SCREENSHOT_DELAY, 300)
    ),
    nodeEnv: String(source.NODE_ENV || source.nodeEnv || OPTIONAL_ENV_DEFAULTS.NODE_ENV).trim() || OPTIONAL_ENV_DEFAULTS.NODE_ENV,
    nodeOptions: String(source.NODE_OPTIONS || source.nodeOptions || OPTIONAL_ENV_DEFAULTS.NODE_OPTIONS).trim() || OPTIONAL_ENV_DEFAULTS.NODE_OPTIONS
  };
}

function syncProcessEnvironment(environment) {
  process.env.HIDE_FROM_SCREEN_CAPTURE = String(environment.hideFromScreenCapture);
  process.env.START_HIDDEN = String(environment.startHidden);
  process.env.SCREENSHOT_DELAY = String(environment.screenshotDelay);
  process.env.NODE_ENV = environment.nodeEnv;
  process.env.NODE_OPTIONS = environment.nodeOptions;
}

function loadApplicationEnvironment(app) {
  const envPath = getEnvPath(app);
  dotenv.config({ path: envPath });

  const environment = normalizeApplicationEnvironment(process.env);
  syncProcessEnvironment(environment);

  return {
    envPath,
    ...environment
  };
}

module.exports = {
  OPTIONAL_ENV_DEFAULTS,
  getEnvPath,
  loadApplicationEnvironment,
  normalizeApplicationEnvironment
};
