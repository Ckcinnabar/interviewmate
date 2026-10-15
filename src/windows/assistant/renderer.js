import { createAnswerView } from './renderer/features/answers/answer-view.js';
import { createAudioPipeline } from './renderer/features/assembly-ai/audio-pipeline.js';
import { createJobBriefView } from './renderer/features/job-brief/job-brief-view.js';
import { createWindowAdjustmentManager } from './renderer/features/layout/window-adjustments.js';
import { createSettingsPanelManager } from './renderer/features/settings/settings-panel-manager.js';
import { createShortcutManager } from './renderer/features/settings/shortcut-manager.js';
import { renderShortcutSidebar } from './renderer/features/settings/shortcut-sidebar.js';
import { listMicDevices, resolveMicDeviceId } from './renderer/features/settings/mic-devices.js';
import { createListeningController } from './renderer/features/transcription/transcription-manager.js';
import { createTranscriptView } from './renderer/features/transcription/transcript-view.js';

// Display layer only. The main process owns the conversation, decides when to
// answer, and streams answers here; this file shows them.

const MIN_WINDOW_WIDTH = 600;
const MIN_WINDOW_HEIGHT = 380;
const NOTICE_DURATION_MS = 4000;
const CLOSE_CONFIRM_MS = 3000;

const LISTEN_LABELS = {
    off: '未聆聽',
    connecting: '連線中',
    listening: '聆聽中'
};

const listenBtn = document.getElementById('listen-btn');
const listenLabel = document.getElementById('listen-label');
const languageBtn = document.getElementById('language-btn');
const autoBtn = document.getElementById('auto-btn');
const micBtn = document.getElementById('mic-btn');
const noticeElement = document.getElementById('notice');
const settingsBtn = document.getElementById('settings-btn');
const closeBtn = document.getElementById('close-btn');
const captionText = document.getElementById('caption-text');
const answersElement = document.getElementById('answers');
const emptyHintElement = document.getElementById('empty-hint');
const hintAnswer = document.getElementById('hint-answer');
const hintScreen = document.getElementById('hint-screen');
const shortcutSidebar = document.getElementById('shortcut-sidebar');
const emergencyOverlay = document.getElementById('emergency-overlay');
const closeSettingsBtn = document.getElementById('close-settings-btn');
const saveSettingsBtn = document.getElementById('save-settings-btn');

let interviewLanguage = 'en';
let interviewLanguages = [];
let autoAnswerEnabled = false;
let micEnabled = false;
// Set when the microphone failed to start, so it is not retried on every
// listening change. Cleared by the mic button or by stopping listening.
let micBlocked = false;
// The microphone chosen in Settings; id '' is the Windows default.
let micDeviceChoice = { id: '', label: '' };
let knowledgeState = 'idle';
let noticeTimer = null;
let closeConfirmTimer = null;

const answerView = createAnswerView({ answersElement, emptyHintElement });

// The job description box above the shortcuts.
const jobBriefView = createJobBriefView({
    element: document.getElementById('job-brief'),
    submit: (text) => window.electronAPI.setJobDescription(text)
});

const transcriptView = createTranscriptView({
    captionRow: document.getElementById('caption-row'),
    panelElement: document.getElementById('transcript-panel'),
    // Open from the start, so what was heard can be checked at a glance.
    startOpen: true
});

const systemAudioPipeline = createAudioPipeline({
    sendAudioChunk: (audioBuffer) => {
        window.electronAPI.sendAudioChunk(audioBuffer);
    }
});

const micAudioPipeline = createAudioPipeline({
    sendAudioChunk: (audioBuffer) => {
        window.electronAPI.sendMicAudioChunk(audioBuffer);
    }
});

// The interviewer, heard through the system audio.
const listeningController = createListeningController({
    audioPipeline: systemAudioPipeline,
    openStream: () => systemAudioPipeline.openSystemAudioStream(() => window.electronAPI.getDesktopSources()),
    startStream: () => window.electronAPI.startListening(),
    stopStream: () => window.electronAPI.stopListening(),
    onStateChange: (state) => {
        paintListeningState(state);
        if (state === 'off') {
            micBlocked = false;
        }
        syncMicCapture();
    },
    onError: (message) => showNotice(message, 'error')
});

