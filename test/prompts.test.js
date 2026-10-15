'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildApiMessages,
  buildJobBriefPrompt,
  buildKnowledgeBlock,
  buildSystemPrompt
} = require('../src/services/ai/prompts');

test('Chinese mode asks for Traditional Chinese with Taiwan wording', () => {
  const prompt = buildSystemPrompt({ interviewLanguage: 'zh' });

  assert.match(prompt, /繁體中文/);
  assert.match(prompt, /台灣用語/);
  assert.doesNotMatch(prompt, /Reply in English/);
});

test('English mode asks for English only', () => {
  const prompt = buildSystemPrompt({ interviewLanguage: 'en' });

  assert.match(prompt, /Reply in English/);
  assert.doesNotMatch(prompt, /繁體中文/);
});

test('an unknown language falls back to English', () => {
  assert.match(buildSystemPrompt({ interviewLanguage: 'fr' }), /Reply in English/);
});

test('the consistency rule is always present', () => {
  const prompt = buildSystemPrompt({});

  assert.match(prompt, /Stay consistent with what was already said/);
  assert.match(prompt, /Keep facts, numbers, technology choices, and personal stories the same/);
});

test('uses the selected programming language', () => {
  assert.match(buildSystemPrompt({ programmingLanguage: 'Go' }), /Write code in Go\. This is the language the candidate chose\./);
  assert.match(buildSystemPrompt({ programmingLanguage: 'Go' }), /still answer in Go/);
  assert.match(buildSystemPrompt({ programmingLanguage: 'COBOL' }), /Write code in Python\./);
});

test('includes the resume when provided', () => {
  const prompt = buildSystemPrompt({
    candidateProfile: { resume: 'Five years of backend work at Acme.' }
  });

  assert.match(prompt, /<resume>\nFive years of backend work at Acme\.\n<\/resume>/);
  assert.match(prompt, /do not invent employers/);
});

