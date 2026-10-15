const MAX_TURNS = 300;

function formatTime(date) {
    return date.toLocaleTimeString('en-GB', { hour12: false });
}

// Keeps everything the interviewer has said and shows it on demand, so the
// transcription can be checked against what was actually said. With the
// microphone on, what the candidate said is listed too, marked "我".
export function createTranscriptView({ captionRow, panelElement, startOpen = false }) {
    const turns = [];
    let liveText = '';
    let open = false;

    function createLine(className, time, text) {
        const line = document.createElement('div');
        line.className = `transcript-line ${className}`.trim();

        if (time) {
            const timeElement = document.createElement('span');
            timeElement.className = 'transcript-time';
            timeElement.textContent = time;
            line.appendChild(timeElement);
        }

        const textElement = document.createElement('span');
        textElement.textContent = text;
        line.appendChild(textElement);
        return line;
    }

    function render() {
        if (!open) {
            return;
        }

        const stickToBottom =
            panelElement.scrollHeight - panelElement.clientHeight - panelElement.scrollTop <= 24;

        panelElement.textContent = '';

        if (turns.length === 0 && !liveText) {
            const empty = document.createElement('div');
            empty.className = 'transcript-empty';
            empty.textContent = '還沒有聽到任何內容。';
            panelElement.appendChild(empty);
            return;
        }

        for (const turn of turns) {
            if (turn.marker) {
                panelElement.appendChild(createLine('transcript-marker', turn.time, turn.text));
            } else if (turn.candidate) {
                panelElement.appendChild(createLine('transcript-candidate', turn.time, `我：${turn.text}`));
            } else {
                panelElement.appendChild(createLine('', turn.time, turn.text));
            }
        }

        if (liveText) {
            panelElement.appendChild(createLine('transcript-live', '…', liveText));
        }

        if (stickToBottom) {
            panelElement.scrollTop = panelElement.scrollHeight;
        }
    }

    function push(turn) {
        turns.push(turn);
        if (turns.length > MAX_TURNS) {
            turns.shift();
        }
    }

    function addCaption({ text, final }) {
        const value = String(text || '').trim();
        if (!value) {
            return;
        }

        if (final) {
            liveText = '';
            push({ time: formatTime(new Date()), text: value });
        } else {
            liveText = value;
        }

        render();
    }

    // A final line from the candidate's microphone. A formatted final replaces
    // the unformatted one of the same turn.
    function addCandidateLine({ text, turnKey }) {
        const value = String(text || '').trim();
        if (!value) {
            return;
        }

        // The interviewer may have spoken in between, so look a few lines back.
        const sameTurn = turnKey == null
            ? null
            : turns.slice(-5).reverse().find((turn) => turn.candidate && turn.turnKey === turnKey);
        if (sameTurn) {
            sameTurn.text = value;
        } else {
            push({ time: formatTime(new Date()), text: value, candidate: true, turnKey });
        }

        render();
    }

    // A line that is not speech, such as a language switch.
    function addMarker(text) {
        push({ time: formatTime(new Date()), text, marker: true });
        render();
    }

    function setOpen(nextOpen) {
        open = Boolean(nextOpen);
        panelElement.classList.toggle('hidden', !open);
        captionRow.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (open) {
            render();
            panelElement.scrollTop = panelElement.scrollHeight;
        }
    }

    function toggle() {
        setOpen(!open);
    }

    function clear() {
        turns.length = 0;
        liveText = '';
        render();
    }

    captionRow.addEventListener('click', toggle);
    if (startOpen) {
        setOpen(true);
    }

    return {
        addCandidateLine,
        addCaption,
        addMarker,
        clear,
        isOpen: () => open,
        toggle
    };
}
