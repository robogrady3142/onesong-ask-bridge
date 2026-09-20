/**
 * Ask citation passage-context expansion.
 *
 * Ported for onesong-ask-bridge from the solintra Ask contract
 * (PR #10 / 27b43f87 — contextBefore / full paragraph / contextAfter).
 *
 * Rules:
 * - Never invent surrounding paragraphs.
 * - limitedContext=true only when no grounding snippet/context can be
 *   attached. Neighbor lookup may still fail; that does not invent text
 *   and does not flip limitedContext if a retrieved chunk is present.
 * - Neighbors are copied only when they actually exist in that source.
 */

export type CitationLike = {
  teacher?: string;
  file?: string;
  snippet?: string;
  context?: string;
  sourceFile?: string;
};

export type CorpusDoc = {
  /** Relative path from corpus root, posix-style. */
  path: string;
  teacher?: string;
  title?: string;
  text: string;
};

export type PassageExpansion = {
  contextBefore?: string;
  /** Full containing paragraph (never a guessed rewrite). */
  passage?: string;
  /** Alias used by some Ask UIs. */
  paragraph?: string;
  contextAfter?: string;
  limitedContext: boolean;
};

export type ExpandedCitation = CitationLike & PassageExpansion;

const MIN_NEEDLE_CHARS = 48;
const MIN_NEEDLE_WORDS = 8;

