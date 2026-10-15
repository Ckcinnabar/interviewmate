// A five-bar level meter, like a phone's signal icon, for checking that a
// microphone picks up your voice before relying on it.
//
// The microphone is opened with the same processing as real recording, so
// the bars show what transcription would receive.

const UPDATE_MS = 50;
// Each bar lights at this loudness (dBFS). Room noise stays below the first;
// normal speech reaches the third to fifth.
const BAR_THRESHOLDS_DB = [-50, -42, -34, -26, -18];
// How much of the previous level is kept each update, so bars fall smoothly.
const DECAY = 0.8;

export function levelToBars(rms) {
    if (!(rms > 0)) {
        return 0;
    }

    const db = 20 * Math.log10(rms);
    return BAR_THRESHOLDS_DB.filter((threshold) => db >= threshold).length;
}

export function createMicLevelMeter({ meterElement, openMicrophone, onError }) {
    const bars = [...meterElement.children];
    let stream = null;
    let context = null;
    let timer = null;
    let level = 0;
    let running = false;
    // Bumped by every start and stop, so a start that is still opening the
    // microphone can tell it was replaced.
    let generation = 0;

    function paint(count) {
        bars.forEach((bar, index) => bar.classList.toggle('on', index < count));
    }

    function stop() {
        generation += 1;
        running = false;
        clearInterval(timer);
        timer = null;
        stream?.getTracks().forEach((track) => track.stop());
        stream = null;
        context?.close().catch(() => {});
        context = null;
        level = 0;
        paint(0);
    }

    // `deviceId` '' is the Windows default.
    async function start(deviceId) {
        stop();
        const startGeneration = generation;
        running = true;

        try {
            const nextStream = await openMicrophone(deviceId);
            if (startGeneration !== generation) {
                nextStream.getTracks().forEach((track) => track.stop());
                return;
            }

            stream = nextStream;
            context = new AudioContext();
            const analyser = context.createAnalyser();
            analyser.fftSize = 1024;
            context.createMediaStreamSource(stream).connect(analyser);
            const samples = new Float32Array(analyser.fftSize);

            timer = setInterval(() => {
                analyser.getFloatTimeDomainData(samples);
                let sum = 0;
                for (const sample of samples) {
                    sum += sample * sample;
                }
                level = Math.max(Math.sqrt(sum / samples.length), level * DECAY);
                paint(levelToBars(level));
            }, UPDATE_MS);
        } catch (error) {
            if (startGeneration === generation) {
                stop();
                onError?.(error);
            }
        }
    }

    return {
        isRunning: () => running,
        start,
        stop
    };
}
