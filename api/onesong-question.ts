/**
 * Classic Vercel serverless function (repo-root /api).
 * solintra.vercel.app does NOT run TanStack Start server handlers
 * (src/routes/api/* all 404 HTML). Root /api/* works on Vercel SPA deploys.
 *
 * Auth: x-onesong-bridge: onesong-bridge-2026-09
 * Env: GEMINI_API_KEY (already set on rob-4dcd/solintra)
 */
import { GoogleGenAI } from "@google/genai";
import { classifyAskModelExhaustion, scrubError } from "../lib/ask-client-error";
import { expandCitations } from "../lib/citation-passage-context";
import {
  displayTeacherName,
  extractFileSearchCitations,
  mergeCitations,
  type QuestionCitation,
} from "../lib/question-citations";
import { getCorpus } from "../lib/question-md-corpus";
import {
  cleanGuidedReply,
  GUIDED_MAX_OUTPUT_TOKENS,
  GUIDED_SYSTEM_PROMPT,
  parseGuided,
} from "../lib/guided-exploration";
import {
  type AskDepth,
  answerLengthInstruction,
  citationNudgeForAsk,
  mergeRetrievedTextByFile,
  modelCandidatesForDepth,
  parseAskDepth,
  rewriteNudgeForAsk,
  rewriteSystemForAsk,
  shouldKeepRewrite,
  shouldRetryForMinTeachers,
  teacherAuthorRule,
  uniqueTeacherSurnames,
} from "../lib/three-teacher-enforcement";

export const config = {
  runtime: "nodejs",
  maxDuration: 180,
};

const FILE_SEARCH_STORE =
  "fileSearchStores/onesongdefaultteachers-s9iwb4yf5oro";

const STORE_TEACHER_METADATA = [
  "Abdullah",
  "Aivanhov",
  "Nisragadatta",
  "Brahamananda",
  "Irina Tweedie",
  "Hazrat Inayat Khan",
  "Ramana Maharshi",
  "Ramdas",
  "Vivekananda",
  "Aurobindo",
  "Gurdjieff",
  "Hakim Sinai",
  "Rumi",
  "Steiner",
  "Thomas A Kempis",
] as const;

type StoreTeacher = (typeof STORE_TEACHER_METADATA)[number];

/**
 * Build system instruction for Ask.
 * - In-text cites: [1], [2], … in the body only.
 * - Model appends References; server moves that list under the answer (with File Search snippets when available).
 * - Standard: Default / Custom with 3+ teachers: at least three DIFFERENT teachers
 *   (distinct surnames); three works from one teacher do not count. ~350–500 words.
 * - Standard Custom with 1–2 teachers: cite only within that selection (exempt from retry).
 * - Deep: ~1000–1400 words. Default: at least five DIFFERENT teachers; retry
 *   once if short. Custom: required distinct teachers = selected surname count
 *   (cite only within the selection; if they selected 7, require 7).
 */
