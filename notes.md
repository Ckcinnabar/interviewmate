# InterviewMate Codebase Structure

This is the architecture and file-ownership map for the repository.

## 1) Runtime Architecture

The main process owns the interview: the conversation, the decision to answer, and the calls to Claude. The renderer only captures audio and displays what it is sent.

```text
system audio -> renderer captures PCM -> main process -> AssemblyAI
                                           | transcript (converted to Traditional in Chinese mode)
                                           +-> session        (conversation memory)
                                           +-> auto-trigger   (question detection)
                                           +-> echo filter    (remembers what the interviewer said)
                                           +-> renderer: caption
microphone   -> renderer captures PCM -> main process -> second AssemblyAI stream (only while the mic button is on)
                                           | finals that are not an echo of the interviewer
                                           +-> session        (the candidate's words, context only)
                                           +-> renderer: transcript line
hotkey / auto-trigger -> answer-controller -> Claude stream -> renderer: answer card
```

1. **Main process boot**
   - `src/main.js` calls `startApplication()` in `src/main-process/start-application.js`.
2. **Environment + state**
   - `.env` holds runtime flags only, loaded by `src/bootstrap/environment.js`.
   - Settings (API keys, language mode, auto answer, microphone, programming language, resume, opacity, theme) are loaded from `cache/app-state.json` by `src/services/state/app-state.js`.
3. **Main-process composition**
   - `start-application.js` wires the session, Claude service, auto-answer trigger, AssemblyAI service, answer controller, screenshot manager, window controller, and IPC.
4. **Preload bridge**
   - `src/windows/assistant/preload.js` exposes `window.electronAPI`, built from `preload/actions.js` (invokes) and `preload/listeners.js` (events).
5. **Renderer**
   - `renderer.html` + `styles.css` + `renderer.js`, with feature modules under `renderer/features/`.

## 2) `src/` File Ownership

### `src/config.js`
- Single source of truth for Claude profiles (`voice`, `screen`), the AssemblyAI speech model, interview languages and their `language_codes`, programming languages, auto-answer timing, screenshot size, session size limit, and keyboard shortcuts.

### `src/bootstrap/environment.js`
- Resolves the `.env` path (dev vs packaged), loads it, and normalizes the runtime flags. API keys are not read from the environment.

### `src/main-process/`

#### `start-application.js`
- Composition root. Creates every service, connects transcription turns to the session, the auto-answer trigger, and the caption, defines the shortcut actions, and registers IPC and app lifecycle hooks.

#### `startup-logging.js`
- Logs the startup configuration (key presence, language, models).

#### `shared/safe-send.js`
- Safe wrapper for `webContents.send`.

#### `features/window/window-constants.js`, `window-controller.js`
- Window size and opacity limits; window creation, opacity, stealth toggle, emergency hide, bounds, recovery reload, and global shortcut registration. Shortcuts call the `actions` passed in by `start-application.js`.

#### `features/assistant/answer-controller.js`
- Runs one answer at a time. A new request aborts the previous stream. Builds the turn from the session, picks the Claude profile (`screen` for screen requests, `voice` otherwise), streams text to the renderer as `answer-start` / `answer-chunk` / `answer-end`, measures time to first text, and commits the answer to the session only if it finished and was not superseded.

#### `features/assistant/knowledge-controller.js`
- Keeps the experience documents ready to send: reloads them from the configured folders, reports progress as `knowledge-status`, counts the prompt's tokens, and warms the prompt cache when listening starts. `getPrompt(profile)` returns the `{ knowledge, instructions }` pair for a request; profiles with `includeKnowledge: false` get no documents.

#### `features/assistant/screenshot-manager.js`, `capture-region.js`
- `captureScreenJpeg({ region })` returns the primary screen, or only `region` when one is given, as a downscaled base64 JPEG. `capture-region.js` converts a region from window coordinates to screenshot pixels. `warmUp()` starts the capture helper once at launch so the first real capture is not slow.

#### `features/assistant/region-selector.js`
- Opens the selection layer from `src/windows/region-select/` and resolves with the dragged region, or `null` when cancelled with Esc, a right-click, or a click without dragging.

#### `features/assistant/job-brief-controller.js`
- Holds the job description pasted in the overlay, in memory only. `setJobDescription` reads it with the `jobBrief` profile (Haiku, a forced `record_job` tool call) into company, role, and skills, reports `job-brief` states (`empty`, `loading`, `ready`, `error`), and drops replies for an older text. `getPromptParts()` feeds the system prompt.

#### `features/assistant/ipc.js`
- Window bounds, stealth, emergency hide, clear session, close app.

#### `features/settings/ipc.js`
- `get-settings`, `save-settings`, `set-theme-preference`, `set-interview-language`, `set-auto-answer-enabled`.

### `src/services/`

#### `ai/claude-service.js`
- Streaming wrapper around the Anthropic Messages API: builds the request from a profile (model, thinking, effort, optional server-side fallback), caches the system prompt and the conversation, forwards text deltas, and reports refusals and truncation. The system prompt is two blocks cached for an hour: the experience documents first, then the instructions, so a language switch reuses the documents' cache entry. Also `prewarm` (writes the cache with `max_tokens: 0`), `countSystemTokens`, and `digestPdf`. `describeClaudeError` maps SDK error classes to user messages.

