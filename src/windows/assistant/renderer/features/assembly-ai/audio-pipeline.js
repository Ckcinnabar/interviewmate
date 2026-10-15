const TARGET_SAMPLE_RATE = 16000;
const TARGET_FRAME_MS = 100;
const MIN_FRAME_MS = 50;
const TARGET_FRAME_SAMPLES = Math.round((TARGET_SAMPLE_RATE * TARGET_FRAME_MS) / 1000);
const MIN_FRAME_SAMPLES = Math.round((TARGET_SAMPLE_RATE * MIN_FRAME_MS) / 1000);
const WORKLET_MODULE_PATH = 'pcm-capture-worklet.js';

// Captures one audio source (system audio or the microphone), downsamples it
// to 16 kHz mono PCM16, and hands it to `sendAudioChunk` in 100 ms frames.
// Each source needs its own pipeline, because the frame queue is per pipeline.
export function createAudioPipeline({ sendAudioChunk }) {
  const workletLoadedContexts = new WeakSet();
  let sampleQueue = { chunks: [], length: 0 };

  function convertToPCM16(float32Data) {
    const int16Data = new Int16Array(float32Data.length);
    for (let index = 0; index < float32Data.length; index += 1) {
      const sample = Math.max(-1, Math.min(1, float32Data[index]));
      int16Data[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    }
    return int16Data;
  }

  function downsampleFloat32Buffer(input, inputSampleRate, outputSampleRate = TARGET_SAMPLE_RATE) {
    if (inputSampleRate <= 0 || outputSampleRate <= 0 || input.length === 0) {
      return input;
    }

    if (inputSampleRate === outputSampleRate) {
      return input;
    }

    const sampleRateRatio = inputSampleRate / outputSampleRate;
    const newLength = Math.max(1, Math.round(input.length / sampleRateRatio));
    const result = new Float32Array(newLength);
    let offsetResult = 0;
    let offsetInput = 0;

    while (offsetResult < result.length) {
      const nextOffsetInput = Math.min(input.length, Math.round((offsetResult + 1) * sampleRateRatio));
      let accum = 0;
      let count = 0;

      for (let index = offsetInput; index < nextOffsetInput; index += 1) {
        accum += input[index];
        count += 1;
      }

      result[offsetResult] = count > 0 ? accum / count : 0;
      offsetResult += 1;
      offsetInput = nextOffsetInput;
    }

    return result;
  }

  async function ensureWorkletModule(context) {
    if (workletLoadedContexts.has(context)) {
      return;
    }

    await context.audioWorklet.addModule(WORKLET_MODULE_PATH);
    workletLoadedContexts.add(context);
  }

  function isLikelyCameraTrack(trackLabel) {
    const label = String(trackLabel || '').toLowerCase();
    return label.includes('camera') || label.includes('webcam');
  }

  async function getSystemAudioStream(sourceId) {
    const mandatoryConstraints = {
      audio: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: sourceId
        }
      },
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: sourceId
        }
      }
    };

    const flatConstraints = {
      audio: { chromeMediaSource: 'desktop', chromeMediaSourceId: sourceId },
      video: { chromeMediaSource: 'desktop', chromeMediaSourceId: sourceId }
    };

    try {
      return await navigator.mediaDevices.getUserMedia(mandatoryConstraints);
    } catch (_mandatoryError) {
      console.log('Mandatory desktop constraints failed; trying flat syntax');
      return navigator.mediaDevices.getUserMedia(flatConstraints);
    }
  }

  // The interviewer's side: the audio of the first screen source.
  async function openSystemAudioStream(getDesktopSources) {
    const sources = await getDesktopSources();
    if (!sources || sources.length === 0) {
      throw new Error('找不到可擷取的系統音訊來源');
    }

    const stream = await getSystemAudioStream(sources[0].id);
    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack && isLikelyCameraTrack(videoTrack.label)) {
      stream.getTracks().forEach((track) => track.stop());
      throw new Error(`系統音訊擷取誤用了攝影機來源（${videoTrack.label || 'unknown'}）`);
    }

    stream.getVideoTracks().forEach((track) => track.stop());
    return stream;
  }

  // The candidate's side: the chosen microphone ('' for the Windows default),
  // cleaned up the way a call app would clean it up.
  function openMicrophoneStream(deviceId = '') {
    return navigator.mediaDevices.getUserMedia({
      audio: {
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      },
      video: false
    });
  }

  function resetSampleQueue() {
    sampleQueue = { chunks: [], length: 0 };
  }

  function appendSamples(samples) {
    if (!samples || samples.length === 0) {
      return;
    }

    sampleQueue.chunks.push(samples);
    sampleQueue.length += samples.length;
  }

  function pullSamples(count) {
    const output = new Float32Array(count);
    let written = 0;

    while (written < count && sampleQueue.chunks.length > 0) {
      const first = sampleQueue.chunks[0];
      const take = Math.min(first.length, count - written);
      output.set(first.subarray(0, take), written);
      written += take;

      if (take === first.length) {
        sampleQueue.chunks.shift();
      } else {
        sampleQueue.chunks[0] = first.subarray(take);
      }

      sampleQueue.length -= take;
    }

    if (written === count) {
      return output;
    }

    return output.subarray(0, written);
  }

  function sendPcmFrame(floatSamples) {
    if (!floatSamples || floatSamples.length < MIN_FRAME_SAMPLES) {
      return;
    }

    sendAudioChunk(convertToPCM16(floatSamples).buffer);
  }

  function drainSampleQueue({ flushPartial = false } = {}) {
    while (sampleQueue.length >= TARGET_FRAME_SAMPLES) {
      sendPcmFrame(pullSamples(TARGET_FRAME_SAMPLES));
    }

    if (flushPartial && sampleQueue.length >= MIN_FRAME_SAMPLES) {
      sendPcmFrame(pullSamples(sampleQueue.length));
    }
  }

  async function buildAudioProcessor(context, stream, activeCheck) {
    await ensureWorkletModule(context);

    const src = context.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(context, 'pcm-capture-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1]
    });

    const silentGain = context.createGain();
    silentGain.gain.value = 0;

    node.port.onmessage = (event) => {
      if (!activeCheck()) {
        return;
      }

      try {
        const chunk = event.data instanceof Float32Array ? event.data : new Float32Array(event.data || []);
        appendSamples(downsampleFloat32Buffer(chunk, context.sampleRate, TARGET_SAMPLE_RATE));
        drainSampleQueue();
      } catch (error) {
        console.error('Audio processing failed:', error);
      }
    };

    src.connect(node);
    node.connect(silentGain);
    silentGain.connect(context.destination);

    return {
      disconnect: () => {
        try {
          node.port.onmessage = null;
        } catch (_) {
          // no-op
        }
        try {
          src.disconnect();
        } catch (_) {
          // no-op
        }
        try {
          node.disconnect();
        } catch (_) {
          // no-op
        }
        try {
          silentGain.disconnect();
        } catch (_) {
          // no-op
        }
      }
    };
  }

  function stopAudioResources(context, stream, processor) {
    try {
      processor?.disconnect();
    } catch (_) {
      // no-op
    }

    try {
      context?.close();
    } catch (_) {
      // no-op
    }

    stream?.getTracks().forEach((track) => track.stop());
  }

  return {
    buildAudioProcessor,
    drainSampleQueue,
    openMicrophoneStream,
    openSystemAudioStream,
    resetSampleQueue,
    stopAudioResources
  };
}