// The candidate, heard through their microphone. It only runs while
// listening, and only when the mic button is on.
const micController = createListeningController({
    audioPipeline: micAudioPipeline,
    openStream: () => openChosenMicrophone(),
    startStream: () => window.electronAPI.startMic(),
    stopStream: () => window.electronAPI.stopMic(),
    onStateChange: () => paintMic(),
    onError: (message) => {
        micBlocked = true;
        showNotice(`麥克風：${message}`, 'error');
    }
});

// Opens the microphone chosen in Settings, or the Windows default when that
// one is not connected, and says which one is being used.
async function openChosenMicrophone() {
    const { deviceId, missing } = await resolveMicDeviceId(micDeviceChoice);
    const stream = await micAudioPipeline.openMicrophoneStream(deviceId);
    const label = stream.getAudioTracks()[0]?.label || '';

    if (missing) {
        showNotice(`找不到「${micDeviceChoice.label}」，改用 Windows 預設麥克風`, 'error');
    } else if (label) {
        showNotice(`麥克風收音：${label}`, 'info');
    }

    return stream;
}

const shortcutManager = createShortcutManager({
    settingsShortcutsList: document.getElementById('settings-shortcuts-list')
});

const settingsPanelManager = createSettingsPanelManager({
    settingsPanel: document.getElementById('settings-panel'),
    settingAnthropicKey: document.getElementById('setting-anthropic-key'),
    settingAssemblyKey: document.getElementById('setting-assembly-key'),
    settingProgrammingLanguages: document.getElementById('setting-programming-languages'),
    settingMicDevices: document.getElementById('setting-mic-devices'),
    settingMicNote: document.getElementById('setting-mic-note'),
    settingMicMeter: document.getElementById('setting-mic-meter'),
    settingMicTest: document.getElementById('setting-mic-test'),
    openMicrophone: (deviceId) => micAudioPipeline.openMicrophoneStream(deviceId),
    settingResume: document.getElementById('setting-resume'),
    settingKnowledgeFolders: document.getElementById('setting-knowledge-folders'),
    settingKnowledgeStatus: document.getElementById('setting-knowledge-status'),
    settingWindowOpacity: document.getElementById('setting-window-opacity'),
    settingWindowOpacityValue: document.getElementById('setting-window-opacity-value'),
    settingLightTheme: document.getElementById('setting-light-theme'),
    settingModelInfo: document.getElementById('setting-model-info'),
    applySettingsShortcutConfig: (settings) => applyShortcutConfig(settings),
    showNotice: (message, type) => showNotice(message, type),
    onThemeChange: (theme) => {
        applyTheme(theme);
        window.electronAPI.setThemePreference(theme);
    },
    onSettingsSaved: (settings) => {
        const previousId = micDeviceChoice.id;
        micDeviceChoice = { id: settings.micDeviceId || '', label: settings.micDeviceLabel || '' };
        if (micDeviceChoice.id !== previousId) {
            switchMicrophone();
        }
    }
});

// A different microphone was chosen: if one is being recorded, reopen it.
async function switchMicrophone() {
    micBlocked = false;
    if (micController.getState() !== 'off') {
        await micController.stop();
    }
    syncMicCapture();
}

const windowAdjustmentManager = createWindowAdjustmentManager({
    windowResizeHandles: document.querySelectorAll('[data-resize-handle]'),
    chatContainer: answersElement,
    minWindowWidth: MIN_WINDOW_WIDTH,
    minWindowHeight: MIN_WINDOW_HEIGHT
});

function showNotice(message, type = 'info') {
    noticeElement.textContent = message || '';
    noticeElement.className = `notice ${type}`;

    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => {
        noticeElement.textContent = '';
        noticeElement.className = 'notice';
    }, NOTICE_DURATION_MS);
}

function applyTheme(theme) {
    document.body.classList.toggle('theme-light', theme === 'light');
}

function paintListeningState(state) {
    listenBtn.classList.toggle('connecting', state === 'connecting');
    listenBtn.classList.toggle('listening', state === 'listening');
    listenLabel.textContent = LISTEN_LABELS[state] || LISTEN_LABELS.off;
}

