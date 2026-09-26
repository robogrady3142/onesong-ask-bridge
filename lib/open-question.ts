/**
 * Optional open follow-up question for OneSong Question (additive).
 *
 * When a standard Ask carries `openQuestion: true`, the sourced answer is produced
 * exactly as usual (File Search, [n] citations, References, minWords, teacher checks).
 * Afterwards one short extra call writes ONE neutral, open question, returned in a
 * separate `followUpQuestion` field so it never appears inside the answer text.
 * If that call fails, the answer is returned without it. Requests without
 * `openQuestion` are untouched; `guided: true` keeps its own short reflection mode.
 */

export function parseOpenQuestion(body: { openQuestion?: unknown; guided?: unknown }): boolean {
  return body.openQuestion === true && body.guided !== true;
}

/** Thinking models spend tokens before writing; this is a ceiling, not a target. */
export const OPEN_QUESTION_MAX_OUTPUT_TOKENS = 1024;

export const OPEN_QUESTION_SYSTEM_PROMPT = `You write one follow-up question for OneSong Question's "Explore through guided questions" option. The person has asked something (possibly continuing an earlier conversation) and has just received a full answer drawn from spiritual teachers. Your only job is to offer ONE open question that helps them explore their own situation more deeply, in the style of a calm, neutral, person-centred guide.

RULES:
- Output exactly one question and nothing else: no preamble, no reflection, no quotation marks, no label, no list.
- Open and non-leading: not a yes/no question, not two questions joined together, and not a question that hints at the "right" answer or tests them on the teaching.
- Turn the person toward their own experience of what they asked or shared (what they notice, feel, want, find difficult or meaningful). Plain, warm language; under 30 words.
- If earlier conversation is included, let the question follow from their latest message and do not repeat a question already asked.
- Do not judge, diagnose, label, moralise or advise.
- If anything suggests serious distress, thoughts of suicide or self-harm, abuse, or a risk to anyone's safety, output nothing at all.`;

const ANSWER_CHARS_FOR_QUESTION = 6000;

export function buildOpenQuestionPrompt(question: string, answer: string): string {
  const trimmedAnswer =
    answer.length > ANSWER_CHARS_FOR_QUESTION
      ? `${answer.slice(0, ANSWER_CHARS_FOR_QUESTION)}…`
      : answer;
  return `WHAT THE PERSON ASKED OR SHARED (with any earlier conversation):
${question}

THE ANSWER THEY HAVE JUST RECEIVED:
${trimmedAnswer.replace(/\s?\[\d+\](?:\s*\[\d+\])*/g, "")}

Write the one open follow-up question now.`;
}

/** One clean question line, or "" when the model did not produce a usable question. */
export function cleanOpenQuestion(text: string): string {
  const lines = (text ?? "")
    .split(/\n+/)
    .map((l) =>
      l
        .replace(/\s?\[\d+\](?:\s*\[\d+\])*/g, "")
        .trim()
        .replace(/^(?:[-*•]\s+|\d+[.)]\s+)/, "")
        .replace(/^(?:\*\*)?(?:follow-?up question|question|open question)\s*[:：]\s*(?:\*\*)?/i, "")
        .replace(/^\*\*(.*)\*\*$/, "$1")
        .replace(/^["“'‘]+|["”'’]+$/g, "")
        .trim(),
    )
    .filter(Boolean);
  const q = [...lines].reverse().find((l) => /\?$/.test(l)) ?? "";
  if (!q || q.length > 300) return "";
  return q;
}
