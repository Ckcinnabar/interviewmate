// Starts and stops capture of one audio source and its transcription stream.
// The app uses two: the interviewer's audio (system audio) and the
// candidate's microphone. The main process owns each transcription stream;
// this module only feeds it PCM.
//
// `openStream` returns the MediaStream to capture; `startStream` and
// `stopStream` open and close the transcription stream in the main process.
export function createListeningController({
  audioPipeline,
  openStream,
  startStream,
  stopStream,
  onStateChange,
  onError
}) {
  let audioContext = null;
  let mediaStream = null;
  let processor = null;
  let capturing = false;
  let state = 'off';
  let lastSttStatus = 'stopped';
  // Bumped by every start and stop, so a start that is still connecting can
  // tell that it was cancelled.
  let generation = 0;

  function setState(nextState) {
    if (state === nextState) {
      return;
    }

    state = nextState;
    onStateChange?.(state);
  }

  function teardownCapture() {
    capturing = false;
    audioPipeline.stopAudioResources(audioContext, mediaStream, processor);
    audioContext = null;
    mediaStream = null;
    processor = null;
    audioPipeline.resetSampleQueue();
  }

  async function start() {
    if (state !== 'off') {
      return;
    }

    generation += 1;
    const startGeneration = generation;
    const cancelled = () => startGeneration !== generation;
    setState('connecting');

    try {
      const stream = await openStream();
      if (cancelled()) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      mediaStream = stream;

      const result = await startStream();
      if (cancelled()) {
        return;
      }
      if (!result?.success) {
        throw new Error(result?.error || '無法開始語音轉錄');
      }

      const context = new AudioContext();
      audioContext = context;
      await context.resume();
      if (cancelled()) {
        return;
      }
      audioPipeline.resetSampleQueue();
      capturing = true;
      const nextProcessor = await audioPipeline.buildAudioProcessor(context, mediaStream, () => capturing);
      if (cancelled()) {
        nextProcessor.disconnect();
        return;
      }
      processor = nextProcessor;

      // The stream may have reported "listening" before capture was ready.
      if (lastSttStatus === 'listening') {
        setState('listening');
      }
    } catch (error) {
      if (cancelled()) {
        return;
      }

      console.error('Failed to start listening:', error);
      teardownCapture();
      try {
        await stopStream();
      } catch (_) {
        // no-op
      }
      setState('off');
      onError?.(error.message);
    }
  }

  async function stop() {
    if (state === 'off') {
      return;
    }

    generation += 1;
    audioPipeline.drainSampleQueue({ flushPartial: true });
    teardownCapture();
    setState('off');
    try {
      await stopStream();
    } catch (error) {
      console.error('Failed to stop listening:', error);
    }
  }

  function toggle() {
    return state === 'off' ? start() : stop();
  }

  function handleSttStatus({ status, message } = {}) {
    lastSttStatus = status;

    if (status === 'listening') {
      if (capturing) {
        setState('listening');
      }
      return;
    }

    if (status === 'connecting') {
      if (state !== 'off') {
        setState('connecting');
      }
      return;
    }

    // "stopped" or "error": the stream is gone, so capture stops too.
    if (state !== 'off') {
      generation += 1;
      teardownCapture();
      setState('off');
    }

    if (status === 'error' && message) {
      onError?.(message);
    }
  }

  return {
    getState: () => state,
    handleSttStatus,
    start,
    stop,
    toggle
  };
}