function buildSystemPrompt(
  mode: "default" | "custom",
  teachers: string[],
  opts?: { rewrite?: boolean; depth?: AskDepth },
): string {
  const depth = opts?.depth ?? "standard";
  const authorRule = teacherAuthorRule(mode, teachers, depth);
  const rewriteTail = opts?.rewrite
    ? `\n\n${rewriteSystemForAsk(mode, teachers, depth)}`
    : "";

  return `You are answering questions for OneSong Question using only the retrieved File Search documents.

CITATION FORMAT (mandatory):
- In the body, cite with square brackets containing a NUMBER only: [1], [2], [3]. Every distinct teacher/work you draw on MUST have at least one [n] in the prose.
- Do NOT put teacher names inside the brackets (no [Gurdjieff], no [Tweedie]).
- After the last prose paragraph, add a References section that lists the same numbers (the app moves this under the answer — keep it only as that trailing section):
  References
  1. Teacher last name — work or filename (from the retrieved docs)
  2. …
- Every [n] in the body must appear in References, and every References entry must be used at least once in the body.
- Number distinct retrieved works in the order you first lean on them: first work [1], second [2], third [3]. Keep that numbering stable through the answer.
- Numbering is per work, not per teacher: two books by Aurobindo are two References rows but still one teacher.
- Example body fragment: "Self-observation begins in ordinary life [1], and attention must be divided [2], while the heart stays soft [3]."
- Example References:
  1. Dougan — Forty Days
  2. Gurdjieff — Views from the Real World
  3. Tweedie — Daughter of Fire
- For Abdullah Dougan sources, the References surname is always Dougan (never Abdullah).

For Abdullah Dougan material, if you name the teacher in prose use Dougan (never Abdullah as the surname form).

LENGTH:
${answerLengthInstruction(depth)}

Rules:
- Ground answers only in retrieved docs. Do not invent teachings or fill gaps from general knowledge.
- Write NotebookLM-like natural prose: clear, warm, readable paragraphs — not bullet dumps unless the user asks.
${authorRule}
- If sources conflict or differ in emphasis, briefly say how they meet or where they diverge.
- If retrieval is thin, say what you found and what is missing — do not speculate.
- You are not a therapist, not a medical professional, and not a replacement for a human teacher. If the person is in crisis, urge local professional help. Do not provide methods of harm.
- Prefer prose.${rewriteTail}`;
}

const MODEL_CANDIDATES = modelCandidatesForDepth("standard");

const BRIDGE_HEADER = "x-onesong-bridge";
const BRIDGE_TOKEN = "onesong-bridge-2026-09";

const ALLOWED_ORIGINS = [
  "https://onesong.group",
  "https://otter-otter-silver-falcon.grok.me",
] as const;

type QuestionAskResult =
  | {
      ok: true;
      answer: string;
      citations: QuestionCitation[];
      model?: string;
      store: string;
      mode: "default" | "custom";
      teachers: string[];
      depth: AskDepth;
      /** True when markdown files were bundled under corpus/. */
      corpusAvailable: boolean;
      /** Present (true) only on guided-exploration replies. */
      guided?: true;
    }
  | {
      ok: false;
      code:
        | "not_configured"
        | "bad_request"
        | "error"
        | "unauthorized"
        | "high_demand";
      error?: string;
    };

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin") ?? "";
  const allowOrigin = (ALLOWED_ORIGINS as readonly string[]).includes(origin)
    ? origin
    : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": `Content-Type, ${BRIDGE_HEADER}`,
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function jsonResponse(
  request: Request,
  body: QuestionAskResult,
  status: number,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(request),
      "Content-Type": "application/json",
    },
  });
}

function hasApiKey(): boolean {
  const key = process.env.GEMINI_API_KEY;
  return typeof key === "string" && key.trim().length > 20;
}

/** Safe diagnostics only — never include key material. */
function apiKeyDiag(): { present: boolean; length: number; names: string[] } {
  const key = process.env.GEMINI_API_KEY;
  const names = Object.keys(process.env)
    .filter((k) => /GEMINI|GOOGLE|GENAI|API_KEY/i.test(k))
    .sort();
  return {
    present: typeof key === "string" && key.length > 0,
    length: typeof key === "string" ? key.trim().length : 0,
    names,
  };
}

function sanitizeTeachers(raw: string[]): StoreTeacher[] {
  const allowed = new Set<string>(STORE_TEACHER_METADATA);
  const out: StoreTeacher[] = [];
  for (const t of raw) {
    if (allowed.has(t) && !out.includes(t as StoreTeacher)) {
      out.push(t as StoreTeacher);
    }
  }
  return out;
}

function buildTeacherFilter(teachers: string[]): string | undefined {
  if (!teachers.length) return undefined;
  if (teachers.length === 1) return `teacher="${teachers[0]}"`;
  return teachers.map((t) => `teacher="${t}"`).join(" OR ");
}

