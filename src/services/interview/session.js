// Conversation memory for one interview.
//
// Interviewer speech accumulates as "pending" until an answer is requested.
// Each answered request becomes a user turn (what the interviewer said) plus
// an assistant turn (what the candidate was told to say). The whole history is
// sent with every request, so the model always sees its own earlier answers.
//
// When the candidate's microphone is on, what the candidate said is pending
// too. Every pending segment carries a sequence number, so a user turn can
// list both speakers in the order they spoke (its `exchange`).

const OMITTED_IMAGE_NOTE = '[An earlier screen capture was shared here.]';
const RECENT_CONSUMED_LIMIT = 4;

function normalizeForCompare(text) {
  return String(text || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

// Removes the part of `finalText` that `consumedText` (an earlier partial of
// the same turn) already covered. Partials and finals differ in punctuation
// and casing, so the comparison walks letters and digits only.
function subtractConsumedText(finalText, consumedText) {
  const text = String(finalText || '');
  const consumedLength = normalizeForCompare(consumedText).length;
  if (consumedLength === 0) {
    return text.trim();
  }

  let seen = 0;
  let index = 0;
  while (index < text.length && seen < consumedLength) {
    if (/[\p{L}\p{N}]/u.test(text[index])) {
      seen += 1;
    }
    index += 1;
  }

  return text.slice(index).replace(/^[^\p{L}\p{N}]+/u, '').trim();
}

function hasTurnOrder(turnOrder) {
  return turnOrder !== undefined && turnOrder !== null;
}

function turnLength(turn) {
  // `exchange` repeats the interviewer's speech, plus what the candidate said.
  const exchangeLength = (turn.exchange || []).reduce((sum, line) => sum + line.text.length, 0);
  return Math.max(exchangeLength, (turn.speech || '').length) +
    (turn.livePartial || '').length +
    (turn.text || '').length;
}

function createInterviewSession({ maxChars = 120000 } = {}) {
  let history = [];
  let pendingSpeech = [];
  let livePartial = null;
  // A partial that was sent with an answer before its turn finished.
  let consumedPartial = null;
  // Finals already folded into history; a late duplicate of one is ignored.
  let recentConsumedFinals = [];
  // The same two lists for the candidate's own speech.
  let pendingCandidate = [];
  let recentConsumedCandidate = [];
  let sequence = 0;

  function nextSequence() {
    sequence += 1;
    return sequence;
  }

  function rememberConsumed(list, turnOrder, normalized) {
    list.push({ turnOrder, normalized });
    if (list.length > RECENT_CONSUMED_LIMIT) {
      list.shift();
    }
  }

  function isInList(list, turnOrder, normalized) {
    return list.some((entry) => (
      (hasTurnOrder(turnOrder) && entry.turnOrder === turnOrder) || entry.normalized === normalized
    ));
  }

  function rememberConsumedFinal(turnOrder, normalized) {
    rememberConsumed(recentConsumedFinals, turnOrder, normalized);
  }

  function wasAlreadyConsumed(turnOrder, normalized) {
    return isInList(recentConsumedFinals, turnOrder, normalized);
  }

  // True when `partial` and a final with `turnOrder` belong to the same turn.
  // Without turn numbers, the next final after a partial is taken to be its own.
  function isPartialOfTurn(partial, turnOrder) {
    return !hasTurnOrder(partial.turnOrder) || !hasTurnOrder(turnOrder) || partial.turnOrder === turnOrder;
  }

  function setInterviewerPartial(text, turnOrder) {
    const partialText = String(text || '').trim();
    livePartial = partialText ? { text: partialText, turnOrder } : null;
  }

  function addInterviewerFinal(text, turnOrder) {
    if (livePartial && isPartialOfTurn(livePartial, turnOrder)) {
      livePartial = null;
    }

    const finalText = String(text || '').trim();
    if (!finalText) {
      return;
    }

    const normalizedFinal = normalizeForCompare(finalText);
    if (wasAlreadyConsumed(turnOrder, normalizedFinal)) {
      return;
    }

    // A formatted final can follow an unformatted final for the same turn.
    const lastPending = pendingSpeech[pendingSpeech.length - 1];
    if (
      lastPending &&
      ((hasTurnOrder(turnOrder) && lastPending.turnOrder === turnOrder) ||
        lastPending.normalizedFull === normalizedFinal)
    ) {
      lastPending.text = lastPending.consumedPrefix
        ? subtractConsumedText(finalText, lastPending.consumedPrefix)
        : finalText;
      lastPending.normalizedFull = normalizedFinal;
      return;
    }

    if (consumedPartial) {
      const partial = consumedPartial;
      consumedPartial = null;

      if (isPartialOfTurn(partial, turnOrder)) {
        const rest = subtractConsumedText(finalText, partial.text);
        if (!rest) {
          rememberConsumedFinal(turnOrder, normalizedFinal);
          return;
        }

        pendingSpeech.push({
          text: rest,
          turnOrder,
          normalizedFull: normalizedFinal,
          consumedPrefix: partial.text,
          seq: nextSequence()
        });
        return;
      }
    }

    pendingSpeech.push({ text: finalText, turnOrder, normalizedFull: normalizedFinal, seq: nextSequence() });
  }

  // What the candidate said, from their microphone. Only finals are kept: the
  // candidate's words are context for the next answer, not something to show live.
  function addCandidateFinal(text, turnOrder) {
    const finalText = String(text || '').trim();
    if (!finalText) {
      return;
    }

    const normalizedFinal = normalizeForCompare(finalText);
    if (isInList(recentConsumedCandidate, turnOrder, normalizedFinal)) {
      return;
    }

    // A formatted final can follow an unformatted final for the same turn.
    const last = pendingCandidate[pendingCandidate.length - 1];
    if (
      last &&
      ((hasTurnOrder(turnOrder) && last.turnOrder === turnOrder) || last.normalizedFull === normalizedFinal)
    ) {
      last.text = finalText;
      last.normalizedFull = normalizedFinal;
      return;
    }

    pendingCandidate.push({ text: finalText, turnOrder, normalizedFull: normalizedFinal, seq: nextSequence() });
  }

  // Both speakers in the order they spoke. Empty when the candidate said
  // nothing, so a turn without microphone input looks exactly as before.
  function buildExchange(interviewerSegments, candidateSegments) {
    if (candidateSegments.length === 0) {
      return [];
    }

    return [
      ...interviewerSegments.map((segment) => ({ speaker: 'interviewer', text: segment.text, seq: segment.seq })),
      ...candidateSegments.map((segment) => ({ speaker: 'candidate', text: segment.text, seq: segment.seq }))
    ]
      .filter((line) => line.text)
      .sort((a, b) => a.seq - b.seq)
      .map(({ speaker, text }) => ({ speaker, text }));
  }

  function trimHistory() {
    let total = history.reduce((sum, turn) => sum + turnLength(turn), 0);
    if (total <= maxChars) {
      return;
    }

    // Drop whole question/answer pairs so the history still starts with a user turn.
    const target = Math.floor(maxChars * 0.75);
    while (history.length > 2 && total > target) {
      const removed = history.splice(0, 2);
      total -= removed.reduce((sum, turn) => sum + turnLength(turn), 0);
    }
  }

  function buildMessages(userTurn) {
    // A capture is sent once, with the request it was taken for. In later
    // requests a note stands in for it: resending the image would slow every
    // following answer, and the answer already given describes what it showed.
    return [...history, userTurn].map((turn) => {
      if (turn.role === 'assistant') {
        return { role: 'assistant', text: turn.text };
      }

      return {
        role: 'user',
        speech: turn.speech,
        livePartial: turn.livePartial,
        exchange: turn.exchange || [],
        trigger: turn.trigger,
        image: turn.image || null,
        imageNote: turn.imageOmitted ? OMITTED_IMAGE_NOTE : ''
      };
    });
  }

  function beginAnswer({ trigger = 'manual', image = null } = {}) {
    const consumedCount = pendingSpeech.length;
    const consumedCandidateCount = pendingCandidate.length;
    const partial = livePartial ? { ...livePartial } : null;
    const speech = pendingSpeech.map((segment) => segment.text).join('\n');

    const userTurn = {
      role: 'user',
      speech,
      livePartial: partial ? partial.text : '',
      exchange: buildExchange(pendingSpeech, pendingCandidate),
      trigger,
      image,
      imageOmitted: false
    };

    const lastSegment = pendingSpeech[consumedCount - 1];
    const question = partial ? partial.text : (lastSegment ? lastSegment.text : '');
    let settled = false;

    function consumePending() {
      const consumed = pendingSpeech.slice(0, consumedCount);
      const remaining = pendingSpeech.slice(consumedCount);
      consumed.forEach((segment) => rememberConsumedFinal(segment.turnOrder, segment.normalizedFull));

      if (partial) {
        // The partial's own final may have arrived while the answer streamed.
        const matchIndex = remaining.findIndex((segment) => isPartialOfTurn(partial, segment.turnOrder));
        if (matchIndex === -1) {
          consumedPartial = partial;
        } else {
          const segment = remaining[matchIndex];
          const rest = subtractConsumedText(segment.text, partial.text);
          if (rest) {
            remaining[matchIndex] = { ...segment, text: rest, consumedPrefix: partial.text };
          } else {
            rememberConsumedFinal(segment.turnOrder, segment.normalizedFull);
            remaining.splice(matchIndex, 1);
          }
        }
      }

      pendingSpeech = remaining;

      pendingCandidate.slice(0, consumedCandidateCount).forEach((segment) => {
        rememberConsumed(recentConsumedCandidate, segment.turnOrder, segment.normalizedFull);
      });
      pendingCandidate = pendingCandidate.slice(consumedCandidateCount);
    }

    return {
      messages: buildMessages(userTurn),
      question,
      hasNewInput: Boolean(speech || userTurn.livePartial || image || consumedCandidateCount > 0),
      hasHistory: history.length > 0,
      candidateCount: consumedCandidateCount,

      // The answer was delivered: record both turns.
      commit(answerText) {
        if (settled) return;
        settled = true;
        consumePending();

        const recordedTurn = userTurn.image
          ? { ...userTurn, image: null, imageOmitted: true }
          : userTurn;
        history.push(recordedTurn, { role: 'assistant', text: String(answerText || '') });
        trimHistory();
      },

      // The request produced nothing worth keeping (it was declined): forget
      // the speech so it is not sent again.
      skip() {
        if (settled) return;
        settled = true;
        consumePending();
      },

      // The request was superseded or failed: keep the speech for the next one.
      discard() {
        settled = true;
      }
    };
  }

  // Turn numbers restart with every transcription stream, so numbers from the
  // previous stream must not be matched against the new one.
  function resetTurnTracking() {
    livePartial = null;
    consumedPartial = null;
    recentConsumedFinals = [];
    pendingSpeech = pendingSpeech.map((segment) => ({ ...segment, turnOrder: null }));
  }

  // The same, for the candidate's microphone stream.
  function resetCandidateTurnTracking() {
    recentConsumedCandidate = [];
    pendingCandidate = pendingCandidate.map((segment) => ({ ...segment, turnOrder: null }));
  }

  function clear() {
    history = [];
    pendingSpeech = [];
    livePartial = null;
    consumedPartial = null;
    recentConsumedFinals = [];
    pendingCandidate = [];
    recentConsumedCandidate = [];
  }

  function getHistoryLength() {
    return history.length;
  }

  return {
    addCandidateFinal,
    addInterviewerFinal,
    beginAnswer,
    clear,
    getHistoryLength,
    resetCandidateTurnTracking,
    resetTurnTracking,
    setInterviewerPartial
  };
}

module.exports = {
  createInterviewSession,
  subtractConsumedText
};