export function normalizeMatchText(s: string): string {
  return s
    .replace(/\u00ad/g, "")
    .replace(/[\u2018\u2019\u201A\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u2033]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, "-")
    .replace(/[ \t\f\v\r]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

export function compactForMatch(s: string): string {
  return normalizeMatchText(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function slugForMatch(s: string): string {
  return compactForMatch(s).replace(/ /g, "-");
}

/** Drop YAML frontmatter so it cannot be treated as a paragraph. */
export function stripFrontmatter(text: string): string {
  return text.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
}

/**
 * Split a source into paragraphs. Headings and *** rules are boundaries,
 * not paragraphs — they must not be invented as context.
 */
export function splitParagraphs(text: string): string[] {
  const body = stripFrontmatter(text).replace(/\r\n/g, "\n");
  const chunks = body.split(/\n{2,}/);
  const out: string[] = [];
  for (const raw of chunks) {
    const piece = raw.trim();
    if (!piece) continue;
    if (/^#{1,6}\s+\S/.test(piece) && !/\n/.test(piece)) continue;
    if (/^\*{3,}$/.test(piece) || /^-{3,}$/.test(piece)) continue;
    out.push(piece);
  }
  return out;
}

function words(compact: string): string[] {
  return compact.split(" ").filter(Boolean);
}

/** Distinctive needles taken from a File Search snippet. Longest first. */
export function snippetNeedles(snippet: string): string[] {
  const compact = compactForMatch(snippet);
  if (!compact) return [];
  const out: string[] = [];
  if (compact.length >= MIN_NEEDLE_CHARS) out.push(compact);

  const parts = compact
    .split(/[.?!] /)
    .map((p) => p.trim())
    .filter((p) => words(p).length >= MIN_NEEDLE_WORDS && p.length >= MIN_NEEDLE_CHARS);

  const w = words(compact);
  const window = 14;
  if (w.length >= MIN_NEEDLE_WORDS) {
    for (let i = 0; i + MIN_NEEDLE_WORDS <= w.length; i += 6) {
      const slice = w.slice(i, i + window).join(" ");
      if (slice.length >= MIN_NEEDLE_CHARS) parts.push(slice);
    }
  }

  for (const p of parts) {
    if (!out.includes(p)) out.push(p);
  }
  out.sort((a, b) => b.length - a.length);
  return out.slice(0, 8);
}

export function findParagraphIndex(
  paragraphs: string[],
  snippet: string,
): number {
  const needles = snippetNeedles(snippet);
  if (!needles.length) return -1;

  const compactParas = paragraphs.map(compactForMatch);
  let best = -1;
  let bestScore = 0;
  let second = 0;

  for (let i = 0; i < compactParas.length; i++) {
    const para = compactParas[i];
    if (!para) continue;
    let score = 0;
    for (const needle of needles) {
      if (para.includes(needle)) {
        score = Math.max(score, needle.length);
      }
    }
    if (score > bestScore) {
      second = bestScore;
      bestScore = score;
      best = i;
    } else if (score > second) {
      second = score;
    }
  }

  // Unique, high-confidence containment only. No fuzzy "closest paragraph".
  if (best < 0 || bestScore < MIN_NEEDLE_CHARS) return -1;
  if (second > 0 && bestScore - second < 16) return -1;
  return best;
}

export function expandFromText(
  sourceText: string,
  snippet: string | undefined,
): PassageExpansion {
  if (!snippet || !compactForMatch(snippet)) {
    return { limitedContext: true };
  }
  const paragraphs = splitParagraphs(sourceText);
  if (!paragraphs.length) return { limitedContext: true };

  const idx = findParagraphIndex(paragraphs, snippet);
  if (idx < 0) return { limitedContext: true };

  const passage = paragraphs[idx];
  const before = idx > 0 ? paragraphs[idx - 1] : undefined;
  const after = idx + 1 < paragraphs.length ? paragraphs[idx + 1] : undefined;
  return {
    contextBefore: before,
    passage,
    paragraph: passage,
    contextAfter: after,
    limitedContext: false,
  };
}

export function scoreCorpusDoc(cite: CitationLike, doc: CorpusDoc): number {
  let score = 0;
  const citeTeacher = compactForMatch(cite.teacher ?? "");
  const docTeacher = compactForMatch(doc.teacher ?? "");
  const pathTeacher = compactForMatch(doc.path.split("/")[0] ?? "");

  if (citeTeacher) {
    if (docTeacher && (docTeacher === citeTeacher || docTeacher.includes(citeTeacher) || citeTeacher.includes(docTeacher))) {
      score += 4;
    } else if (pathTeacher && (pathTeacher === citeTeacher || pathTeacher.includes(citeTeacher))) {
      score += 3;
    }
  }

  const citeFile = compactForMatch(cite.file ?? "");
  if (!citeFile) return score;

  const title = compactForMatch(doc.title ?? "");
  const base = compactForMatch(
    doc.path
      .split("/")
      .pop()
      ?.replace(/\.[a-z0-9]+$/i, "") ?? "",
  );
  const citeSlug = slugForMatch(cite.file ?? "");
  const titleSlug = slugForMatch(doc.title ?? "");
  const baseSlug = slugForMatch(
    doc.path.split("/").pop()?.replace(/\.[a-z0-9]+$/i, "") ?? "",
  );

  if (citeFile === title || citeSlug === titleSlug) score += 10;
  else if (citeFile === base || citeSlug === baseSlug) score += 10;
  else if (title && (title.includes(citeFile) || citeFile.includes(title))) score += 7;
  else if (base && (base.includes(citeFile) || citeFile.includes(base))) score += 6;

  return score;
}

export function resolveCorpusDocs(
  cite: CitationLike,
  corpus: readonly CorpusDoc[],
): CorpusDoc[] {
  if (!corpus.length) return [];
  const scored = corpus
    .map((doc) => ({ doc, score: scoreCorpusDoc(cite, doc) }))
    .filter((x) => x.score >= 6)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) return [];
  const top = scored[0].score;
  return scored.filter((x) => x.score >= top - 1).map((x) => x.doc);
}

/**
 * Expand one citation. Corpus wins when a file can be resolved; otherwise
 * retrieved File Search text is used if it actually contains the snippet.
 */
export function expandCitation(
  cite: CitationLike,
  options: {
    corpus?: readonly CorpusDoc[];
    retrievedText?: string;
  } = {},
): PassageExpansion {
  const snippet = cite.snippet || cite.context;
  const docs = resolveCorpusDocs(cite, options.corpus ?? []);

  if (docs.length === 1) {
    const fromDoc = expandFromText(docs[0].text, snippet);
    if (!fromDoc.limitedContext) return fromDoc;
  } else if (docs.length > 1) {
    const hits = docs
      .map((d) => expandFromText(d.text, snippet))
      .filter((e) => !e.limitedContext);
    if (hits.length === 1) return hits[0];
    // Ambiguous multi-file hit — do not pick a neighbor set at random.
  }

  if (options.retrievedText) {
    return expandFromText(options.retrievedText, snippet);
  }

  return { limitedContext: true };
}

function retrievedTextForCite(
  cite: CitationLike,
  retrievedTextByFile?: Map<string, string>,
): string | undefined {
  if (!retrievedTextByFile?.size) return undefined;
  const names = [cite.sourceFile, cite.file].filter((v): v is string => !!v);
  for (const raw of names) {
    const keys = [
      raw.toLowerCase(),
      compactForMatch(raw),
      slugForMatch(raw),
      compactForMatch(raw.split(/[\\/]/).pop() ?? ""),
    ];
    for (const key of keys) {
      if (!key) continue;
      const hit = retrievedTextByFile.get(key);
      if (hit) return hit;
    }
  }

  const needles = names.map((n) => compactForMatch(n)).filter(Boolean);
  if (!needles.length) return undefined;
  for (const [key, text] of retrievedTextByFile) {
    const compactKey = compactForMatch(key);
    if (needles.some((n) => compactKey === n || compactKey.includes(n) || n.includes(compactKey))) {
      return text;
    }
  }
  return undefined;
}

function attachedGroundingText(cite: CitationLike): string | undefined {
  const text = (cite.snippet || cite.context || "").trim();
  return text || undefined;
}

export function expandCitations<T extends CitationLike>(
  citations: T[],
  options: {
    corpus?: readonly CorpusDoc[];
    retrievedTextByFile?: Map<string, string>;
  } = {},
): Array<T & PassageExpansion> {
  return citations.map((cite) => {
    const retrievedText = retrievedTextForCite(cite, options.retrievedTextByFile);
    const expansion = expandCitation(cite, {
      corpus: options.corpus,
      retrievedText,
    });
    const grounded = attachedGroundingText(cite);
    const next: T & PassageExpansion = { ...cite, limitedContext: expansion.limitedContext };
    if (!expansion.limitedContext) {
      next.limitedContext = false;
      if (expansion.contextBefore) next.contextBefore = expansion.contextBefore;
      if (expansion.passage) {
        next.passage = expansion.passage;
        next.paragraph = expansion.passage;
      }
      if (expansion.contextAfter) next.contextAfter = expansion.contextAfter;
      if (grounded && !next.context) next.context = grounded;
      return next;
    }

    // Neighbors could not be resolved. Keep retrieved chunk text; do not invent
    // surrounding paragraphs. limitedContext only when nothing was attached.
    if (grounded) {
      next.limitedContext = false;
      next.snippet = cite.snippet || grounded;
      next.context = cite.context || grounded;
      return next;
    }

    next.limitedContext = true;
    return next;
  });
}