/**
 * Standalone bibliography heading. Plural/Sources/Bibliography only — never the
 * prose word "reference" at the start of a line, which used to eat following
 * numbered body lines (and their [n] cites).
 */
const REFERENCES_HEADING_LINE =
  /^#{0,3}\s*(?:References|Sources|Bibliography)\s*[:.]?\s*$/i;

/** `[1]: Teacher — work` / `[1] Teacher — work` / `1. Teacher — work`. */
function isBibEntryLine(line: string): boolean {
  const t = line;
  if (/^[ \t]*\[\d+\]\s*:/.test(t)) return true;
  if (/^[ \t]*\[\d+\]\s+\S/.test(t)) return true;
  if (/^[ \t]*\d+[.)]\s+\S/.test(t) && /\s+[—–-]\s+/.test(t)) return true;
  return false;
}

/** After an explicit References heading, classic `1. row` entries are bibliography. */
function isHeadingRefEntryLine(line: string): boolean {
  return isBibEntryLine(line) || /^[ \t]*\d+[.)]\s+\S/.test(line);
}

function parseRefEntry(line: string): QuestionCitation | undefined {
  const body =
    line.match(/^[ \t]*\[\d+\]\s*:?\s+(.+?)\s*$/)?.[1] ??
    line.match(/^[ \t]*\d+[.)]\s+(.+?)\s*$/)?.[1];
  if (!body) return undefined;
  const parts = body.split(/\s+[—–-]\s+/);
  if (parts.length >= 2) {
    const teacherRaw = parts[0].trim();
    const rest = parts.slice(1).join(" — ").trim();
    return {
      teacher: displayTeacherName(teacherRaw) ?? teacherRaw,
      file: rest || undefined,
    };
  }
  return { file: body };
}

function lineStartIndex(text: string, index: number): number {
  if (index <= 0) return 0;
  const fromNewline = text.lastIndexOf("\n", index - 1);
  return fromNewline === -1 ? 0 : fromNewline + 1;
}

function consumeRefEntries(
  text: string,
  from: number,
  lineTest: (line: string) => boolean,
): { end: number; citations: QuestionCitation[] } {
  const lead = text.slice(from).match(/^\n*/)?.[0].length ?? 0;
  let pos = from + lead;
  const citations: QuestionCitation[] = [];
  while (pos < text.length) {
    const nl = text.indexOf("\n", pos);
    const lineEnd = nl === -1 ? text.length : nl;
    const line = text.slice(pos, lineEnd);
    if (line.trim() === "") {
      const nextStart = lineEnd + 1;
      if (nextStart > text.length) break;
      const nextNl = text.indexOf("\n", nextStart);
      const nextLine = text.slice(nextStart, nextNl === -1 ? text.length : nextNl);
      if (!lineTest(nextLine)) break;
      pos = nextStart;
      continue;
    }
    if (!lineTest(line)) break;
    const cite = parseRefEntry(line);
    if (cite) citations.push(cite);
    pos = nl === -1 ? text.length : lineEnd + 1;
  }
  return { end: pos, citations };
}