#### `ai/prompts.js`
- `buildSystemPrompt` (depends only on settings and the pasted job description, so it stays identical across requests and is cacheable): how the conversation works, the consistency rule, reply shapes, programming language, response language, the candidate's resume, and, once a job description is pasted, a role section with it and the skills read from it.
- `buildJobBriefPrompt`: instructions for reading a job description into company, role, and 3–4 skills.
- `buildApiMessages` turns session turns into Messages API `messages`, including the image block for screen turns. A turn that includes the candidate's own words labels every line `Candidate:` or `Interviewer:`; other turns are the interviewer's speech as plain text.

#### `interview/session.js`
- Conversation memory. Collects interviewer speech as pending, turns it into a user turn when an answer is requested, and records the user and assistant turns when the answer is committed. Handles partials that were sent before their turn finished, duplicate finals, replacing a screen capture with a note once it has been answered, and trimming very long histories. With the microphone on, the candidate's finals are pending too; every segment has a sequence number, and a user turn's `exchange` lists both speakers in the order they spoke.

#### `interview/echo-filter.js`
- Drops a microphone line when most of its word pairs (character pairs in Chinese) match what the interviewer said in the last 20 seconds: that is the interviewer heard through the speakers.

#### `interview/auto-trigger.js`
- `looksLikeQuestion` (English and Chinese cues) and a debounced trigger that fires once the interviewer has finished a question.

#### `knowledge/knowledge-base.js`
- Walks the experience folders in a fixed order (the order of documents in the prompt must not change between runs, or the prompt cache misses). Text files are read as they are. Each PDF is turned into notes once through `digestPdf`, given the text files from the same folder so the notes only add what those leave out; notes are cached in `cache/knowledge/` keyed by the PDF's content and a notes version.

#### `interview/chinese-script.js`
- Simplified to Traditional (Taiwan phrasing) conversion with `opencc-js`.

#### `assembly-ai/service.js`, `assembly-ai/ipc.js`
- One WebSocket stream to AssemblyAI per audio source. `start-application.js` creates two: system audio (status on `stt-status`) and the microphone (status on `mic-status`). Each sends `language_codes` for the current interview language, reports each turn through `onTurn`, and can `restart()` when the language changes. IPC: `start-listening`, `stop-listening`, `audio-chunk`, `get-desktop-sources`, and `start-mic`, `stop-mic`, `mic-audio-chunk`.

#### `state/app-state.js`
- Reads, sanitizes, and writes `cache/app-state.json`.

### `src/windows/assistant/`

#### `window.js`
- BrowserWindow creation: transparent, always on top, skipped in the taskbar, content protection.

#### `preload.js`, `preload/*`
- `window.electronAPI`: invoke wrappers in `actions.js`, event subscriptions in `listeners.js`, helpers in `helpers.js`.

#### `renderer.html`, `styles.css`
- Top bar (listening state, language, Auto, microphone, settings, close), caption line, answers list, settings panel. No `title` attributes and no `<select>` elements, because native tooltips and dropdown lists are separate OS windows that screen capture can see.

#### `renderer.js`
- Composition root for the display layer: wires buttons, subscribes to main-process events, and paints state. Runs the microphone exactly while listening is on and the mic button is on.

#### `renderer/features/answers/`
- `answer-view.js`: one card per answer, streamed text, latency footer, superseded and failed states.
- `markdown.js`: small HTML-escaping markdown renderer.

#### `renderer/features/transcription/transcription-manager.js`
- Starts and stops capture of one audio source and its transcription stream, and tracks its state. Used twice: system audio and the microphone. A stop during connecting cancels the start.

#### `renderer/features/transcription/transcript-view.js`
- Keeps every sentence heard (up to 300), the candidate's own lines marked 「我」, and shows them in a panel opened from the caption row or with a shortcut, for checking the transcription.

#### `renderer/features/assembly-ai/audio-pipeline.js`, `pcm-capture-worklet.js`
- WebAudio capture, downsampling to 16 kHz PCM16, and 100 ms framing. `openSystemAudioStream` and `openMicrophoneStream` open the two sources; each source has its own pipeline.

#### `renderer/features/job-brief/job-brief-view.js`
- The 這次面試 box above the shortcuts: a text box to paste the job description, then the company, role, and skills, with 更換 to edit it.

#### `renderer/features/settings/`
- `settings-panel-manager.js`: load, edit, and save settings.
- `mic-devices.js`: lists the connected microphones and finds the saved one (by id, then by label); used by the settings panel and when the microphone is opened.
- `shortcut-manager.js`: renders the read-only shortcut list.

#### `renderer/features/layout/window-adjustments.js`
- Window resize handles.

### `src/windows/region-select/`
- The selection layer for `Alt+Shift+D`: a transparent, content-protected window over the whole screen. `select.js` draws the rectangle and reports it through `preload.js`.

## 3) Tests

`npm test` runs `node --test test`. Tests cover the session, the auto-answer trigger, the echo filter, prompts, the Claude service (with a fake client), the answer controller, and config and app-state sanitizing. Modules take their dependencies as arguments so they can be tested without Electron or the network.

## 4) Where Things Go

- Models, languages, timing, shortcuts: `src/config.js`.
- Anything about what is said to Claude: `src/services/ai/prompts.js`.
- Anything about what the conversation remembers: `src/services/interview/session.js`.
- New main-to-renderer events: add the channel in `preload/listeners.js` and handle it in `renderer.js`.
- New renderer-to-main calls: add the wrapper in `preload/actions.js` and the handler in the matching `ipc.js`.
