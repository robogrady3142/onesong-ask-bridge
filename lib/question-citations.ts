/**
 * Merge model References with Gemini File Search grounding chunk text.
 *
 * Ported for onesong-ask-bridge from solintra src/lib/question-citations.ts
 * (backup/2026-09-19-live-green / c896566): match by teacher / file / index
 * and attach retrieved chunk text as snippet (and context).
 *
 * Never invent paragraphs. limitedContext is applied later only when no
 * grounding text could be attached.
 */

export type QuestionCitation = {
  teacher?: string;
  file?: string;
  snippet?: string;
  /** Alias some Ask UIs read for the retrieved chunk. */
  context?: string;
  /** File Search title/path used to look up retrieved text. */
  sourceFile?: string;
  contextBefore?: string;
  passage?: string;
  paragraph?: string;
  contextAfter?: string;
  limitedContext?: boolean;
};

const TEACHER_LAST_NAME: Record<string, string> = {
  Abdullah: "Dougan",
  Aivanhov: "Aivanhov",
  Nisragadatta: "Nisargadatta",
  Brahamananda: "Brahmananda",
  "Irina Tweedie": "Tweedie",
  "Hazrat Inayat Khan": "Khan",
  "Ramana Maharshi": "Ramana",
  Ramdas: "Ramdas",
  Vivekananda: "Vivekananda",
  Aurobindo: "Aurobindo",
  Gurdjieff: "Gurdjieff",
  "Hakim Sinai": "Sanai",
  Rumi: "Rumi",
  Steiner: "Steiner",
  "Thomas A Kempis": "Kempis",
};

export function displayTeacherName(raw?: string): string | undefined {
  if (!raw) return undefined;
  if (raw === "Abdullah" || /^Abdullah\b/i.test(raw)) return "Dougan";
  return TEACHER_LAST_NAME[raw] ?? raw;
}

function compactForMatch(s: string): string {
  return s
    .replace(/\u00ad/g, "")
    .replace(/[\u2018\u2019\u201A\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u2033]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, "-")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slugForMatch(s: string): string {
  return compactForMatch(s).replace(/ /g, "-");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}

/**
 * Read retrieved chunk text from Gemini grounding objects.
 * Prefer File Search `text`, then `snippet`, then nested `ragChunk`.
 */
export function readGroundingText(node: unknown, depth = 0): string {
  if (depth > 6) return "";
  if (typeof node === "string") return node.trim();
  if (!isRecord(node)) return "";

  const direct = firstString(node.text, node.snippet, node.context);
  if (direct) return direct.trim();

  const rag = node.ragChunk ?? node.rag_chunk;
  const fromRag = readGroundingText(rag, depth + 1);
  if (fromRag) return fromRag;

  const retrieved = node.retrievedContext ?? node.retrieved_context;
  const fromRetrieved = retrieved && retrieved !== node ? readGroundingText(retrieved, depth + 1) : "";
  if (fromRetrieved) return fromRetrieved;

  const content = node.content;
  if (typeof content === "string" && content.trim()) return content.trim();
  const fromContent = content && content !== node ? readGroundingText(content, depth + 1) : "";
  return fromContent;
}

function readCustomMetadata(rc: Record<string, unknown>): Record<string, string> {
  const metaList =
    (rc.customMetadata as Array<{ key?: string; stringValue?: string; string_value?: string }>) ??
    (rc.custom_metadata as Array<{ key?: string; stringValue?: string; string_value?: string }>) ??
    [];
  const meta: Record<string, string> = {};
  for (const item of metaList) {
    if (item?.key) meta[item.key] = item.stringValue ?? item.string_value ?? "";
  }
  return meta;
}

function displayFileName(raw?: string): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (!/[\\/]/.test(trimmed)) return trimmed;
  const base = trimmed.split(/[\\/]/).pop() ?? trimmed;
  return base.replace(/\.[a-z0-9]+$/i, "") || trimmed;
}

export function teachersMatch(a?: string, b?: string): boolean {
  const left = compactForMatch(displayTeacherName(a) ?? a ?? "");
  const right = compactForMatch(displayTeacherName(b) ?? b ?? "");
  if (!left || !right) return false;
  return left === right || left.includes(right) || right.includes(left);
}

export function filesMatch(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  const ca = compactForMatch(a);
  const cb = compactForMatch(b);
  if (!ca || !cb) return false;
  if (ca === cb) return true;
  const sa = slugForMatch(a);
  const sb = slugForMatch(b);
  if (sa && sb && (sa === sb || sa.includes(sb) || sb.includes(sa))) return true;
  if (ca.includes(cb) || cb.includes(ca)) return true;

  const baseA = compactForMatch(displayFileName(a) ?? "");
  const baseB = compactForMatch(displayFileName(b) ?? "");
  if (baseA && baseB && (baseA === baseB || baseA.includes(baseB) || baseB.includes(baseA))) {
    return true;
  }
  return false;
}

function indexRetrievedText(map: Map<string, string>, file: string | undefined, text: string): void {
  if (!file || !text) return;
  const keys = new Set<string>();
  const lower = file.toLowerCase();
  keys.add(lower);
  keys.add(compactForMatch(file));
  keys.add(slugForMatch(file));
  const base = displayFileName(file);
  if (base) {
    keys.add(base.toLowerCase());
    keys.add(compactForMatch(base));
    keys.add(slugForMatch(base));
  }
  for (const key of keys) {
    if (!key) continue;
    const prev = map.get(key);
    map.set(key, prev ? `${prev}\n\n${text}` : text);
  }
}