function paintInterviewLanguage() {
    const language = interviewLanguages.find((entry) => entry.id === interviewLanguage);
    languageBtn.textContent = language ? language.label : interviewLanguage.toUpperCase();
}

function paintAutoAnswer() {
    autoBtn.classList.toggle('active', autoAnswerEnabled);
    autoBtn.setAttribute('aria-pressed', autoAnswerEnabled ? 'true' : 'false');
}

function paintMic() {
    const state = micController.getState();
    micBtn.classList.toggle('active', micEnabled);
    micBtn.classList.toggle('connecting', state === 'connecting');
    micBtn.classList.toggle('listening', state === 'listening');
    micBtn.setAttribute('aria-pressed', micEnabled ? 'true' : 'false');
}

// The microphone is captured exactly while listening is on and the mic
// button is on.
function syncMicCapture() {
    const wanted = micEnabled && !micBlocked && listeningController.getState() !== 'off';
    const running = micController.getState() !== 'off';

    if (wanted && !running) {
        micController.start();
    } else if (!wanted && running) {
        micController.stop();
    }
}

function applyShortcutConfig(settings) {
    shortcutManager.applySettingsShortcutConfig(settings);

    const shortcuts = Array.isArray(settings?.keyboardShortcuts) ? settings.keyboardShortcuts : [];
    renderShortcutSidebar(shortcutSidebar, shortcuts);
    const acceleratorFor = (id) => shortcuts.find((shortcut) => shortcut.id === id)?.accelerator;
    hintAnswer.textContent = acceleratorFor('answer') || hintAnswer.textContent;
    hintScreen.textContent = acceleratorFor('answerScreen') || hintScreen.textContent;
}

function showCaption({ text, final }) {
    const value = String(text || '').trim();
    if (!value) {
        return;
    }

    captionText.textContent = value;
    captionText.classList.remove('caption-empty');
    captionText.classList.toggle('caption-live', !final);
    // Keep the newest words in view when the line overflows.
    captionText.scrollLeft = captionText.scrollWidth;

    transcriptView.addCaption({ text: value, final });
}

function nextInterviewLanguage() {
    const index = interviewLanguages.findIndex((entry) => entry.id === interviewLanguage);
    const next = interviewLanguages[(index + 1) % interviewLanguages.length];
    return next ? next.id : interviewLanguage;
}

function showEmergencyOverlay() {
    emergencyOverlay.classList.remove('hidden');
    setTimeout(() => {
        emergencyOverlay.classList.add('hidden');
    }, 2000);
}

// Two clicks to close, so a stray click mid-interview does not end the session.
function handleCloseClick() {
    if (closeBtn.classList.contains('confirming')) {
        Promise.allSettled([micController.stop(), listeningController.stop()])
            .finally(() => window.electronAPI.closeApp());
        return;
    }

    closeBtn.classList.add('confirming');
    closeBtn.textContent = '確定關閉？';
    clearTimeout(closeConfirmTimer);
    closeConfirmTimer = setTimeout(() => {
        closeBtn.classList.remove('confirming');
        closeBtn.innerHTML = '&times;';
    }, CLOSE_CONFIRM_MS);
}

function setupEventListeners() {
    listenBtn.addEventListener('click', () => listeningController.toggle());
    languageBtn.addEventListener('click', () => window.electronAPI.setInterviewLanguage(nextInterviewLanguage()));
    autoBtn.addEventListener('click', () => window.electronAPI.setAutoAnswerEnabled(!autoAnswerEnabled));
    micBtn.addEventListener('click', () => window.electronAPI.setMicEnabled(!micEnabled));
    settingsBtn.addEventListener('click', () => settingsPanelManager.openSettings());
    closeSettingsBtn.addEventListener('click', () => settingsPanelManager.closeSettings());
    saveSettingsBtn.addEventListener('click', () => settingsPanelManager.saveSettings());
    closeBtn.addEventListener('click', handleCloseClick);

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && settingsPanelManager.isOpen()) {
            event.preventDefault();
            settingsPanelManager.closeSettings();
        }
    });

    document.addEventListener('contextmenu', (event) => event.preventDefault());
    document.addEventListener('dragstart', (event) => event.preventDefault());
}

