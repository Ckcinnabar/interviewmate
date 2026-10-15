const { describeClaudeError } = require('../../../services/ai/claude-service');
const { toTraditionalChinese } = require('../../../services/interview/chinese-script');

// Holds the job description pasted in the overlay's "這次面試" box and what was
// read from it: the company, the role, and the skills the role needs most.
// Kept in memory only, so every launch starts with an empty box.
//
// States: 'empty' (nothing pasted), 'loading', 'ready', 'error'. In every
// state but 'empty', answers are given the job description itself; once it
// is 'ready', they also get the company, role, and skills.
function createJobBriefController({
  claudeService,
  getProfile,
  maxChars = 8000,
  sendToRenderer
}) {
  let jobDescription = '';
  let brief = null;
  let state = 'empty';
  let errorMessage = '';
  // Bumped by every change, so a slow reply for an older text is dropped.
  let request = 0;

  function getStatus() {
    return {
      state,
      jobDescription,
      company: brief?.company || '',
      role: brief?.role || '',
      points: brief?.points || [],
      message: errorMessage
    };
  }

  function publish() {
    sendToRenderer('job-brief', getStatus());
  }

  // What the answering prompt needs.
  function getPromptParts() {
    return { jobDescription, jobBrief: brief };
  }

  function clear() {
    request += 1;
    jobDescription = '';
    brief = null;
    state = 'empty';
    errorMessage = '';
    publish();
    return getStatus();
  }

  // Reads `text` as the job description. Empty text clears it.
  async function setJobDescription(text) {
    const value = String(text || '').trim().slice(0, maxChars);
    if (!value) {
      return clear();
    }

    request += 1;
    const current = request;
    jobDescription = value;
    brief = null;
    errorMessage = '';

    if (!claudeService.hasApiKey()) {
      state = 'error';
      errorMessage = '尚未設定 Anthropic API key，請到設定頁填入。';
      publish();
      return getStatus();
    }

    state = 'loading';
    publish();

    try {
      const result = await claudeService.summarizeJob({ profile: getProfile('jobBrief'), jobDescription: value });
      if (current !== request) {
        return getStatus();
      }

      brief = {
        company: result.company,
        role: result.role,
        points: result.points.map((point) => toTraditionalChinese(point))
      };
      state = 'ready';
      console.log(
        `[Job] ${brief.company || '?'} / ${brief.role || '?'}: ${brief.points.length} point(s)`,
        `input=${result.usage?.input_tokens ?? 0} output=${result.usage?.output_tokens ?? 0}`
      );
    } catch (error) {
      if (current !== request) {
        return getStatus();
      }

      console.error('[Job] Could not read the job description:', error);
      state = 'error';
      errorMessage = describeClaudeError(error).message;
    }

    publish();
    return getStatus();
  }

  return {
    clear,
    getPromptParts,
    getStatus,
    setJobDescription
  };
}

module.exports = {
  createJobBriefController
};
