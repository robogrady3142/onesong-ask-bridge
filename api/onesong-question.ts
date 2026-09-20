/**
 * Classic Vercel serverless function (repo-root /api).
 * solintra.vercel.app does NOT run TanStack Start server handlers
 * (src/routes/api/* all 404 HTML). Root /api/* works on Vercel SPA deploys.
 *
 * Auth: x-onesong-bridge: onesong-bridge-2026-09
 * Env: GEMINI_API_KEY (already set on rob-4dcd/solintra)
 */
import { GoogleGenAI } from "@google/genai";
import { expandCitations } from "../lib/citation-passage-context";
import {
  displayTeacherName,
  extractFileSearchCitations,
  mergeCitations,
  type QuestionCitation,
} from "../lib/question-citations";
import { getCorpus } from "../lib/question-md-corpus";
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
 * - Deep: ~1000–1400 words. Default / Custom with 5+ teachers: at least five DIFFERENT
 *   teachers; retry once if short. Custom with fewer than 5: cite only within selection.
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
    }
  | {
      ok: false;
      code: "not_configured" | "bad_request" | "error" | "unauthorized";
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

function scrubError(message: string): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key || key.length < 8) return message;
  return message.split(key).join("[redacted]");
}

/** Drop a model-emitted References block so it does not duplicate the app citation list. */
export function stripModelReferencesSection(answer: string): string {
  let out = answer.replace(/\n+#{0,3}\s*References?\s*\n(?:[ \t]*\d+\.\s+[^\n]*\n?)+\s*$/i, "");
  out = out.replace(/\n+#{0,3}\s*References?\s*\n(?:[ \t]*\d+\.\s+[^\n]*\n?)+/gi, "\n");
  return out.trimEnd();
}

/** If the model omitted [n] cites, insert [i] after the first mention of each citation teacher (order matches the app list). */
function ensureInlineNumberedCites(answer: string, citations: QuestionCitation[]): string {
  if (/\[\d+\]/.test(answer)) return answer;
  let out = answer;
  citations.forEach((c, idx) => {
    const n = idx + 1;
    const teacher = (c.teacher || "").trim();
    if (!teacher) return;
    const escaped = teacher.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`\\b${escaped}\\b(?!\\s*\\[\\d+\\])`, "i");
    if (!re.test(out)) return;
    out = out.replace(re, (m) => `${m} [${n}]`);
  });
  return out;
}


/** Parse a trailing model References block into citation rows (then strip it from the answer). */
export function takeModelReferencesSection(answer: string): {
  answer: string;
  citations: QuestionCitation[];
} {
  const citations: QuestionCitation[] = [];
  const re =
    /\n+#{0,3}\s*References?\s*\n((?:[ \t]*\d+\.\s+[^\n]*\n?)+)\s*$/i;
  const m = answer.match(re);
  if (!m) {
    // Also catch mid-answer References blocks the model still emits
    const re2 =
      /\n+#{0,3}\s*References?\s*\n((?:[ \t]*\d+\.\s+[^\n]*\n?)+)/gi;
    let last: RegExpExecArray | null = null;
    let match: RegExpExecArray | null;
    while ((match = re2.exec(answer)) !== null) last = match;
    if (!last) {
      return { answer: answer.trimEnd(), citations };
    }
    const block = last[1];
    for (const line of block.split("\n")) {
      const lm = line.match(/^\s*\d+\.\s+(.+?)\s*$/);
      if (!lm) continue;
      const body = lm[1];
      const parts = body.split(/\s+[—–-]\s+/); // em dash / en dash / hyphen
      if (parts.length >= 2) {
        const teacherRaw = parts[0].trim();
        const rest = parts.slice(1).join(" — ").trim();
        citations.push({
          teacher: displayTeacherName(teacherRaw) ?? teacherRaw,
          file: rest || undefined,
        });
      } else {
        citations.push({ file: body });
      }
    }
    const cleaned = (answer.slice(0, last.index) + answer.slice(last.index + last[0].length))
      .replace(/\n{3,}/g, "\n\n")
      .trimEnd();
    return { answer: cleaned, citations };
  }

  const block = m[1];
  for (const line of block.split("\n")) {
    const lm = line.match(/^\s*\d+\.\s+(.+?)\s*$/);
    if (!lm) continue;
    const body = lm[1];
    const parts = body.split(/\s+[—–-]\s+/);
    if (parts.length >= 2) {
      const teacherRaw = parts[0].trim();
      const rest = parts.slice(1).join(" — ").trim();
      citations.push({
        teacher: displayTeacherName(teacherRaw) ?? teacherRaw,
        file: rest || undefined,
      });
    } else {
      citations.push({ file: body });
    }
  }
  const cleaned = answer.replace(re, "").replace(/\n{3,}/g, "\n\n").trimEnd();
  return { answer: cleaned, citations };
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

  let lastError = "All models failed.";
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
      // Deep Default / Custom ≥5: rewrite once if <5 distinct surnames.
      // Narrow Custom (standard 1–2 / deep <5) is exempt. Never invent citations if the rewrite still falls short.
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
    }
  }

  return jsonResponse(
    request,
    {
      ok: false,
      code: "error",
      error: scrubError(lastError),
    },
    502,
  );
}
