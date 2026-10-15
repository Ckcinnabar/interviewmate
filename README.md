# InterviewMate

InterviewMate is an Electron overlay that helps you answer questions during a live interview. It listens to the interviewer, shows what they said, and streams an answer from Claude into a small always-on-top window that screen sharing does not capture.

Use it only where recording, transcription, screen capture, and AI assistance are allowed.

It started as a fork of [shubhamshnd/Open-Cluely](https://github.com/shubhamshnd/Open-Cluely) and has been trimmed down: Claude replaces Gemini and Ollama, and the notes, insights, suggestion, mobile companion, microphone, and OCR features are removed.

---

## What it does

- **Listens to the interviewer.** System audio is transcribed live with AssemblyAI. The newest sentence is shown on one caption line.
- **Can listen to you too.** Turn on the 麥克風 button and what you say is transcribed as well, so answers continue from what you actually told the interviewer. Correctness still comes first: if you said something wrong, the answer gives the right version with a short phrase for correcting yourself.
- **Answers on a hotkey or automatically.** Press a key to answer what was just said, or turn on Auto and an answer starts as soon as the interviewer finishes a question.
- **Solves what is on the screen.** One key captures the screen and answers the problem on it. Another lets you drag over just the part you want it to look at.
- **English or Chinese, your choice.** The mode steers both transcription and the answer language. Chinese mode answers in Traditional Chinese with Taiwan wording and keeps technical terms in English.
- **Remembers the interview.** Every request carries the whole conversation, including earlier answers, and the model is told to stay consistent with them.
- **Knows your background.** Point it at folders of your own project write-ups and reports, and paste a resume. Experience questions are answered from those records only.
- **Knows the job.** Paste the job description into the 這次面試 box before the interview. Claude reads it once, the box shows the company, the role, and the skills it needs most, and every answer leans on experience that shows those skills.
- **Hidden from screen capture.** The window uses `BrowserWindow.setContentProtection`, so screen sharing and screenshots do not include it.

## The window

```text
+------------------------------------------------+
| * 聆聽中  [中] [Auto] [* 麥克風]     設定   x  |   listening state, language, auto answer, microphone
+------------------------------------------------+
| 面試官  可以說明你怎麼設計 rate limiter？        |   what the interviewer just said
+------------------------------------------------+
| Auto  可以說明你怎麼設計 rate limiter？          |
| 我會用 token bucket，每個 user 一個桶…          |   answers, newest at the bottom
|                           問完後 1.2s 出字      |
+------------------------------------------------+
```

Each answer card shows how long the first word took, so you can see the real latency. A column on the right lists the shortcuts; it is filled from `src/config.js`, so it always matches the keys that are actually registered.

### Checking the transcription

The caption line only shows the latest sentence. The full transcript is open below it when the app starts; click the caption line, or press `Alt+Shift+R`, to close or reopen it. It lists every sentence heard so far with its time, the sentence in progress, and a marker wherever the language mode was switched. Text in it can be selected and copied.

### The job you are interviewing for

The **這次面試** box at the top of the right column starts empty each time the app opens. Paste the job description into it and press **讓 AI 讀**. Claude Haiku reads it in a second or two, and the box then shows the company and the role with three or four skills the role needs most. Press **更換** to edit it or paste another one.

- Every answer gets the full job description and those skills, and is told to lead with the experience that shows them and to use the job description's own terms. It is still told never to claim experience your records do not show.
- The job description is kept in memory only: it is not saved, and closing the app clears it. Clearing the conversation (`Alt+Shift+C`) keeps it.
- If reading it fails, the text stays in the box with the reason, ready to try again; answers still get the job description itself.

To check recognition before an interview, play a recording you know (a past interview, or a video in the language and accent you expect), and compare the transcript with what was said. If Chinese speech comes out as English words or the reverse, the language mode is wrong: switch it with `Alt+Shift+L`.

### Your microphone

The **麥克風** button in the top bar decides whether your own voice is used. When it is lit, your microphone is transcribed whenever listening is on, and its dot turns green while that is happening. The setting is saved.

Choose which microphone in **設定 → 麥克風輸入**: the Windows default, or any connected microphone such as a headset. When recording starts, a notice names the microphone in use. If the chosen one is not connected, the Windows default is used and a notice says so. Changing it while listening switches at once.

To check a microphone before an interview, press **測試** next to the list and speak: five bars, rising left to right like a signal icon, show how loud it hears you. Normal speech should light three to five; if they stay dark, pick another microphone. While testing, choosing another microphone switches the bars to it. The test opens the microphone only until you press **停止** or close Settings.

- What you said goes into the next request, in order with what the interviewer said (`Candidate:` and `Interviewer:` lines). The model continues from what you already said instead of repeating it, and answers follow-ups about your actual words.
- Correctness comes before consistency. If you said something technically wrong, or something that contradicts your experience documents, the answer does not build on it: it gives the correct version and opens with a short phrase you can use to correct yourself.
- Your speech never starts an answer by itself; Auto still waits for the interviewer.
- The full transcript (`Alt+Shift+R`) shows your lines as 「我：…」, so you can check what was picked up.

Things to know:

- **Wear headphones.** Through speakers, the microphone also hears the interviewer. Lines that repeat what the interviewer just said are dropped, but headphones are the reliable fix.
- **Cost.** It is a second AssemblyAI stream, so transcription costs about twice as much while it is on.
- **Windows shows it.** While the microphone is in use, the microphone icon in the taskbar lists this app next to your meeting app.

## Shortcuts

Every shortcut is global, so the overlay never needs focus. Edit them in [`src/config.js`](./src/config.js).

| Shortcut | Action |
|----------|--------|
| `Alt+Shift+A` | Answer what the interviewer just said |
| `Alt+Shift+S` | Capture the screen and solve what is on it |
| `Alt+Shift+D` | Drag over part of the screen and solve only that part (Esc or right-click cancels) |
| `Alt+Shift+T` | Start or stop listening |
| `Alt+Shift+R` | Open or close the full transcript |
| `Alt+Shift+L` | Switch between English and Chinese mode |
| `Alt+Shift+Q` | Turn Auto answer on or off |
| `Alt+Shift+C` | Clear the conversation and start a new interview |
| `Alt+Shift+PageUp` / `PageDown` | Scroll the answers |
| `Alt+Shift+X` | Emergency hide |
| `Alt+Shift+H` | Toggle stealth (nearly transparent) |
| `Alt+Shift+Arrow` | Move the window to an edge |
| `Alt+Shift+1`–`4` | Window size presets |

Pressing `Alt+Shift+A` again with no new speech asks for a refinement of the previous answer. A new request always replaces one that is still streaming.

### Questions about code on a screen

`Alt+Shift+S` sends the capture together with what the interviewer just said, and what they said decides what happens:

- **They asked about something shown** ("what's wrong with this function?", "what does this print?"): the answer addresses that question, names the line or function, and shows only the lines that change.
- **They asked nothing specific**: the screen is treated as the task, for example a problem statement to solve.

This works the same whether the code is in your own editor or in the call window while the interviewer shares their screen, because the capture is of your display. Keep the shared screen large enough to read, and on your primary display: only that display is captured.

If the interviewer asks about on-screen code and you press `Alt+Shift+A` (or Auto answers), the reply is a one-line reminder to press `Alt+Shift+S`, since that request carries no capture.

## Installation

### Requirements

- Windows 10 (version 2004 or later) or Windows 11, which is what hiding a window from capture requires. This is the only platform the fork has been run on.
- Node.js `20.x` and npm `10+`
- .NET Framework, which ships with Windows. The screen capture helper compiles itself with it the first time it runs.
- An Anthropic API key ([platform.claude.com](https://platform.claude.com)); API usage is billed separately from a Claude subscription
- An AssemblyAI API key

### Setup

```powershell
npm ci
Copy-Item .env.example .env
npm start
```

Open **設定** in the window and enter both API keys, your programming language, and optionally your resume. Paste the job description into the 這次面試 box on the right. Do this before the interview (see [While sharing your screen](#while-sharing-your-screen)).

Useful variants:

```powershell
npm run dev            # with Electron logging
npm run start:hidden   # start in the background
npm test               # unit tests
```

## Configuration

### Models and behaviour

[`src/config.js`](./src/config.js) is the single place for:

- `CLAUDE_PROFILES`: which Claude model answers spoken questions (`voice`) and screen problems (`screen`), with their thinking and effort settings. Spoken questions use Claude Haiku 5.5 with thinking off for the fastest first word. Screen problems use Claude Opus 5.5, which always thinks first, so expect a "思考中…" pause.
- `INTERVIEW_LANGUAGES`: the language modes and the AssemblyAI `language_codes` each one sends. Chinese mode sends `zh` and `en` because technical Mandarin is full of English terms; change this line if English words get transcribed badly.
- `AUTO_ANSWER`: how long Auto waits after the interviewer stops, and the minimum gap between automatic answers.
- Programming languages, screenshot size, and keyboard shortcuts.

### Environment variables

| Variable | Notes |
|----------|-------|
| `HIDE_FROM_SCREEN_CAPTURE` | Defaults to `true`. Controls `BrowserWindow.setContentProtection(...)`. |
| `START_HIDDEN` | Defaults to `false`. Also available as `npm run start:hidden` or `--start-hidden`. |
| `SCREENSHOT_DELAY` | Defaults to `300` ms. Only used when `HIDE_FROM_SCREEN_CAPTURE=false`: the window fades out for this long before a screen capture. |
| `NODE_ENV` | Defaults to `production`. `development` opens DevTools. |
| `NODE_OPTIONS` | Defaults to `--max-old-space-size=4096`. |

### Stored data

- Settings, including both API keys and your resume, are stored in plain text in `cache/app-state.json` (next to the repo in development, under the app's user-data folder when packaged). `cache/` is git-ignored.
- Notes made from PDFs in your experience folders are stored in `cache/knowledge/`. The folders themselves are only read, never changed.
- The conversation lives in memory only and is gone when you clear it or close the app.
- Screen captures are not kept. The capture helper writes one temporary file and deletes it as soon as it is read.

## Experience folders

In **設定 → 經歷資料夾**, list one folder per line. Everything under those folders is loaded and sent with every spoken question, so answers about your own work can use your real details.

- `.md`, `.markdown`, and `.txt` files are loaded whole.
- Each PDF is turned into short notes by Claude Opus 5.5, once. The notes add what the PDF contains beyond the text files in the same folder. They are cached in `cache/knowledge/`, keyed by the PDF's content, so a PDF is only processed again if it changes. In one run of seven PDFs (65 pages) this cost $1.25 in total, between $0.07 and $0.25 per file.
- Screen questions do not include these documents; they are coding problems, and leaving the documents out keeps those requests small.

The whole set is kept in the prompt rather than searched: every answer sees all of your records, which is what keeps stories consistent from one question to the next. The Settings panel shows the size in tokens and warns above 80,000. The spoken-question model costs five times more per token once a prompt passes 100,000 tokens, so remove files you do not need if you get close.

Two things to expect:

- **Latency.** A large prompt is slower to answer even when cached. With about 62,000 tokens loaded, the first word took about 1.2 s instead of about 0.6 s. The prompt is cached for an hour and warmed when listening starts.
- **Gaps are not filled in.** If your records do not say what was hard or how a decision was made, the answer says so and leaves a `[bracketed placeholder]`, with a `Note:` line saying what to add. A `Note:` also appears when two of your own documents disagree. The more your write-ups say about problems and decisions, the fewer placeholders you get.

## How answers stay consistent

The main process keeps one conversation per interview ([`src/services/interview/session.js`](./src/services/interview/session.js)). What the interviewer says, and with the microphone on what you say, becomes a user turn; each answer becomes an assistant turn. Every request sends the whole history, so the model sees its own earlier answers, and the system prompt tells it to keep facts, numbers, technology choices, and stories the same, and to correct an earlier mistake openly instead of silently changing it.

An answer that was replaced before it finished is not added to the history. The speech that triggered it is kept and sent with the next request.

## While sharing your screen

Content protection hides the overlay window itself. A few things are separate operating-system windows and are **not** hidden, so avoid them while sharing:

- **Do not type Chinese into the overlay.** The input-method candidate list is its own window. Paste your resume and keys before the interview.
- **Keep `NODE_ENV=production`.** DevTools opens in a window that is not protected.
- **Use the hotkeys, not the mouse.** Clicking the overlay takes focus away from the shared window, and online coding platforms can detect that.

The overlay has no tooltips and no dropdown lists, for the same reason.

Before a real interview, check it yourself: start a meeting alone, share your entire screen, and confirm the overlay is missing from the preview.

## Project structure

```text
src/
  config.js              Models, languages, shortcuts, timing
  bootstrap/             .env loading
  main-process/          Startup, IPC, window control
    features/assistant/  answer-controller (one answer at a time), screen capture
    features/settings/   Settings IPC
    features/window/     Window behaviour and global shortcuts
  services/
    ai/                  Claude streaming service and prompts
    interview/           Conversation memory, auto-answer trigger, Chinese conversion
    knowledge/           Loads experience folders; caches notes made from PDFs
    assembly-ai/         Streaming speech-to-text
    state/               Persisted settings
  windows/assistant/     Overlay window: preload bridge and renderer (display only)
  windows/region-select/ Dimmed full-screen layer for dragging out a region
test/                    Unit tests (`npm test`)
```

File-by-file ownership is in [`notes.md`](./notes.md).

## Build

```powershell
npm run build:win
```

This produces `dist/GoogleChrome.exe`, a portable executable you can run directly. It uses the Chrome icon in `assets/chrome.ico` and shows up as "Google Chrome (2)" in Task Manager. Copy `.env.example` to `.env` before building: the build bundles it. Enter the API keys in the Settings panel on first launch; the packaged app keeps its settings in `%APPDATA%\Google Chrome (2)\cache\`.

## Good practices

- Keep `src/config.js` as the single source of truth for models, languages, and shortcuts.
- Preserve Electron boundaries: renderer code goes through `preload` and IPC.
- Do not add `title` attributes, `<select>` elements, or anything else that opens a native popup; those are visible to screen capture.
- Keep cursor behaviour stealth-safe: controls do not change the pointer shape.
- Keep real keys out of Git.
