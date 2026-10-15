function logStartupConfiguration({
  appEnvironment,
  appState,
  interviewLanguage,
  voiceModel,
  screenModel,
  speechModel
}) {
  console.log('Loaded .env from:', appEnvironment.envPath);
  console.log('Startup configuration:');
  console.log(`  Anthropic API key (UI state): ${appState?.anthropicApiKey ? 'present' : 'missing'}`);
  console.log(`  AssemblyAI API key (UI state): ${appState?.assemblyAiApiKey ? 'present' : 'missing'}`);
  console.log(`  HIDE_FROM_SCREEN_CAPTURE: ${appEnvironment.hideFromScreenCapture}`);
  console.log(`  SCREENSHOT_DELAY: ${appEnvironment.screenshotDelay}`);
  console.log(`  NODE_ENV: ${appEnvironment.nodeEnv}`);
  console.log(`  NODE_OPTIONS: ${appEnvironment.nodeOptions}`);
  console.log(`  Interview language: ${interviewLanguage}`);
  console.log(`  Auto answer: ${appState?.autoAnswerEnabled === true}`);
  console.log(`  Microphone: ${appState?.micEnabled === true}`);
  console.log(`  Claude model (spoken questions): ${voiceModel}`);
  console.log(`  Claude model (screen problems): ${screenModel}`);
  console.log(`  AssemblyAI speech model: ${speechModel}`);
}

module.exports = {
  logStartupConfiguration
};
