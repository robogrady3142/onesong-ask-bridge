/**
 * Ask teacher-count + length enforcement (distinct surnames).
 *
 * Standard (depth omitted / "standard") — same as solintra Ask:
 * - Default, and Custom with ≥3 selected teachers, must cite at least three
 *   DIFFERENT teachers. Three works from one teacher do not count.
 * - Custom with 1–2 teachers is exempt (do not invent a third author).
 * - After mergeCitations, if unique surnames < 3, retry once with a rewrite
 *   nudge. Never invent citations.
 *
 * Deep dive (`depth: "deep"` or `deepDive: true`):
 * - Target ~1000–1400 words (at least ~1000).
 * - Default, and Custom with ≥5 selected teachers, must cite at least five
 *   DIFFERENT teachers. Retry once after merge if unique surnames < 5.
 * - Custom with fewer than 5 selected: cite only within the selection
 *   (do not invent teachers). Still aim for 1000+ words. No min-teacher retry.
 */

import {
  displayTeacherName,
  type QuestionCitation,
} from "./question-citations";

export type AskMode = "default" | "custom";
export type AskDepth = "standard" | "deep";

export const STANDARD_MIN_TEACHERS = 3;
export const DEEP_MIN_TEACHERS = 5;

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
 * How many distinct surnames the answer must cite, or 0 if exempt.
 * Default always uses the depth minimum (3 standard / 5 deep).
 * Custom uses that minimum only when the reader selected at least that many.
 */
export function requiredMinDistinctTeachers(
  mode: AskMode,
  selectedTeachers: readonly string[],
  depth: AskDepth = "standard",
): number {
  const min = depth === "deep" ? DEEP_MIN_TEACHERS : STANDARD_MIN_TEACHERS;
  if (mode === "default") return min;
  return selectedTeacherSurnames(selectedTeachers).length >= min ? min : 0;
}

/**
 * Default always requires three distinct surnames.
 * Custom requires three only when the reader selected ≥3 distinct teachers.
 */
export function requiresThreeDistinctTeachers(
  mode: AskMode,
  selectedTeachers: readonly string[],
): boolean {
  return requiredMinDistinctTeachers(mode, selectedTeachers, "standard") > 0;
}

/** After mergeCitations: retry once when the depth's min-teacher rule is unmet. */
export function shouldRetryForMinTeachers(
  mode: AskMode,
  selectedTeachers: readonly string[],
  merged: ReadonlyArray<Pick<QuestionCitation, "teacher">>,
  depth: AskDepth = "standard",
): boolean {
  const min = requiredMinDistinctTeachers(mode, selectedTeachers, depth);
  if (min <= 0) return false;
  return uniqueTeacherSurnames(merged).length < min;
}

/** After mergeCitations: retry once when the three-teacher rule is unmet. */
export function shouldRetryForThreeTeachers(
  mode: AskMode,
  selectedTeachers: readonly string[],
  merged: ReadonlyArray<Pick<QuestionCitation, "teacher">>,
): boolean {
  return shouldRetryForMinTeachers(mode, selectedTeachers, merged, "standard");
}

