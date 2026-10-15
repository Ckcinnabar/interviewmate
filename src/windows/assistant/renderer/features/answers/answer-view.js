import { renderMarkdown } from './markdown.js';

const TRIGGER_LABELS = {
  manual: '回答',
  auto: 'Auto',
  screen: '螢幕',
  region: '片段'
};

const SCREEN_QUESTION_LABELS = {
  screen: '螢幕上的題目',
  region: '螢幕上選取的範圍'
};

function formatSeconds(milliseconds) {
  return `${(milliseconds / 1000).toFixed(1)}s`;
}

// Renders one card per answer and streams text into it.
export function createAnswerView({ answersElement, emptyHintElement }) {
  const cards = new Map();
  let renderFrame = null;
  const dirtyIds = new Set();

  function updateEmptyHint() {
    emptyHintElement.classList.toggle('hidden', cards.size > 0);
  }

  function renderBody(card) {
    if (card.text) {
      card.bodyElement.innerHTML = renderMarkdown(card.text);
    } else if (card.thinking) {
      card.bodyElement.innerHTML = '<p class="answer-pending">思考中…</p>';
    } else {
      card.bodyElement.innerHTML = '<p class="answer-pending">…</p>';
    }
  }

  // The view does not follow the end of a streaming answer. An answer is read
  // from its first line while it is still being written, and a code answer is
  // longer than the window, so following the end would scroll the approach
  // and the start of the code out of sight.
  function flushDirtyCards() {
    renderFrame = null;

    for (const id of dirtyIds) {
      const card = cards.get(id);
      if (card) {
        renderBody(card);
      }
    }
    dirtyIds.clear();
  }

  // Streaming can deliver many chunks per frame; render at most once per frame.
  function scheduleRender(id) {
    dirtyIds.add(id);
    if (renderFrame === null) {
      renderFrame = window.requestAnimationFrame(flushDirtyCards);
    }
  }

  function start({ id, trigger, question, thinking }) {
    const element = document.createElement('article');
    element.className = 'answer-card streaming';
    element.dataset.answerId = id;

    const headElement = document.createElement('div');
    headElement.className = 'answer-head';

    const tagElement = document.createElement('span');
    tagElement.className = `answer-tag answer-tag-${trigger}`;
    tagElement.textContent = TRIGGER_LABELS[trigger] || TRIGGER_LABELS.manual;

    const questionElement = document.createElement('span');
    questionElement.className = 'answer-question';
    questionElement.textContent = question || SCREEN_QUESTION_LABELS[trigger] || '';

    const bodyElement = document.createElement('div');
    bodyElement.className = 'answer-body';

    const footElement = document.createElement('div');
    footElement.className = 'answer-foot';

    headElement.append(tagElement, questionElement);
    element.append(headElement, bodyElement, footElement);
    answersElement.appendChild(element);

    const card = { element, bodyElement, footElement, text: '', thinking: Boolean(thinking) };
    cards.set(id, card);
    renderBody(card);
    updateEmptyHint();

    // Bring the new answer's first line to the top; the scroll shortcuts move on from there.
    answersElement.scrollTop = element.offsetTop - answersElement.offsetTop;
  }

  function appendChunk({ id, text }) {
    const card = cards.get(id);
    if (!card) {
      return;
    }

    card.text += text;
    scheduleRender(id);
  }

  function end({ id, aborted, error, refused, truncated, ttftMs, totalMs, sinceTurnEndMs }) {
    const card = cards.get(id);
    if (!card) {
      return;
    }

    card.thinking = false;
    card.element.classList.remove('streaming');

    const notes = [];
    if (aborted) {
      card.element.classList.add('superseded');
      notes.push('已被新的問題取代');
    } else if (error) {
      card.element.classList.add('failed');
      if (refused) {
        // A declined answer may have streamed a few words first; drop them.
        card.text = '';
      }
      notes.push(error);
    } else {
      if (typeof sinceTurnEndMs === 'number') {
        notes.push(`問完後 ${formatSeconds(sinceTurnEndMs)} 出字`);
      } else if (typeof ttftMs === 'number') {
        notes.push(`${formatSeconds(ttftMs)} 出字`);
      }
      if (typeof totalMs === 'number') {
        notes.push(`共 ${formatSeconds(totalMs)}`);
      }
      if (truncated) {
        notes.push('答案過長已截斷');
      }
    }

    if (card.text || !(aborted || error)) {
      renderBody(card);
    } else {
      card.bodyElement.innerHTML = '';
    }
    card.footElement.textContent = notes.join(' · ');
  }

  function clear() {
    cards.clear();
    dirtyIds.clear();
    answersElement.querySelectorAll('.answer-card').forEach((element) => element.remove());
    updateEmptyHint();
  }

  function scrollByPage(direction) {
    answersElement.scrollBy({ top: direction * answersElement.clientHeight * 0.8, behavior: 'auto' });
  }

  return {
    appendChunk,
    clear,
    end,
    scrollByPage,
    start
  };
}