function findLastReferencesHeading(
  answer: string,
): { headingStart: number; afterHeading: number } | null {
  const re = /(^|\n)(#{0,3}\s*(?:References|Sources|Bibliography)\s*[:.]?\s*)(?=\n|$)/gi;
  let last: RegExpExecArray | null = null;
  let match: RegExpExecArray | null;
  while ((match = re.exec(answer)) !== null) {
    const heading = match[2] ?? "";
    if (!REFERENCES_HEADING_LINE.test(heading)) continue;
    last = match;
  }
  if (!last) return null;
  const prefix = last[1] ?? "";
  return {
    headingStart: last.index + prefix.length,
    afterHeading: last.index + last[0].length,
  };
}

function findTrailingBareBibliography(
  answer: string,
): { start: number; end: number; citations: QuestionCitation[] } | null {
  const trimmedEnd = answer.length - (answer.length - answer.trimEnd().length);
  const lines: { start: number; end: number; text: string }[] = [];
  let pos = 0;
  while (pos <= trimmedEnd) {
    const nl = answer.indexOf("\n", pos);
    const end = nl === -1 || nl > trimmedEnd ? trimmedEnd : nl;
    lines.push({ start: pos, end, text: answer.slice(pos, end) });
    if (nl === -1 || nl >= trimmedEnd) break;
    pos = nl + 1;
  }
  let i = lines.length - 1;
  while (i >= 0 && lines[i].text.trim() === "") i--;
  const lastBib = i;
  while (i >= 0 && isBibEntryLine(lines[i].text)) i--;
  const firstBib = i + 1;
  if (firstBib > lastBib) return null;
  const prev = firstBib > 0 ? lines[firstBib - 1].text : "";
  const onlyBracketCites = lines.slice(firstBib, lastBib + 1).every(
    (line) =>
      line.text.trim() === "" || /^[ \t]*\[\d+\]\s*:?\s+\S/.test(line.text),
  );
  // `1. Teacher — work` needs a blank line so numbered prose lists stay put.
  // `[n]` / `[n]:` rows are bibliography even when flush against the last paragraph
  // (and `[n]:` would otherwise become a markdown link definition that hides body [n]).
  if (firstBib > 0 && prev.trim() !== "" && !onlyBracketCites) return null;
  const citations: QuestionCitation[] = [];
  for (let j = firstBib; j <= lastBib; j++) {
    const cite = parseRefEntry(lines[j].text);
    if (cite) citations.push(cite);
  }
  if (!citations.length) return null;
  return {
    start: lines[firstBib].start,
    end: lines[lastBib].end,
    citations,
  };
}

function findReferencesBlock(answer: string): {
  start: number;
  end: number;
  citations: QuestionCitation[];
} | null {
  const heading = findLastReferencesHeading(answer);
  if (heading) {
    const taken = consumeRefEntries(answer, heading.afterHeading, isHeadingRefEntryLine);
    if (taken.citations.length) {
      return {
        start: lineStartIndex(answer, heading.headingStart),
        end: taken.end,
        citations: taken.citations,
      };
    }
  }
  return findTrailingBareBibliography(answer);
}

/** Drop a model-emitted References block so it does not duplicate the app citation list. */
export function stripModelReferencesSection(answer: string): string {
  return takeModelReferencesSection(answer).answer;
}

function teacherNameVariants(teacher?: string): string[] {
  if (!teacher?.trim()) return [];
  const raw = teacher.trim();
  const displayed = displayTeacherName(raw) ?? raw;
  const last = displayed.split(/\s+/).filter(Boolean).pop() ?? displayed;
  const variants = [displayed, last, raw];
  if (/dougan/i.test(`${displayed} ${raw}`)) variants.push("Dougan", "Abdullah");
  if (/sanai/i.test(displayed) || /sinai/i.test(raw)) variants.push("Sanai", "Sinai");
  return [...new Set(variants.filter((name) => name.trim()))];
}

function proseHasCite(answer: string, n: number): boolean {
  const mark = new RegExp(`\\[${n}\\]`);
  for (const line of answer.split("\n")) {
    if (REFERENCES_HEADING_LINE.test(line) || isBibEntryLine(line)) continue;
    if (mark.test(line)) return true;
  }
  return false;
}

/**
 * If the model omitted [n] in the prose, insert [i] after the first mention of
 * each citation teacher (order matches the app list). Leftover bibliography
 * `[n]` lines do not count as in-body cites.
 */
export function ensureInlineNumberedCites(
  answer: string,
  citations: QuestionCitation[],
): string {
  let out = answer;
  citations.forEach((c, idx) => {
    const n = idx + 1;
    if (proseHasCite(out, n)) return;
    for (const name of teacherNameVariants(c.teacher)) {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`\\b${escaped}\\b(?!\\s*\\[\\d+\\])`, "i");
      if (!re.test(out)) continue;
      out = out.replace(re, (m) => `${m} [${n}]`);
      break;
    }
  });
  return out;
}

