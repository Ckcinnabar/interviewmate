// Recognises the interviewer's voice picked up by the candidate's microphone.
//
// Without headphones, the microphone hears the interviewer through the
// speakers, so the candidate's transcript repeats what the interviewer said.
// A candidate line is treated as an echo when most of its token pairs also
// appear in what the interviewer said in the last few seconds.

// Tokens are words, except that each Chinese character is its own token.
// Pairs of tokens are compared, not single letters: letter pairs such as
// "th" occur in almost any English sentence.
function toBigrams(text) {
  const tokens = String(text || '').toLowerCase().match(/\p{Script=Han}|(?:(?!\p{Script=Han})[\p{L}\p{N}])+/gu) || [];
  const bigrams = new Set();
  for (let index = 0; index + 1 < tokens.length; index += 1) {
    bigrams.add(`${tokens[index]} ${tokens[index + 1]}`);
  }
  return bigrams;
}

function createEchoFilter({ windowMs = 20000, threshold = 0.6, now = Date.now } = {}) {
  let heard = [];

  function forgetOld() {
    const cutoff = now() - windowMs;
    heard = heard.filter((entry) => entry.at >= cutoff);
  }

  // Partials count too: the microphone's final for an echoed sentence can
  // arrive before the interviewer's own final.
  function noteInterviewer(text) {
    const bigrams = toBigrams(text);
    if (bigrams.size === 0) {
      return;
    }

    heard.push({ at: now(), bigrams });
    forgetOld();
  }

  function isEcho(text) {
    const bigrams = toBigrams(text);
    if (bigrams.size === 0) {
      return false;
    }

    forgetOld();
    let shared = 0;
    for (const bigram of bigrams) {
      if (heard.some((entry) => entry.bigrams.has(bigram))) {
        shared += 1;
      }
    }

    return shared / bigrams.size >= threshold;
  }

  function reset() {
    heard = [];
  }

  return {
    isEcho,
    noteInterviewer,
    reset
  };
}

module.exports = {
  createEchoFilter
};
