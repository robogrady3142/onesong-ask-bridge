/**
 * Optional `minWords` for standard Ask (additive). OneSong Question sends it for
 * personalised answers ("use saved questions to provide context"), which must be
 * at least 400 words. When absent, prompts and flow are unchanged.
 */

export const MIN_WORDS_FLOOR = 200;
export const MIN_WORDS_CEILING = 1200;

/** Integer minWords for a standard, non-guided Ask; otherwise undefined. */
export function parseMinWords(body: {
  minWords?: unknown;
  depth?: unknown;
  deepDive?: unknown;
  guided?: unknown;
}): number | undefined {
  if (body.guided === true || body.depth === "deep" || body.deepDive === true) return undefined;
  const n = typeof body.minWords === "number" ? Math.round(body.minWords) : NaN;
  if (!Number.isFinite(n) || n < MIN_WORDS_FLOOR || n > MIN_WORDS_CEILING) return undefined;
  return n;
}

export function minWordsPhrase(n: number): string {
  return `at least ${n} words (about ${n + 50}–${n + 250} words, in several full paragraphs)`;
}

/** Swap the standard "~350–500 words" guidance for the requested minimum. */
export function withMinWords(text: string, n: number | undefined): string {
  if (!n) return text;
  return text
    .replace(/Aim for a standard answer of about 350–500 words \(not a short blurb, not an essay\)\./g, `Write ${minWordsPhrase(n)}; not a short blurb.`)
    .replace(/(?:~|about\s+)350–500 words/g, minWordsPhrase(n));
}

export function countWords(text: string): number {
  return text.replace(/\s*\[\d+\]/g, "").trim().split(/\s+/).filter(Boolean).length;
}

export function lengthRewriteNudge(n: number, words: number): string {
  return `REWRITE REQUIRED: the previous draft was only ${words} words. Expand it to ${minWordsPhrase(n)}, keeping the same retrieved sources, the numbered [n] citations in the body and the numbered References list. Do not invent teachers, works or quotations.`;
}