export function lookupRetrievedText(
  cite: Pick<QuestionCitation, "file" | "sourceFile">,
  retrievedTextByFile?: Map<string, string>,
): string | undefined {
  if (!retrievedTextByFile?.size) return undefined;
  const candidates = [cite.sourceFile, cite.file].filter(Boolean) as string[];
  for (const raw of candidates) {
    const keys = [raw.toLowerCase(), compactForMatch(raw), slugForMatch(raw)];
    const base = displayFileName(raw);
    if (base) keys.push(base.toLowerCase(), compactForMatch(base), slugForMatch(base));
    for (const key of keys) {
      if (!key) continue;
      const hit = retrievedTextByFile.get(key);
      if (hit) return hit;
    }
  }

  for (const [key, text] of retrievedTextByFile) {
    if (candidates.some((raw) => filesMatch(raw, key))) return text;
  }
  return undefined;
}

function groundingChunksFromResponse(response: unknown): unknown[] {
  const plain = (() => {
    try {
      return JSON.parse(JSON.stringify(response)) as unknown;
    } catch {
      return response;
    }
  })();

  const root = isRecord(plain) ? plain : {};
  const payload = isRecord(root.response) ? root.response : root;
  const candidates =
    (payload as { candidates?: unknown[] }).candidates ??
    [];
  const chunks: unknown[] = [];
  for (const cand of candidates) {
    if (!isRecord(cand)) continue;
    const gm = cand.groundingMetadata ?? cand.grounding_metadata;
    if (!isRecord(gm)) continue;
    const list = gm.groundingChunks ?? gm.grounding_chunks;
    if (Array.isArray(list)) chunks.push(...list);
  }
  return chunks;
}

function citationFromChunk(chunk: unknown): QuestionCitation | undefined {
  if (!isRecord(chunk)) return undefined;
  const rcRaw = chunk.retrievedContext ?? chunk.retrieved_context;
  const rc = isRecord(rcRaw) ? rcRaw : {};
  const meta = readCustomMetadata(rc);
  const file = firstString(
    rc.title,
    meta.source_path,
    meta.file,
    rc.uri,
    rc.documentName,
    rc.document_name,
  );
  const teacher = displayTeacherName(meta.teacher || undefined);
  const text = readGroundingText(chunk);
  if (!file && !teacher && !text) return undefined;
  const snippet = text || undefined;
  return {
    teacher,
    file: file || undefined,
    sourceFile: file || undefined,
    snippet,
    context: snippet,
  };
}

export function extractFileSearchCitations(response: unknown): {
  citations: QuestionCitation[];
  retrievedTextByFile: Map<string, string>;
} {
  const citations: QuestionCitation[] = [];
  const retrievedTextByFile = new Map<string, string>();
  try {
    for (const chunk of groundingChunksFromResponse(response)) {
      const cite = citationFromChunk(chunk);
      if (!cite) continue;
      const fullText = cite.snippet ?? "";
      indexRetrievedText(retrievedTextByFile, cite.sourceFile ?? cite.file, fullText);
      citations.push(cite);
    }
  } catch {
    // Citations are best-effort; answer text still returns.
  }
  return { citations, retrievedTextByFile };
}

function findGroundingMatch(
  parsed: QuestionCitation,
  index: number,
  grounding: QuestionCitation[],
  used: Set<number>,
): QuestionCitation | undefined {
  const unused = () => grounding.map((g, i) => ({ g, i })).filter(({ i }) => !used.has(i));

  const teacherAndFile = unused().find(
    ({ g }) => teachersMatch(parsed.teacher, g.teacher) && filesMatch(parsed.file, g.file),
  );
  if (teacherAndFile) return grounding[teacherAndFile.i];

  const byFile = unused().find(({ g }) => filesMatch(parsed.file, g.file));
  if (byFile) return grounding[byFile.i];

  const byTeacher = unused().find(({ g }) => teachersMatch(parsed.teacher, g.teacher));
  if (byTeacher) return grounding[byTeacher.i];

  if (!used.has(index) && grounding[index]) return grounding[index];

  const anyText = unused().find(({ g }) => !!(g.snippet || g.context));
  if (anyText) return grounding[anyText.i];

  return undefined;
}

function attachGroundingText(
  target: QuestionCitation,
  grounding?: QuestionCitation,
): QuestionCitation {
  const snippet = firstString(grounding?.snippet, grounding?.context, target.snippet, target.context);
  const next: QuestionCitation = {
    teacher: target.teacher || grounding?.teacher,
    file: displayFileName(target.file) || displayFileName(grounding?.file) || target.file || grounding?.file,
    sourceFile: grounding?.sourceFile || grounding?.file || target.sourceFile,
  };
  if (snippet) {
    next.snippet = snippet;
    next.context = snippet;
  }
  return next;
}

/**
 * Keep the model References list (app numbering) and attach File Search
 * chunk text onto each row. Match teacher + file, then file, then index,
 * then teacher, then any leftover chunk with text.
 */
export function mergeCitations(
  grounding: QuestionCitation[],
  parsed: QuestionCitation[],
): QuestionCitation[] {
  if (parsed.length === 0) return grounding.map((g) => attachGroundingText(g, g));
  if (grounding.length === 0) return parsed.map((p) => attachGroundingText(p));

  const used = new Set<number>();
  return parsed.map((p, i) => {
    const match = findGroundingMatch(p, i, grounding, used);
    if (match) {
      const idx = grounding.indexOf(match);
      if (idx >= 0) used.add(idx);
    }
    return attachGroundingText(p, match);
  });
}
