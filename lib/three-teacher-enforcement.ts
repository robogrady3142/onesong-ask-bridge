/**
 * Ask three-teacher enforcement (distinct surnames).
 *
 * Default, and Custom with ≥3 selected teachers, must cite at least three
 * DIFFERENT teachers. Three works from one teacher do not count.
 * Custom with 1–2 teachers is exempt (do not invent a third author).
 *
 * Never invent citations; a retry only asks the model to rewrite from
 * retrieved File Search documents.
 */

import {
  displayTeacherName,
  type QuestionCitation,
} from "./question-citations.ts";

export type AskMode = "default" | "custom";

/** Canonical surname for uniqueness (Dougan, Aurobindo, Aivanhov, …). */
export function teacherSurname(raw?: string): string | undefined {
  if (!raw?.trim()) return undefined;
  const displayed = displayTeacherName(raw.trim()) ?? raw.trim();
  const last = displayed.split(/\s+/).filter(Boolean).pop();
  return last || undefined;
}

function surnameKey(raw?: string): string | undefined {
  const surname = teacherSurname(raw);
  return surname ? surname.toLowerCase() : undefined;
}

export function uniqueTeacherSurnames(
  citations: ReadonlyArray<Pick<QuestionCitation, "teacher">>,
): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  for (const cite of citations) {
    const surname = teacherSurname(cite.teacher);
    const key = surnameKey(cite.teacher);
    if (!surname || !key || seen.has(key)) continue;
    seen.add(key);
    order.push(surname);
  }
  return order;
}

export function selectedTeacherSurnames(teachers: readonly string[]): string[] {
  return uniqueTeacherSurnames(teachers.map((teacher) => ({ teacher })));
}

/**
 * Default always requires three distinct surnames.
 * Custom requires three only when the reader selected ≥3 distinct teachers.
 */
export function requiresThreeDistinctTeachers(
  mode: AskMode,
  selectedTeachers: readonly string[],
): boolean {
  if (mode === "default") return true;
  return selectedTeacherSurnames(selectedTeachers).length >= 3;
}

/** After mergeCitations: retry once when the three-teacher rule is unmet. */
export function shouldRetryForThreeTeachers(
  mode: AskMode,
  selectedTeachers: readonly string[],
  merged: ReadonlyArray<Pick<QuestionCitation, "teacher">>,
): boolean {
  if (!requiresThreeDistinctTeachers(mode, selectedTeachers)) return false;
  return uniqueTeacherSurnames(merged).length < 3;
}

/** Keep the rewrite only when it has an answer and does not lose surname coverage. */
export function shouldKeepRewrite(
  firstUnique: number,
  retryUnique: number,
  retryHasAnswer: boolean,
): boolean {
  return retryHasAnswer && retryUnique >= firstUnique;
}

export const THREE_TEACHER_AUTHOR_RULE =
  `- REQUIRED: Draw on at least three DIFFERENT teachers (distinct surnames). Three works from one teacher do not count — e.g. Aurobindo ×2 + Aivanhov is only two teachers, not three. The References list must include at least three different teacher last names. Assign each distinct retrieved work a number and cite it in the body as [1], [2], [3], …`;

export const THREE_TEACHER_CITATION_NUDGE =
  `Remember: write ~350–500 words; cite with [1], [2], [3] in the body (required); end with a numbered References list (teacher — work) matching [n]; the app shows it under the answer. REQUIRED: at least three DIFFERENT teachers (distinct surnames). Three works from one teacher do not count.`;

export const NARROW_TEACHER_CITATION_NUDGE =
  `Remember: write ~350–500 words; cite with [1], [2] in the body for the selected teacher(s) only (required); end with a numbered References list (teacher — work) matching [n]; the app shows it under the answer.`;

export function narrowTeacherAuthorRule(uniqueLast: readonly string[]): string {
  return `- The reader selected only ${uniqueLast.length} teacher(s) (${uniqueLast.join(", ")}). Use only those sources. Still use numbered in-text cites [1], [2] as needed — do not invent a third author.`;
}

export function threeTeacherRewriteNudge(uniqueSurnames: readonly string[]): string {
  const listed = uniqueSurnames.length
    ? `The draft used only ${uniqueSurnames.length} distinct surname(s): ${uniqueSurnames.join(", ")}.`
    : "The draft did not cite three distinct teacher surnames.";
  return `REWRITE REQUIRED: ${listed} Cite at least THREE DIFFERENT teachers (distinct last names). Three works from one teacher do not count. Use only retrieved File Search documents — do not invent teachers, works, quotations, or citations. Keep ~350–500 words; numbered [1], [2], [3] in the body; numbered References (teacher last name — work) matching those [n] marks.`;
}

export const THREE_TEACHER_REWRITE_SYSTEM =
  `REWRITE: The previous draft failed the three-teacher rule. You must cite at least three DIFFERENT teacher surnames from retrieved documents. Multiple works by one teacher still count as one teacher. Do not invent sources.`;

export function citationNudgeForAsk(
  mode: AskMode,
  selectedTeachers: readonly string[],
): string {
  return requiresThreeDistinctTeachers(mode, selectedTeachers)
    ? THREE_TEACHER_CITATION_NUDGE
    : NARROW_TEACHER_CITATION_NUDGE;
}

export function mergeRetrievedTextByFile(
  first: Map<string, string>,
  second: Map<string, string>,
): Map<string, string> {
  const out = new Map(first);
  for (const [key, text] of second) {
    if (!key || !text) continue;
    const prev = out.get(key);
    if (!prev || text.length > prev.length) out.set(key, text);
  }
  return out;
}
