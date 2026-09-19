/**
 * Classic Vercel serverless function (repo-root /api).
 * solintra.vercel.app does NOT run TanStack Start server handlers
 * (src/routes/api/* all 404 HTML). Root /api/* works on Vercel SPA deploys.
 *
 * Auth: x-onesong-bridge: onesong-bridge-2026-09
 * Env: GEMINI_API_KEY (already set on rob-4dcd/solintra)
 */
import { GoogleGenAI } from "@google/genai";

export const config = {
  runtime: "nodejs",
  maxDuration: 60,
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

/** Surname used when expanding numbered References lines. */
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

function lastNameForTeacher(metadata: string): string {
  return TEACHER_LAST_NAME[metadata] ?? metadata.split(/\s+/).slice(-1)[0] ?? metadata;
}

/**
 * Build system instruction for Ask.
 * - In-text cites: [1], [2], … in the body only.
 * - Model appends References; server moves that list under the answer (with File Search snippets when available).
 * - Default / Custom with 3+ teachers: at least three different authors.
 * - Custom with 1–2 teachers: cite only within that selection.
 * - Target length: 350–500 words.
 */
function buildSystemPrompt(
  mode: "default" | "custom",
  teachers: string[],
): string {
  const lastNames = teachers.map(lastNameForTeacher);
  const uniqueLast = [...new Set(lastNames)];
  const minThree =
    mode === "default" || (mode === "custom" && uniqueLast.length >= 3);

  const authorRule = minThree
    ? `- REQUIRED: Draw on at least three different teachers. Assign each distinct source a number and cite it in the body as [1], [2], [3], …`
    : `- The reader selected only ${uniqueLast.length} teacher(s) (${uniqueLast.join(", ")}). Use only those sources. Still use numbered in-text cites [1], [2] as needed — do not invent a third author.`;

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
- Example body fragment: "Self-observation begins in ordinary life [1], and attention must be divided [2], while the heart stays soft [3]."
- Example References:
  1. Dougan — Forty Days
  2. Gurdjieff — Views from the Real World
  3. Tweedie — Daughter of Fire
- For Abdullah Dougan sources, the References surname is always Dougan (never Abdullah).

For Abdullah Dougan material, if you name the teacher in prose use Dougan (never Abdullah as the surname form).

LENGTH:
- Aim for a standard answer of about 350–500 words (not a short blurb, not an essay).

Rules:
- Ground answers only in retrieved docs. Do not invent teachings or fill gaps from general knowledge.
- Write NotebookLM-like natural prose: clear, warm, readable paragraphs — not bullet dumps unless the user asks.
${authorRule}
- If sources conflict or differ in emphasis, briefly say how they meet or where they diverge.
- If retrieval is thin, say what you found and what is missing — do not speculate.
- You are not a therapist, not a medical professional, and not a replacement for a human teacher. If the person is in crisis, urge local professional help. Do not provide methods of harm.
- Prefer prose.`;
}

const MODEL_CANDIDATES = [
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
] as const;

const BRIDGE_HEADER = "x-onesong-bridge";
const BRIDGE_TOKEN = "onesong-bridge-2026-09";

const ALLOWED_ORIGINS = [
  "https://onesong.group",
  "https://otter-otter-silver-falcon.grok.me",
] as const;

type QuestionCitation = {
  teacher?: string;
  file?: string;
  snippet?: string;
};

type QuestionAskResult =
  | {
      ok: true;
      answer: string;
      citations: QuestionCitation[];
      model?: string;
      store: string;
      mode: "default" | "custom";
      teachers: string[];
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


function displayTeacherName(raw?: string): string | undefined {
  if (!raw) return undefined;
  if (raw === "Abdullah" || /^Abdullah\b/i.test(raw)) return "Dougan";
  return TEACHER_LAST_NAME[raw] ?? raw;
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

/** Prefer File Search grounding (with snippets); fall back to parsed model References. */
function mergeCitations(
  grounding: QuestionCitation[],
  parsed: QuestionCitation[],
): QuestionCitation[] {
  if (grounding.length === 0) return parsed;
  if (parsed.length === 0) return grounding;
  // Prefer File Search snippets; prefer clean model titles when they are not raw paths.
  return grounding.map((g, i) => {
    const byTeacher = parsed.find(
      (p) => p.teacher && g.teacher && p.teacher.toLowerCase() === g.teacher.toLowerCase(),
    );
    const p = byTeacher ?? parsed[i];
    const cleanTitle =
      p?.file && !/[\\/]/.test(p.file) ? p.file : undefined;
    return {
      teacher: g.teacher || p?.teacher,
      file: cleanTitle || g.file || p?.file,
      snippet: g.snippet,
    };
  });
}


function extractCitations(response: unknown): QuestionCitation[] {
  const citations: QuestionCitation[] = [];
  const seenFile = new Set<string>();
  try {
    const candidates =
      (response as { candidates?: Array<{ grounding_metadata?: unknown; groundingMetadata?: unknown }> })
        ?.candidates ?? [];
    for (const cand of candidates) {
      const gm =
        (cand as { groundingMetadata?: { groundingChunks?: unknown[] } }).groundingMetadata ??
        (cand as { grounding_metadata?: { grounding_chunks?: unknown[] } }).grounding_metadata;
      const chunks =
        (gm as { groundingChunks?: unknown[] })?.groundingChunks ??
        (gm as { grounding_chunks?: unknown[] })?.grounding_chunks ??
        [];
      for (const chunk of chunks) {
        const rc =
          (chunk as { retrievedContext?: Record<string, unknown> }).retrievedContext ??
          (chunk as { retrieved_context?: Record<string, unknown> }).retrieved_context;
        if (!rc) continue;
        const metaList =
          (rc.customMetadata as Array<{ key?: string; stringValue?: string; string_value?: string }>) ??
          (rc.custom_metadata as Array<{ key?: string; stringValue?: string; string_value?: string }>) ??
          [];
        const meta: Record<string, string> = {};
        for (const m of metaList) {
          if (m?.key) meta[m.key] = m.stringValue ?? m.string_value ?? "";
        }
        const file = String(rc.title ?? meta.source_path ?? "") || undefined;
        const fileKey = (file ?? "").toLowerCase();
        if (fileKey && seenFile.has(fileKey)) continue;
        if (fileKey) seenFile.add(fileKey);
        const text = String(rc.text ?? "").slice(0, 400);
        citations.push({
          teacher: displayTeacherName(meta.teacher || undefined),
          file,
          snippet: text || undefined,
        });
      }
    }
  } catch {
    // Citations are best-effort; answer text still returns.
  }
  return citations;
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
  for (const model of MODEL_CANDIDATES) {
    try {
      const fileSearch: Record<string, unknown> = {
        fileSearchStoreNames: [FILE_SEARCH_STORE],
      };
      if (metadataFilter) {
        fileSearch.metadataFilter = metadataFilter;
      }

      const citationNudge =
        mode === "custom" && teachers.length > 0 && teachers.length < 3
          ? `Remember: write ~350–500 words; cite with [1], [2] in the body for the selected teacher(s) only (required); end with a numbered References list (teacher — work) matching [n]; the app shows it under the answer.`
          : `Remember: write ~350–500 words; cite with [1], [2], [3] in the body (required); end with a numbered References list (teacher — work) matching [n]; the app shows it under the answer. Use at least three different teachers when available.`;
      const response = await ai.models.generateContent({
        model,
        contents: `${question}

(${citationNudge})`,
        config: {
          systemInstruction: buildSystemPrompt(mode, teachers),
          tools: [{ fileSearch }],
        },
      });

      const grounding = extractCitations(response);
      const rawAnswer = (
        typeof (response as { text?: string }).text === "string"
          ? (response as { text: string }).text
          : ""
      ).trim();
      const taken = takeModelReferencesSection(rawAnswer);
      const citations = mergeCitations(grounding, taken.citations);
      const answer = ensureInlineNumberedCites(taken.answer, citations);

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
