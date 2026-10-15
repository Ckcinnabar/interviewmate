const { describeClaudeError } = require('../../../services/ai/claude-service');

// Runs one answer at a time. A new request always wins: the previous stream is
// aborted and its half-finished answer is left out of the conversation.
function createAnswerController({
  session,
  claudeService,
  captureScreen,
  getProfile,
  getPrompt,
  sendToRenderer,
  now = Date.now
}) {
  let active = null;
  let sequence = 0;

  function cancelActive() {
    if (active) {
      active.abortController.abort();
    }
  }

  // `trigger` is 'manual', 'auto', 'screen' (whole screen), or 'region' (the
  // part of the screen given by `region`).
  async function answer({ trigger = 'manual', question = '', turnEndedAt = null, region = null } = {}) {
    cancelActive();
    const usesScreen = trigger === 'screen' || trigger === 'region';

    sequence += 1;
    const id = `answer-${sequence}`;
    const abortController = new AbortController();
    const current = { id, abortController };
    active = current;

    const startedAt = now();
    let draft = null;
    let started = false;

    try {
      const image = usesScreen ? await captureScreen({ region }) : null;
      if (abortController.signal.aborted) {
        return { id, aborted: true };
      }

      draft = session.beginAnswer({ trigger, image });
      if (!draft.hasNewInput && !draft.hasHistory) {
        draft.discard();
        sendToRenderer('answer-notice', {
          message: '還沒有聽到面試官說話。先開始聆聽，或用「看螢幕」。'
        });
        return { id, skipped: true };
      }

      const profile = getProfile(usesScreen ? 'screen' : 'voice');
      sendToRenderer('answer-start', {
        id,
        trigger,
        question: question || draft.question,
        thinking: profile.thinking?.type !== 'disabled'
      });
      started = true;

      let firstTextAt = null;
      const { instructions, knowledge } = getPrompt(profile);
      const result = await claudeService.streamAnswer({
        profile,
        instructions,
        knowledge,
        turns: draft.messages,
        signal: abortController.signal,
        onText: (text) => {
          if (firstTextAt === null) {
            firstTextAt = now();
          }
          sendToRenderer('answer-chunk', { id, text });
        }
      });

      // A newer request may have started while the last bytes arrived. It built
      // its turn from the same pending speech, so this one must not commit.
      if (abortController.signal.aborted) {
        draft.discard();
        sendToRenderer('answer-end', { id, aborted: true, error: '' });
        return { id, aborted: true };
      }

      const finishedAt = now();
      const timing = {
        ttftMs: firstTextAt === null ? null : firstTextAt - startedAt,
        totalMs: finishedAt - startedAt,
        sinceTurnEndMs: firstTextAt !== null && turnEndedAt ? firstTextAt - turnEndedAt : null
      };

      console.log(
        `[Answer] ${id} trigger=${trigger} model=${result.model} stop=${result.stopReason} candidate=${draft.candidateCount ?? 0}`,
        `ttft=${timing.ttftMs}ms total=${timing.totalMs}ms`,
        `cache_read=${result.usage?.cache_read_input_tokens ?? 0}`,
        `cache_write=${result.usage?.cache_creation_input_tokens ?? 0}`,
        `input=${result.usage?.input_tokens ?? 0} output=${result.usage?.output_tokens ?? 0}`
      );

      if (result.refused || !result.text.trim()) {
        // Nothing usable came back; drop the speech so it is not retried forever.
        draft.skip();
        sendToRenderer('answer-end', {
          id,
          ...timing,
          refused: result.refused,
          error: result.refused
            ? '這一題被模型的安全機制拒絕回答，請換個說法或直接作答。'
            : '模型沒有回傳內容。'
        });
        return { id, refused: result.refused };
      }

      draft.commit(result.text);
      sendToRenderer('answer-end', { id, ...timing, truncated: result.truncated });
      return { id, text: result.text };
    } catch (error) {
      if (draft) {
        draft.discard();
      }

      const failure = abortController.signal.aborted
        ? { aborted: true, message: '' }
        : describeClaudeError(error);

      if (!failure.aborted) {
        console.error(`[Answer] ${id} failed:`, error);
      }

      if (started) {
        sendToRenderer('answer-end', {
          id,
          aborted: Boolean(failure.aborted),
          error: failure.aborted ? '' : failure.message
        });
      } else if (!failure.aborted) {
        sendToRenderer('answer-notice', { message: failure.message });
      }

      return { id, aborted: Boolean(failure.aborted), error: failure.message };
    } finally {
      if (active === current) {
        active = null;
      }
    }
  }

  function clear() {
    cancelActive();
    session.clear();
    sendToRenderer('session-cleared', {});
  }

  return {
    answer,
    cancelActive,
    clear
  };
}

module.exports = {
  createAnswerController
};