/** `depth: "deep"` wins; else `deepDive: true`; else standard. */
export function parseAskDepth(body: {
  depth?: unknown;
  deepDive?: unknown;
}): AskDepth {
  if (body.depth === "deep") return "deep";
  if (body.depth === "standard") return "standard";
  if (body.deepDive === true) return "deep";
  return "standard";
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

export const FIVE_TEACHER_AUTHOR_RULE =
  `- REQUIRED: Draw on at least five DIFFERENT teachers (distinct surnames). Multiple works by one teacher still count as one teacher — e.g. Aurobindo ×2 + Aivanhov + Gurdjieff + Tweedie is only four teachers, not five. The References list must include at least five different teacher last names. Assign each distinct retrieved work a number and cite it in the body as [1], [2], [3], …`;

export const THREE_TEACHER_CITATION_NUDGE =
  `Remember: write ~350–500 words; cite with [1], [2], [3] in the body (required); end with a numbered References list (teacher — work) matching [n]; the app shows it under the answer. REQUIRED: at least three DIFFERENT teachers (distinct surnames). Three works from one teacher do not count.`;

export const NARROW_TEACHER_CITATION_NUDGE =
  `Remember: write ~350–500 words; cite with [1], [2] in the body for the selected teacher(s) only (required); end with a numbered References list (teacher — work) matching [n]; the app shows it under the answer.`;

export const DEEP_FIVE_TEACHER_CITATION_NUDGE =
  `Remember: write ~1000–1400 words (at least ~1000; not a short blurb); cite with [1], [2], [3] in the body (required); end with a numbered References list (teacher — work) matching [n]; the app shows it under the answer. REQUIRED: at least five DIFFERENT teachers (distinct surnames). Multiple works by one teacher still count as one teacher.`;

export const DEEP_NARROW_TEACHER_CITATION_NUDGE =
  `Remember: write ~1000–1400 words (at least ~1000; not a short blurb); cite with [1], [2] in the body for the selected teacher(s) only (required); end with a numbered References list (teacher — work) matching [n]; the app shows it under the answer. Do not invent teachers outside the selection.`;

export function narrowTeacherAuthorRule(uniqueLast: readonly string[]): string {
  return `- The reader selected only ${uniqueLast.length} teacher(s) (${uniqueLast.join(", ")}). Use only those sources. Still use numbered in-text cites [1], [2] as needed — do not invent authors outside that selection.`;
}

export function teacherAuthorRule(
  mode: AskMode,
  selectedTeachers: readonly string[],
  depth: AskDepth = "standard",
): string {
  const min = requiredMinDistinctTeachers(mode, selectedTeachers, depth);
  if (min >= DEEP_MIN_TEACHERS) return FIVE_TEACHER_AUTHOR_RULE;
  if (min >= STANDARD_MIN_TEACHERS) return THREE_TEACHER_AUTHOR_RULE;
  return narrowTeacherAuthorRule(selectedTeacherSurnames(selectedTeachers));
}

export function answerLengthInstruction(depth: AskDepth): string {
  return depth === "deep"
    ? "- Aim for a deep-dive answer of about 1000–1400 words (at least ~1000 words; not a short blurb)."
    : "- Aim for a standard answer of about 350–500 words (not a short blurb, not an essay).";
}

export function threeTeacherRewriteNudge(uniqueSurnames: readonly string[]): string {
  const listed = uniqueSurnames.length
    ? `The draft used only ${uniqueSurnames.length} distinct surname(s): ${uniqueSurnames.join(", ")}.`
    : "The draft did not cite three distinct teacher surnames.";
  return `REWRITE REQUIRED: ${listed} Cite at least THREE DIFFERENT teachers (distinct last names). Three works from one teacher do not count. Use only retrieved File Search documents — do not invent teachers, works, quotations, or citations. Keep ~350–500 words; numbered [1], [2], [3] in the body; numbered References (teacher last name — work) matching those [n] marks.`;
}

export function fiveTeacherRewriteNudge(uniqueSurnames: readonly string[]): string {
  const listed = uniqueSurnames.length
    ? `The draft used only ${uniqueSurnames.length} distinct surname(s): ${uniqueSurnames.join(", ")}.`
    : "The draft did not cite five distinct teacher surnames.";
  return `REWRITE REQUIRED: ${listed} Cite at least FIVE DIFFERENT teachers (distinct last names). Multiple works by one teacher still count as one teacher. Use only retrieved File Search documents — do not invent teachers, works, quotations, or citations. Keep ~1000–1400 words (at least ~1000); numbered [1], [2], [3] in the body; numbered References (teacher last name — work) matching those [n] marks.`;
}

export const THREE_TEACHER_REWRITE_SYSTEM =
  `REWRITE: The previous draft failed the three-teacher rule. You must cite at least three DIFFERENT teacher surnames from retrieved documents. Multiple works by one teacher still count as one teacher. Do not invent sources.`;

export const FIVE_TEACHER_REWRITE_SYSTEM =
  `REWRITE: The previous draft failed the five-teacher rule. You must cite at least five DIFFERENT teacher surnames from retrieved documents. Multiple works by one teacher still count as one teacher. Do not invent sources. Write ~1000–1400 words.`;

export function citationNudgeForAsk(
  mode: AskMode,
  selectedTeachers: readonly string[],
  depth: AskDepth = "standard",
): string {
  const min = requiredMinDistinctTeachers(mode, selectedTeachers, depth);
  if (depth === "deep") {
    return min > 0 ? DEEP_FIVE_TEACHER_CITATION_NUDGE : DEEP_NARROW_TEACHER_CITATION_NUDGE;
  }
  return min > 0 ? THREE_TEACHER_CITATION_NUDGE : NARROW_TEACHER_CITATION_NUDGE;
}

export function rewriteNudgeForAsk(
  uniqueSurnames: readonly string[],
  mode: AskMode,
  selectedTeachers: readonly string[],
  depth: AskDepth = "standard",
): string {
  const min = requiredMinDistinctTeachers(mode, selectedTeachers, depth);
  return min >= DEEP_MIN_TEACHERS
    ? fiveTeacherRewriteNudge(uniqueSurnames)
    : threeTeacherRewriteNudge(uniqueSurnames);
}

export function rewriteSystemForAsk(
  mode: AskMode,
  selectedTeachers: readonly string[],
  depth: AskDepth = "standard",
): string {
  const min = requiredMinDistinctTeachers(mode, selectedTeachers, depth);
  return min >= DEEP_MIN_TEACHERS
    ? FIVE_TEACHER_REWRITE_SYSTEM
    : THREE_TEACHER_REWRITE_SYSTEM;
}

/** Deep prefers flash (long-answer instruction following); lite is fallback. */
export function modelCandidatesForDepth(depth: AskDepth): readonly string[] {
  return depth === "deep"
    ? ["gemini-3.5-flash", "gemini-3.5-flash-lite"]
    : ["gemini-3.5-flash-lite", "gemini-3.5-flash"];
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
