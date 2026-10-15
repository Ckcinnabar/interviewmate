const { toTraditionalChinese } = require('../interview/chinese-script');

const ASSEMBLY_AI_SAMPLE_RATE = 16000;

// Streams one audio source to AssemblyAI and reports each transcribed turn
// through `onTurn`. The app runs two: the interviewer's audio (system audio)
// and, when it is switched on, the candidate's microphone. Each reports its
// connection state on its own `statusChannel`.
function createAssemblyAiService({
  WebSocket,
  desktopCapturer,
  label = 'system audio',
  statusChannel = 'stt-status',
  getApiKey,
  getSpeechModel,
  getLanguageConfig,
  onStreamStart,
  onTurn,
  sendToRenderer
}) {
  let socket = null;
  let isStreaming = false;
  let chunkCount = 0;
  let droppedChunkCount = 0;

  function sendStatus(status, message = '') {
    sendToRenderer(statusChannel, { status, message });
  }

  function isActive() {
    return socket !== null;
  }

  function closeSocket(ws) {
    if (!ws) return;
    try {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'Terminate' }));
      }
      ws.terminate();
    } catch (error) {
      console.error('Error closing AssemblyAI WebSocket:', error);
    }
  }

  function buildStreamUrl(languageConfig) {
    const queryParams = new URLSearchParams({
      sample_rate: String(ASSEMBLY_AI_SAMPLE_RATE),
      format_turns: 'true',
      speech_model: getSpeechModel()
    });

    // Steers recognition toward the interview language.
    for (const languageCode of languageConfig.sttLanguageCodes) {
      queryParams.append('language_codes', languageCode);
    }

    return `wss://streaming.assemblyai.com/v3/ws?${queryParams.toString()}`;
  }

  function handleTurnMessage(msg, languageConfig) {
    const rawText = typeof msg.transcript === 'string' ? msg.transcript : '';
    const text = languageConfig.convertToTraditional ? toTraditionalChinese(rawText) : rawText;
    const final = Boolean(msg.end_of_turn);

    // Empty finals are still reported so a stale partial gets cleared.
    if (!text && !final) {
      return;
    }

    onTurn({ text, final, turnOrder: msg.turn_order });
  }

  function start() {
    const apiKey = String(getApiKey() || '').trim();
    if (!apiKey) {
      return { success: false, error: '尚未設定 AssemblyAI API key，請到設定頁填入。' };
    }

    if (isActive()) {
      return { success: true };
    }

    try {
      const languageConfig = getLanguageConfig();
      const ws = new WebSocket(buildStreamUrl(languageConfig), {
        headers: { Authorization: apiKey }
      });

      socket = ws;
      isStreaming = false;
      // What the server said before closing this connection, if anything.
      let serverError = '';
      chunkCount = 0;
      droppedChunkCount = 0;
      sendStatus('connecting');
      console.log(
        `Connecting to AssemblyAI for ${label} (${getSpeechModel()}, languages: ${languageConfig.sttLanguageCodes.join(',')})`
      );

      // Every handler checks that it still belongs to the current socket, so a
      // late event from a replaced connection cannot tear down the new one.
      ws.on('open', () => {
        if (socket !== ws) return;
        isStreaming = true;
        if (typeof onStreamStart === 'function') {
          onStreamStart();
        }
      });

      ws.on('message', (rawMessage) => {
        if (socket !== ws) return;

        let msg;
        try {
          msg = JSON.parse(rawMessage.toString());
        } catch (parseError) {
          console.error('Failed to parse AssemblyAI message:', parseError);
          return;
        }

        switch (msg.type) {
          case 'Begin':
            console.log(`AssemblyAI session started (${label}):`, msg.id);
            sendStatus('listening');
            break;

          case 'Turn':
            handleTurnMessage(msg, languageConfig);
            break;

          case 'Termination':
            console.log(`AssemblyAI terminated (${label}). Duration:`, msg.audio_duration_seconds, 's');
            socket = null;
            isStreaming = false;
            sendStatus('stopped');
            break;

          case 'Error':
            serverError = String(msg.error || msg.message || '').trim();
            console.error(`AssemblyAI error (${label}):`, serverError || JSON.stringify(msg));
            break;

          default:
            console.log('AssemblyAI message:', msg.type);
        }
      });

      ws.on('error', (error) => {
        if (socket !== ws) return;
        console.error(`AssemblyAI WebSocket error (${label}):`, error.message);
        socket = null;
        isStreaming = false;
        sendStatus('error', `語音轉錄連線錯誤：${error.message}`);
      });

      // Closing our own stream clears `socket` first, so a close that gets
      // here came from the server: say why, instead of stopping silently.
      ws.on('close', (code, reason) => {
        if (socket !== ws) return;
        const detail = serverError || reason?.toString() || '';
        console.log(`AssemblyAI WebSocket closed (${label}):`, code, detail);
        socket = null;
        isStreaming = false;
        sendStatus('error', `語音轉錄連線中斷（${code}${detail ? `：${detail}` : ''}）`);
      });

      return { success: true };
    } catch (error) {
      console.error('Error starting AssemblyAI stream:', error.message);
      socket = null;
      isStreaming = false;
      return { success: false, error: error.message };
    }
  }

  function stop({ silent = false } = {}) {
    const ws = socket;
    socket = null;
    isStreaming = false;
    closeSocket(ws);

    if (!silent) {
      sendStatus('stopped');
    }

    return { success: true };
  }

  // Reconnects with the current language settings. The renderer keeps
  // capturing audio; chunks sent while reconnecting are dropped.
  function restart() {
    if (!isActive()) {
      return { success: true };
    }

    stop({ silent: true });
    return start();
  }

  function handleAudioChunk(data) {
    if (socket && isStreaming && socket.readyState === WebSocket.OPEN) {
      socket.send(Buffer.from(data));
      chunkCount += 1;
      return;
    }

    droppedChunkCount += 1;
    if (droppedChunkCount % 100 === 0) {
      console.warn(`Dropped ${droppedChunkCount} ${label} chunks (sent ${chunkCount}); stream not open`);
    }
  }

  async function getDesktopSources() {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen'] });
      return sources.map((source) => ({ id: source.id, name: source.name }));
    } catch (error) {
      console.error('Error getting desktop sources:', error.message);
      return [];
    }
  }

  function dispose() {
    stop({ silent: true });
  }

  return {
    dispose,
    getDesktopSources,
    handleAudioChunk,
    isActive,
    restart,
    start,
    stop
  };
}

module.exports = {
  createAssemblyAiService
};