test('without a resume it asks for placeholders instead of invented experience', () => {
  const prompt = buildSystemPrompt({ candidateProfile: { resume: '  ' } });

  assert.match(prompt, /Nothing about the candidate's background was provided/);
  assert.doesNotMatch(prompt, /<resume>/);
});

test('the system prompt is identical for identical settings', () => {
  const settings = {
    interviewLanguage: 'zh',
    programmingLanguage: 'Java',
    candidateProfile: { resume: 'r' },
    jobDescription: 'j',
    jobBrief: { company: 'Acme', role: 'SRE', points: ['on-call'] }
  };

  assert.equal(buildSystemPrompt(settings), buildSystemPrompt(settings));
});

test('turns become alternating API messages', () => {
  const messages = buildApiMessages([
    { role: 'user', speech: 'What is a mutex?', livePartial: '', image: null, imageNote: '' },
    { role: 'assistant', text: 'A mutual-exclusion lock.' },
    { role: 'user', speech: 'OK.', livePartial: 'and how is it different from', image: null, imageNote: '' }
  ]);

  assert.deepEqual(messages, [
    { role: 'user', content: 'What is a mutex?' },
    { role: 'assistant', content: 'A mutual-exclusion lock.' },
    { role: 'user', content: 'OK.\nand how is it different from (still speaking)' }
  ]);
});

test('a screen turn carries the image before the text', () => {
  const [message] = buildApiMessages([
    { role: 'user', speech: 'Please solve this one.', livePartial: '', image: 'BASE64', imageNote: '' }
  ]);

  assert.equal(message.role, 'user');
  assert.deepEqual(message.content[0], {
    type: 'image',
    source: { type: 'base64', media_type: 'image/jpeg', data: 'BASE64' }
  });
  assert.equal(message.content[1].type, 'text');
  assert.match(message.content[1].text, /^Please solve this one\.\n\[The candidate captured the screen/);
});

test('an older screen turn keeps a note in place of its image', () => {
  const [message] = buildApiMessages([
    { role: 'user', speech: '', livePartial: '', image: null, imageNote: '[An earlier screen capture was shared here.]' }
  ]);

  assert.equal(message.content, '[An earlier screen capture was shared here.]');
});

test('a request with no new speech asks to refine the previous answer', () => {
  const [message] = buildApiMessages([
    { role: 'user', speech: '', livePartial: '', image: null, imageNote: '' }
  ]);

  assert.match(message.content, /No new speech/);
  assert.match(message.content, /without contradicting it/);
});

test('experience documents are wrapped with their source, PDFs marked as notes', () => {
  const block = buildKnowledgeBlock([
    { source: 'project/Alpha/README.md', kind: 'text', text: '  Built the alpha service.  ' },
    { source: 'project/Alpha/report.pdf', kind: 'pdf', text: 'Accuracy 91%.' },
    { source: 'project/Empty/README.md', kind: 'text', text: '   ' }
  ]);

  assert.match(block, /^<experience_documents>/);
  assert.match(block, /<document source="project\/Alpha\/README\.md">\nBuilt the alpha service\.\n<\/document>/);
  assert.match(block, /<document source="project\/Alpha\/report\.pdf" kind="notes taken from a PDF">\nAccuracy 91%\.\n<\/document>/);
  assert.doesNotMatch(block, /Empty/);
  assert.match(block, /<\/experience_documents>$/);
});

test('no documents means no block at all', () => {
  assert.equal(buildKnowledgeBlock([]), '');
  assert.equal(buildKnowledgeBlock([{ source: 'a.md', kind: 'text', text: '' }]), '');
});

test('with documents loaded, the prompt points at them and asks for no placeholders-only answer', () => {
  const prompt = buildSystemPrompt({ hasKnowledge: true });

  assert.match(prompt, /recorded in the documents in <experience_documents>/);
  assert.match(prompt, /do not invent employers/);
  assert.doesNotMatch(prompt, /Nothing about the candidate's background was provided/);
});

test('resume and documents are both named as sources when both exist', () => {
  const prompt = buildSystemPrompt({ hasKnowledge: true, candidateProfile: { resume: 'CV text' } });

  assert.match(prompt, /recorded in the resume above and the documents in <experience_documents>/);
});

test('a capture taken after the interviewer spoke is for answering what they asked', () => {
  const [message] = buildApiMessages([
    { role: 'user', speech: 'What is wrong with this function?', livePartial: '', image: 'BASE64', imageNote: '' }
  ]);

  assert.match(message.content[1].text, /^What is wrong with this function\?\n\[The candidate captured the screen/);
  assert.match(message.content[1].text, /Answer what the interviewer asked above, using what is shown/);
});

test('a capture with no new speech looks back at the last question before treating the screen as the task', () => {
  const [message] = buildApiMessages([
    { role: 'user', speech: '', livePartial: '', image: 'BASE64', imageNote: '' }
  ]);

  assert.match(message.content[1].text, /If the interviewer's last question was about something in it, answer that question/);
  assert.match(message.content[1].text, /Otherwise treat what is shown as the task/);
});

test('the prompt covers questions about shown code and names the shortcut for a missing capture', () => {
  const prompt = buildSystemPrompt({ screenShortcut: 'Alt+Shift+S' });

  assert.match(prompt, /What the interviewer said most recently decides what to do with it/);
  assert.match(prompt, /do not solve or rewrite everything else on the screen/);
  assert.match(prompt, /tells the candidate to press Alt\+Shift\+S so you can see the screen/);
  assert.match(prompt, /Questions about code that is shown/);
  assert.match(prompt, /explaining or fixing code that is already shown in another language/);
});

test('a region capture is described as the part of the screen the candidate chose', () => {
  const [withSpeech] = buildApiMessages([
    { role: 'user', speech: 'What does this do?', livePartial: '', trigger: 'region', image: 'BASE64', imageNote: '' }
  ]);
  const [withoutSpeech] = buildApiMessages([
    { role: 'user', speech: '', livePartial: '', trigger: 'region', image: 'BASE64', imageNote: '' }
  ]);

  assert.match(withSpeech.content[1].text, /captured the part of the screen they want you to look at so you can see/);
  assert.match(withoutSpeech.content[1].text, /captured the part of the screen they want you to look at\. If the interviewer/);
  assert.equal(withSpeech.content[0].type, 'image');
});

test('a turn with the candidate speech names every speaker', () => {
  const [message] = buildApiMessages([
    {
      role: 'user',
      speech: 'And across several servers?',
      livePartial: 'and with',
      exchange: [
        { speaker: 'candidate', text: 'I would use a token bucket.' },
        { speaker: 'interviewer', text: 'And across several servers?' }
      ],
      image: null,
      imageNote: ''
    }
  ]);

  assert.equal(
    message.content,
    'Candidate: I would use a token bucket.\nInterviewer: And across several servers?\nInterviewer: and with (still speaking)'
  );
});

test('a turn without candidate speech is plain interviewer text, as before', () => {
  const [message] = buildApiMessages([
    { role: 'user', speech: 'What is a mutex?', livePartial: '', exchange: [], image: null, imageNote: '' }
  ]);

  assert.equal(message.content, 'What is a mutex?');
});

test('candidate speech with nothing new from the interviewer asks to continue from there', () => {
  const [message] = buildApiMessages([
    {
      role: 'user',
      speech: '',
      livePartial: '',
      exchange: [{ speaker: 'candidate', text: 'First I would sort the intervals.' }],
      image: null,
      imageNote: ''
    }
  ]);

  assert.match(message.content, /^Candidate: First I would sort the intervals\.\n/);
  assert.match(message.content, /continue from where they are, without repeating what they already said/);
  assert.doesNotMatch(message.content, /No new speech/);
});

test('the system prompt explains candidate lines and puts correctness first', () => {
  const prompt = buildSystemPrompt({});

  assert.match(prompt, /lines starting with "Candidate:"/);
  assert.match(prompt, /what the candidate said is what the interviewer heard/);
  assert.match(prompt, /Being correct comes before staying consistent/);
  assert.match(prompt, /do not repeat it or build on it/);
  assert.match(prompt, /repeats the interviewer's words is the microphone picking up the interviewer/);
  assert.match(prompt, /never call them "the candidate"/);
  assert.match(prompt, /never refer to a reply of yours that the candidate did not say/);
});

test('a pasted job description and what was read from it go into a role section', () => {
  const prompt = buildSystemPrompt({
    jobDescription: 'We are hiring a backend engineer to build Go services on Kubernetes.',
    jobBrief: { company: 'Acme', role: 'Backend Engineer', points: ['Go 微服務', 'Kubernetes 維運'] }
  });

  assert.match(prompt, /## The role/);
  assert.match(prompt, /interviewing for the Backend Engineer position at Acme\./);
  assert.match(prompt, /<job_description>\nWe are hiring a backend engineer/);
  assert.match(prompt, /What this role needs most:\n- Go 微服務\n- Kubernetes 維運/);
  assert.match(prompt, /lead with the experience and skills that show what this role needs/);
  assert.match(prompt, /never justifies inventing experience/);
});

test('a job description that has not been read yet is still given in full', () => {
  const prompt = buildSystemPrompt({ jobDescription: 'Data engineer, Spark.', jobBrief: null });

  assert.match(prompt, /interviewing for the position described below\./);
  assert.match(prompt, /<job_description>\nData engineer, Spark\.\n<\/job_description>/);
  assert.doesNotMatch(prompt, /What this role needs most/);
});

test('without a job description there is no role section', () => {
  const prompt = buildSystemPrompt({ jobBrief: { company: 'Acme', role: 'SRE', points: ['x'] } });

  assert.doesNotMatch(prompt, /## The role/);
  assert.doesNotMatch(prompt, /<job_description>/);
});

test('reading a job description asks for company, role, and a few skills, and nothing it does not say', () => {
  const prompt = buildJobBriefPrompt('  Senior SRE at Globex.  ');

  assert.match(prompt, /record_job tool/);
  assert.match(prompt, /3 or 4 skills/);
  assert.match(prompt, /Traditional Chinese with Taiwan wording/);
  assert.match(prompt, /Do not add skills, requirements, or details it does not mention/);
  assert.match(prompt, /<job_description>\nSenior SRE at Globex\.\n<\/job_description>/);
});