function setupIpcListeners() {
    const api = window.electronAPI;

    api.onSttStatus((data) => listeningController.handleSttStatus(data));
    api.onMicStatus((data) => micController.handleSttStatus(data));
    api.onCaption((data) => showCaption(data || {}));
    api.onCandidateCaption((data) => transcriptView.addCandidateLine(data || {}));

    api.onAnswerStart((data) => answerView.start(data));
    api.onAnswerChunk((data) => answerView.appendChunk(data));
    api.onAnswerEnd((data) => answerView.end(data));
    api.onAnswerNotice((data) => showNotice(data?.message, 'error'));

    api.onSessionCleared(() => {
        answerView.clear();
        transcriptView.clear();
        captionText.textContent = '';
        showNotice('已清空，開始新的一場', 'success');
    });

    api.onJobBrief((status) => jobBriefView.update(status));

    api.onKnowledgeStatus((status) => {
        settingsPanelManager.renderKnowledgeStatus(status);

        // Say so once when a load finishes; progress stays in the settings panel.
        if (knowledgeState === 'loading' && status?.state === 'ready') {
            const failed = status.pdfFailed > 0 ? `，${status.pdfFailed} 份 PDF 失敗` : '';
            showNotice(`經歷資料已載入${failed}`, status.pdfFailed > 0 ? 'error' : 'success');
        }
        knowledgeState = status?.state || 'idle';
    });

    api.onInterviewLanguageChanged((data) => {
        const previousLanguage = interviewLanguage;
        interviewLanguage = data?.interviewLanguage || interviewLanguage;
        paintInterviewLanguage();
        showNotice(interviewLanguage === 'zh' ? '中文模式' : 'English mode', 'info');

        // Recognition depends on the mode, so the transcript records the switch.
        if (interviewLanguage !== previousLanguage) {
            transcriptView.addMarker(interviewLanguage === 'zh' ? '切換為中文模式' : '切換為英文模式');
        }
    });

    api.onAutoAnswerChanged((data) => {
        autoAnswerEnabled = data?.autoAnswerEnabled === true;
        paintAutoAnswer();
        showNotice(autoAnswerEnabled ? '自動回答：開' : '自動回答：關', 'info');
    });

    api.onMicEnabledChanged((data) => {
        micEnabled = data?.micEnabled === true;
        micBlocked = false;
        paintMic();
        showNotice(micEnabled ? '麥克風：開（建議戴耳機）' : '麥克風：關', 'info');
        syncMicCapture();
    });

    api.onToggleListening(() => listeningController.toggle());
    api.onToggleTranscript(() => transcriptView.toggle());
    api.onScrollAnswer((data) => answerView.scrollByPage(data?.direction === -1 ? -1 : 1));
    api.onSetStealthMode((enabled) => showNotice(enabled ? 'Stealth：開' : 'Stealth：關', 'info'));
    api.onEmergencyClear(() => showEmergencyOverlay());
}

async function init() {
    if (typeof window.electronAPI === 'undefined') {
        console.error('electronAPI not available');
        showNotice('electronAPI 無法使用', 'error');
        return;
    }

    setupEventListeners();
    setupIpcListeners();
    windowAdjustmentManager.setupWindowAdjustments();

    const settings = await window.electronAPI.getSettings();
    if (settings && !settings.error) {
        interviewLanguage = settings.interviewLanguage;
        interviewLanguages = settings.interviewLanguages || [];
        autoAnswerEnabled = settings.autoAnswerEnabled === true;
        micEnabled = settings.micEnabled === true;
        micDeviceChoice = { id: settings.micDeviceId || '', label: settings.micDeviceLabel || '' };
        applyTheme(settings.themePreference);
        applyShortcutConfig(settings);

        if (!settings.hasAnthropicApiKey || !settings.hasAssemblyAiApiKey) {
            showNotice('請先到「設定」填入 API key', 'error');
        }
    }

    paintInterviewLanguage();
    jobBriefView.update(await window.electronAPI.getJobBrief());
    paintAutoAnswer();
    paintMic();
    paintListeningState(listeningController.getState());

    document.body.style.visibility = 'visible';
    console.log('Renderer initialized');

    // The first device listing takes a few seconds; doing it now makes the
    // microphone list in Settings appear at once. Listing opens no device.
    listMicDevices().catch(() => {});
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
