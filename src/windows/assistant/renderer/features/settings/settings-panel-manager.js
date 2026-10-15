import { findMicDevice, listMicDevices } from './mic-devices.js';
import { createMicLevelMeter } from './mic-level-meter.js';

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function normalizeWindowOpacityLevel(value) {
    const parsedValue = Number.parseInt(String(value ?? ''), 10);
    return Number.isFinite(parsedValue) ? clamp(parsedValue, 1, 10) : 10;
}

export function createSettingsPanelManager({
    settingsPanel,
    settingAnthropicKey,
    settingAssemblyKey,
    settingProgrammingLanguages,
    settingMicDevices,
    settingMicNote,
    settingMicMeter,
    settingMicTest,
    openMicrophone,
    settingResume,
    settingKnowledgeFolders,
    settingKnowledgeStatus,
    settingWindowOpacity,
    settingWindowOpacityValue,
    settingLightTheme,
    settingModelInfo,
    applySettingsShortcutConfig,
    showNotice,
    onThemeChange,
    onSettingsSaved
}) {
    let selectedProgrammingLanguage = '';
    // { id, label }; id '' is the Windows default.
    let selectedMic = { id: '', label: '' };
    let micMissing = false;
    let micListRequest = 0;

    const micMeter = createMicLevelMeter({
        meterElement: settingMicMeter,
        openMicrophone,
        onError: (error) => {
            settingMicNote.textContent = `無法開啟這支麥克風：${error.message || error.name}`;
            paintMicTestButton();
        }
    });

    function paintMicTestButton() {
        const testing = micMeter.isRunning();
        settingMicTest.textContent = testing ? '停止' : '測試';
        settingMicTest.classList.toggle('selected', testing);
        settingMicTest.setAttribute('aria-pressed', testing ? 'true' : 'false');
    }

    // The device that would actually be recorded: the Windows default when
    // the saved one is not connected.
    function effectiveMicId() {
        return micMissing ? '' : selectedMic.id;
    }

    function toggleMicTest() {
        if (micMeter.isRunning()) {
            micMeter.stop();
        } else {
            settingMicNote.textContent = '';
            micMeter.start(effectiveMicId());
        }
        paintMicTestButton();
    }

    function updateWindowOpacityValueLabel(value) {
        if (settingWindowOpacityValue) {
            settingWindowOpacityValue.textContent = `${normalizeWindowOpacityLevel(value)}/10`;
        }
    }

    function paintProgrammingLanguageSelection() {
        settingProgrammingLanguages.querySelectorAll('.choice-chip').forEach((chip) => {
            const selected = chip.dataset.language === selectedProgrammingLanguage;
            chip.classList.toggle('selected', selected);
            chip.setAttribute('aria-pressed', selected ? 'true' : 'false');
        });
    }

    // Buttons instead of a <select>: a dropdown list is a separate OS window,
    // which screen capture can still see.
    function renderProgrammingLanguages(languages, selectedLanguage) {
        const configuredLanguages = Array.isArray(languages) ? languages : [];
        selectedProgrammingLanguage = configuredLanguages.includes(selectedLanguage)
            ? selectedLanguage
            : (configuredLanguages[0] || '');

        settingProgrammingLanguages.innerHTML = '';
        configuredLanguages.forEach((languageName) => {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'choice-chip';
            chip.dataset.language = languageName;
            chip.textContent = languageName;
            chip.addEventListener('click', () => {
                selectedProgrammingLanguage = languageName;
                paintProgrammingLanguageSelection();
            });
            settingProgrammingLanguages.appendChild(chip);
        });

        paintProgrammingLanguageSelection();
    }

    // The saved device is not connected: the Windows default is used instead,
    // so that is the one shown as selected until another is picked.
    function paintMicSelection() {
        const effectiveId = effectiveMicId();
        settingMicDevices.querySelectorAll('.choice-chip').forEach((chip) => {
            const selected = chip.dataset.deviceId === effectiveId;
            chip.classList.toggle('selected', selected);
            chip.setAttribute('aria-pressed', selected ? 'true' : 'false');
        });
    }

    function renderMicChips(options) {
        settingMicDevices.innerHTML = '';
        options.forEach((option) => {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'choice-chip';
            chip.dataset.deviceId = option.id;
            chip.textContent = option.label;
            chip.addEventListener('click', () => {
                selectedMic = { id: option.id, label: option.id ? option.label : '' };
                micMissing = false;
                settingMicNote.textContent = '';
                paintMicSelection();
                // While testing, the bars follow the newly chosen microphone.
                if (micMeter.isRunning()) {
                    micMeter.start(option.id);
                }
            });
            settingMicDevices.appendChild(chip);
        });

        paintMicSelection();
    }

    // One button per microphone, the Windows default first. Listing devices
    // can take a moment the first time, so the default button is shown at once
    // and the rest are added when the list arrives.
    async function renderMicDevices(savedId, savedLabel) {
        selectedMic = { id: savedId || '', label: savedLabel || '' };
        micMissing = false;
        settingMicNote.textContent = '';
        micListRequest += 1;
        const request = micListRequest;
        renderMicChips([{ id: '', label: 'Windows 預設' }]);
        // Right after launch, Windows can take a few seconds to list devices.
        settingMicNote.textContent = '正在讀取麥克風清單…';

        let list = { defaultLabel: '', devices: [] };
        try {
            list = await listMicDevices();
            if (request === micListRequest) {
                settingMicNote.textContent = '';
            }
        } catch (error) {
            console.error('Failed to list microphones:', error);
            settingMicNote.textContent = '讀不到麥克風清單。';
        }

        // The panel was reopened while this list was loading.
        if (request !== micListRequest) {
            return;
        }

        const { device, missing } = findMicDevice(list.devices, selectedMic);
        if (device) {
            selectedMic = { id: device.id, label: device.label };
        } else if (missing) {
            micMissing = true;
            settingMicNote.textContent = `之前選的「${selectedMic.label || '麥克風'}」目前沒有連接，會先用 Windows 預設。`;
        }

        renderMicChips([
            { id: '', label: list.defaultLabel ? `Windows 預設（${list.defaultLabel}）` : 'Windows 預設' },
            ...list.devices
        ]);
    }

    function parseFolders(value) {
        return String(value || '')
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean);
    }

    function describeKnowledgeStatus(status) {
        if (!status || status.folders === 0) {
            const missing = status?.errors?.length ? status.errors.join('；') : '';
            return missing || '尚未設定資料夾。';
        }

        const pdfProgress = status.pdfFiles > 0 ? `、PDF ${status.pdfReady}/${status.pdfFiles}` : '';
        const lines = [];

        if (status.state === 'loading') {
            lines.push(`載入中：${status.textFiles} 份文字檔${pdfProgress}，正在整理 PDF…`);
        } else {
            const size = typeof status.tokens === 'number'
                ? `，約 ${status.tokens.toLocaleString('en-US')} tokens`
                : '';
            lines.push(`已載入 ${status.textFiles} 份文字檔${pdfProgress}${size}。`);
        }

        if (status.overBudget) {
            lines.push('內容偏多，接近 100,000 tokens 時費用會變成五倍，建議移掉用不到的檔案。');
        }

        lines.push(...(status.errors || []));
        return lines.join('\n');
    }

    function renderKnowledgeStatus(status) {
        settingKnowledgeStatus.textContent = describeKnowledgeStatus(status);
    }

    async function openSettings() {
        try {
            const settings = await window.electronAPI.getSettings();
            if (settings && !settings.error) {
                applySettingsShortcutConfig?.(settings);
                settingAnthropicKey.value = settings.anthropicApiKey || '';
                settingAssemblyKey.value = settings.assemblyAiApiKey || '';
                renderProgrammingLanguages(settings.programmingLanguages, settings.programmingLanguage);
                renderMicDevices(settings.micDeviceId, settings.micDeviceLabel);
                settingResume.value = settings.candidateResume || '';
                settingKnowledgeFolders.value = (settings.knowledgeFolders || []).join('\n');
                renderKnowledgeStatus(settings.knowledgeStatus);
                settingWindowOpacity.value = normalizeWindowOpacityLevel(settings.windowOpacityLevel);
                updateWindowOpacityValueLabel(settings.windowOpacityLevel);
                settingLightTheme.checked = settings.themePreference === 'light';
                settingModelInfo.textContent =
                    `口頭題：${settings.voiceModel}　螢幕題：${settings.screenModel}`;
            }
        } catch (error) {
            console.error('Failed to load settings:', error);
        }

        settingsPanel.classList.remove('hidden');
    }

    function closeSettings() {
        micMeter.stop();
        paintMicTestButton();
        settingsPanel.classList.add('hidden');
    }

    function isOpen() {
        return !settingsPanel.classList.contains('hidden');
    }

    async function saveSettings() {
        const settings = {
            anthropicApiKey: settingAnthropicKey.value.trim(),
            assemblyAiApiKey: settingAssemblyKey.value.trim(),
            programmingLanguage: selectedProgrammingLanguage,
            micDeviceId: selectedMic.id,
            micDeviceLabel: selectedMic.label,
            candidateResume: settingResume.value,
            knowledgeFolders: parseFolders(settingKnowledgeFolders.value),
            windowOpacityLevel: normalizeWindowOpacityLevel(settingWindowOpacity.value)
        };

        const result = await window.electronAPI.saveSettings(settings);
        if (!result?.success) {
            showNotice?.(`儲存失敗：${result?.error || '未知錯誤'}`, 'error');
            return;
        }

        showNotice?.('設定已儲存', 'success');
        onSettingsSaved?.(settings);
        closeSettings();
    }

    settingMicTest.addEventListener('click', toggleMicTest);

    settingWindowOpacity.addEventListener('input', () => {
        updateWindowOpacityValueLabel(settingWindowOpacity.value);
    });

    settingLightTheme.addEventListener('change', () => {
        onThemeChange?.(settingLightTheme.checked ? 'light' : 'dark');
    });

    return {
        closeSettings,
        isOpen,
        openSettings,
        renderKnowledgeStatus,
        saveSettings
    };
}