/** Parse a trailing model References block into citation rows (then strip it from the answer). */
export function takeModelReferencesSection(answer: string): {
  answer: string;
  citations: QuestionCitation[];
} {
  const block = findReferencesBlock(answer);
  if (!block) {
    return { answer: answer.trimEnd(), citations: [] };
  }
  const cleaned = `${answer.slice(0, block.start)}${answer.slice(block.end)}`
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
  return { answer: cleaned, citations: block.citations };
}

type MergedAskDraft = {
  extracted: ReturnType<typeof extractFileSearchCitations>;
  taken: ReturnType<typeof takeModelReferencesSection>;
  merged: QuestionCitation[];
  rawAnswer: string;
};

async function generateMergedAsk(
  ai: GoogleGenAI,
  model: string,
  contents: string,
  systemInstruction: string,
  fileSearch: Record<string, unknown>,
): Promise<MergedAskDraft> {
  const response = await ai.models.generateContent({
    model,
    contents,
    config: {
      systemInstruction,
      tools: [{ fileSearch }],
    },
  });
  const extracted = extractFileSearchCitations(response);
  const rawAnswer = (
    typeof (response as { text?: string }).text === "string"
      ? (response as { text: string }).text
      : ""
  ).trim();
  const taken = takeModelReferencesSection(rawAnswer);
  const merged = mergeCitations(extracted.citations, taken.citations);
  return { extracted, taken, merged, rawAnswer };
}

function isAuthorized(request: Request): boolean {
  return request.headers.get(BRIDGE_HEADER) === BRIDGE_TOKEN;
}

export async function OPTIONS(request: Request): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(request),
  });
}

