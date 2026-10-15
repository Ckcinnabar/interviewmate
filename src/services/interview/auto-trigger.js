// Decides when the interviewer has finished asking something, so an answer can
// start without the candidate pressing a key.

// Used when the transcript has no question mark to go on.
const ENGLISH_QUESTION_CUES = /\b(what|why|how|can you|could you|would you|do you|did you|have you|are you|is there|are there|tell me|talk about|walk me through|explain|describe|compare|give me|design|implement)\b/i;
const ENGLISH_LEADING_CUES = /^(when|where|which|who|whose)\b/i;
// Traditional forms first, then the Simplified forms a transcript may still carry.
const CHINESE_QUESTION_CUES = /[嗎呢吗]|什麼|甚麼|怎麼|怎樣|如何|為什麼|為何|哪些|哪個|哪裡|哪一|幾個|幾種|多少|多久|是否|是不是|能不能|可不可以|會不會|有沒有|請你|請問|說說|談談|講講|聊聊|介紹|解釋|說明|描述|分享|比較|設計|實作|寫一個|寫出|什么|怎么|怎样|为什么|为何|哪个|哪里|几个|几种|会不会|有没有|请你|请问|说说|谈谈|讲讲|介绍|解释|说明|比较|设计|实现|写一个|写出/;

const MIN_ENGLISH_WORDS = 4;
const MIN_CHINESE_CHARS = 6;

function looksLikeQuestion(text) {
  const value = String(text || '').trim();
  if (!value) {
    return false;
  }

  const chineseChars = (value.match(/\p{Script=Han}/gu) || []).length;
  const englishWords = (value.match(/[A-Za-z][A-Za-z'-]*/g) || []).length;
  const longEnough = chineseChars >= MIN_CHINESE_CHARS || englishWords >= MIN_ENGLISH_WORDS;
  if (!longEnough) {
    return false;
  }

  if (/[?？]\s*$/.test(value)) {
    return true;
  }

  return (
    ENGLISH_QUESTION_CUES.test(value) ||
    ENGLISH_LEADING_CUES.test(value) ||
    CHINESE_QUESTION_CUES.test(value)
  );
}

function createAutoAnswerTrigger({
  isEnabled,
  onTrigger,
  debounceMs = 400,
  partialExtendMs = 900,
  minIntervalMs = 2500,
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout
}) {
  let segments = [];
  let lastTurnOrder = null;
  let turnEndedAt = null;
  let timer = null;
  let lastFiredAt = -Infinity;

  function cancelTimer() {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
  }

  function reset() {
    cancelTimer();
    segments = [];
    lastTurnOrder = null;
    turnEndedAt = null;
  }

  function arm(delayMs) {
    cancelTimer();
    timer = setTimer(fire, delayMs);
  }

  function fire() {
    timer = null;
    if (segments.length === 0) {
      return;
    }

    const question = segments.join(' ').trim();
    if (!isEnabled() || !looksLikeQuestion(question)) {
      reset();
      return;
    }

    // Too soon after the last automatic answer: wait out the rest of the interval.
    const waitMs = minIntervalMs - (now() - lastFiredAt);
    if (waitMs > 0) {
      arm(waitMs);
      return;
    }

    const endedAt = turnEndedAt;
    reset();
    lastFiredAt = now();
    onTrigger({ question, turnEndedAt: endedAt });
  }

  function handleTurn({ text, final, turnOrder } = {}) {
    if (!isEnabled()) {
      reset();
      return;
    }

    const value = String(text || '').trim();

    if (!final) {
      // The interviewer is talking again: hold the pending question a bit longer.
      if (timer !== null && value) {
        arm(partialExtendMs);
      }
      return;
    }

    if (!value) {
      return;
    }

    // A formatted final can replace the unformatted final of the same turn.
    const sameTurn = turnOrder !== undefined && turnOrder !== null && turnOrder === lastTurnOrder;
    if (sameTurn && segments.length > 0) {
      segments[segments.length - 1] = value;
    } else {
      segments.push(value);
    }

    lastTurnOrder = turnOrder ?? null;
    turnEndedAt = now();
    arm(debounceMs);
  }

  return {
    handleTurn,
    reset
  };
}

module.exports = {
  createAutoAnswerTrigger,
  looksLikeQuestion
};