export async function POST(request: Request): Promise<Response> {
  if (!isAuthorized(request)) {
    return jsonResponse(request, { ok: false, code: "unauthorized" }, 401);
  }

  if (!hasApiKey()) {
    const diag = apiKeyDiag();
    return jsonResponse(
      request,
      {
        ok: false,
        code: "not_configured",
        error: "Question is being connected — use NotebookLM for now.",
        // temporary overnight diag — remove once Live Ask works
        diag,
      } as QuestionAskResult & { diag: ReturnType<typeof apiKeyDiag> },
      503,
    );
  }

  let body: Record<string, unknown> = {};
  try {
    const parsed: unknown = await request.json();
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      body = parsed as Record<string, unknown>;
    }
  } catch {
    return jsonResponse(
      request,
      { ok: false, code: "bad_request", error: "Expected JSON." },
      400,
    );
  }

  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (!question) {
    return jsonResponse(
      request,
      { ok: false, code: "bad_request", error: "Please enter a question." },
      400,
    );
  }

  const mode = body.mode === "custom" ? "custom" : "default";
  const depth = parseAskDepth(body);
  const rawTeachers = Array.isArray(body.teachers)
    ? body.teachers.filter((t): t is string => typeof t === "string")
    : [];
  const teachers =
    mode === "default"
      ? [...STORE_TEACHER_METADATA]
      : sanitizeTeachers(rawTeachers);

  if (mode === "custom" && teachers.length === 0) {
    return jsonResponse(
      request,
      {
        ok: false,
        code: "bad_request",
        error: "Select at least one teacher.",
      },
      400,
    );
  }

  const metadataFilter =
    mode === "custom" ? buildTeacherFilter(teachers) : undefined;

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

  // Optional guided-exploration mode: a short neutral reflection + one open
  // question. No File Search, citations or teacher retry. Only when guided: true.
  if (parseGuided(body)) {
    let guidedError = "All models failed.";
    const guidedFailures: unknown[] = [];
    for (const model of MODEL_CANDIDATES) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: question,
          config: {
            systemInstruction: GUIDED_SYSTEM_PROMPT,
            maxOutputTokens: GUIDED_MAX_OUTPUT_TOKENS,
          },
        });
        const text =
          typeof (response as { text?: string }).text === "string"
            ? (response as { text: string }).text
            : "";
        const answer = cleanGuidedReply(text);
        if (!answer) {
          guidedError = `${model}: empty answer`;
          guidedFailures.push(guidedError);
          continue;
        }
        return jsonResponse(
          request,
          {
            ok: true,
            answer,
            citations: [],
            model,
            store: FILE_SEARCH_STORE,
            mode,
            teachers,
            depth: "standard",
            corpusAvailable: false,
            guided: true,
          },
          200,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        guidedError = scrubError(`${model}: ${msg}`);
        guidedFailures.push(err);
      }
    }
    const failure = classifyAskModelExhaustion(guidedFailures, guidedError);
    return jsonResponse(
      request,
      { ok: false, code: failure.code, error: failure.error },
      failure.status,
    );
  }

  let lastError = "All models failed.";
  const modelFailures: unknown[] = [];
  const models = depth === "deep" ? modelCandidatesForDepth("deep") : MODEL_CANDIDATES;
  for (const model of models) {
    try {
      const fileSearch: Record<string, unknown> = {
        fileSearchStoreNames: [FILE_SEARCH_STORE],
      };
      if (metadataFilter) {
        fileSearch.metadataFilter = metadataFilter;
      }

      const citationNudge = citationNudgeForAsk(mode, teachers, depth);
      let draft = await generateMergedAsk(
        ai,
        model,
        `${question}

(${citationNudge})`,
        buildSystemPrompt(mode, teachers, { depth }),
        fileSearch,
      );

      // Standard Default / Custom ≥3: rewrite once if <3 distinct surnames.
      // Deep Default: rewrite once if <5 distinct surnames.
      // Deep Custom: rewrite once if unique surnames < selected count.
      // Narrow Custom (standard 1–2) is exempt. Never invent citations if the rewrite still falls short.
      if (shouldRetryForMinTeachers(mode, teachers, draft.merged, depth)) {
        try {
          const rewriteNudge = rewriteNudgeForAsk(
            uniqueTeacherSurnames(draft.merged),
            mode,
            teachers,
            depth,
          );
          const retry = await generateMergedAsk(
            ai,
            model,
            `${question}

(${rewriteNudge})

Previous draft (incomplete — too few distinct teacher surnames):
${draft.rawAnswer}`,
            buildSystemPrompt(mode, teachers, { rewrite: true, depth }),
            fileSearch,
          );
          if (
            shouldKeepRewrite(
              uniqueTeacherSurnames(draft.merged).length,
              uniqueTeacherSurnames(retry.merged).length,
              Boolean(retry.taken.answer),
            )
          ) {
            draft = {
              ...retry,
              extracted: {
                citations: retry.extracted.citations,
                retrievedTextByFile: mergeRetrievedTextByFile(
                  draft.extracted.retrievedTextByFile,
                  retry.extracted.retrievedTextByFile,
                ),
              },
            };
          }
        } catch {
          // Keep the first draft; do not invent missing teachers.
        }
      }

      const corpus = getCorpus();
      const citations = expandCitations(draft.merged, {
        corpus,
        retrievedTextByFile: draft.extracted.retrievedTextByFile,
      });
      const answer = ensureInlineNumberedCites(draft.taken.answer, citations);

      if (!answer) {
        lastError = `${model}: empty answer`;
        modelFailures.push(lastError);
        continue;
      }

      return jsonResponse(
        request,
        {
          ok: true,
          answer,
          citations,
          model,
          store: FILE_SEARCH_STORE,
          mode,
          teachers,
          depth,
          corpusAvailable: corpus.length > 0,
        },
        200,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      lastError = scrubError(`${model}: ${msg}`);
      modelFailures.push(err);
    }
  }

  const failure = classifyAskModelExhaustion(modelFailures, lastError);
  return jsonResponse(
    request,
    {
      ok: false,
      code: failure.code,
      error: failure.error,
    },
    failure.status,
  );
}
