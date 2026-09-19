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
  Abdullah: "Abdullah",
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
 * - In-text cites: [1], [2], … matching a numbered References list at the end.
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
- In the body, cite with square brackets containing a NUMBER only: [1], [2], [3].
- Do NOT put teacher names inside the brackets (no [Gurdjieff], no [Tweedie]).
- At the end of the answer, add a References section that lists the same numbers with a full reference each line:
  References
  1. Teacher last name — work or filename (from the retrieved docs)
  2. …
- Every [n] in the body must appear in References, and every References entry must be used at least once in the body.
- Example body fragment: "Self-observation begins in ordinary life [1], and attention must be divided [2], while the heart stays soft [3]."
- Example References:
  1. Abdullah — Forty Days
  2. Gurdjieff — Views from the Real World
  3. Tweedie — Daughter of Fire

LENGTH:
- Aim for a standard answer of about 350–500 words (not a short blurb, not an essay). Count the prose before the References heading.

Rules:
- Ground answers only in retrieved docs. Do not invent teachings or fill gaps from general knowledge.
- Write NotebookLM-like natural prose: clear, warm, readable paragraphs — not bullet dumps unless the user asks.
${authorRule}
- If sources conflict or differ in emphasis, briefly say how they meet or where they diverge.
- If retrieval is thin, say what you found and what is missing — do not speculate.
- You are not a therapist, not a medical professional, and not a replacement for a human teacher. If the person is in crisis, urge local professional help. Do not provide methods of harm.
- Prefer prose. Keep the References list compact (teacher + work/filename; optional short locator).`;
}

const MODEL_CANDIDATES = [
  "gemini-3.5-flash-lite",
  "gemini-3.5-flash",
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

function extractCitations(response: unknown): QuestionCitation[] {
  const citations: QuestionCitation[] = [];
  try {
    const candidates =
      (
        response as {
          candidates?: Array<{
            grounding_metadata?: unknown;
            groundingMetadata?: unknown;
          }>;
        }
      )?.candidates ?? [];
    for (const cand of candidates) {
      const gm =
        (cand as { groundingMetadata?: { groundingChunks?: unknown[] } })
          .groundingMetadata ??
        (cand as { grounding_metadata?: { grounding_chunks?: unknown[] } })
          .grounding_metadata;
      const chunks =
        (gm as { groundingChunks?: unknown[] })?.groundingChunks ??
        (gm as { grounding_chunks?: unknown[] })?.grounding_chunks ??
        [];
      for (const chunk of chunks) {
        const rc =
          (chunk as { retrievedContext?: Record<string, unknown> })
            .retrievedContext ??
          (chunk as { retrieved_context?: Record<string, unknown> })
            .retrieved_context;
        if (!rc) continue;
        const metaList =
          (rc.customMetadata as Array<{
            key?: string;
            stringValue?: string;
            string_value?: string;
          }>) ??
          (rc.custom_metadata as Array<{
            key?: string;
            stringValue?: string;
            string_value?: string;
          }>) ??
          [];
        const meta: Record<string, string> = {};
        for (const m of metaList) {
          if (m?.key) meta[m.key] = m.stringValue ?? m.string_value ?? "";
        }
        const text = String(rc.text ?? "").slice(0, 240);
        citations.push({
          teacher: meta.teacher || undefined,
          file: String(rc.title ?? meta.source_path ?? "") || undefined,
          snippet: text || undefined,
        });
      }
    }
  } catch {
    // Citations are best-effort.
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
          ? `Remember: write ~350–500 words; cite with [1], [2] in the body for the selected teacher(s) only; end with a matching numbered References list (full teacher + work).`
          : `Remember: write ~350–500 words; cite with [1], [2], [3] in the body; end with a numbered References list matching those numbers (full teacher + work). Use at least three different teachers when available.`;
      const response = await ai.models.generateContent({
        model,
        contents: `${question}

(${citationNudge})`,
        config: {
          systemInstruction: buildSystemPrompt(mode, teachers),
          tools: [{ fileSearch }],
        },
      });

      const answer = (
        typeof (response as { text?: string }).text === "string"
          ? (response as { text: string }).text
          : ""
      ).trim();

      if (!answer) {
        lastError = `${model}: empty answer`;
        continue;
      }

      return jsonResponse(
        request,
        {
          ok: true,
          answer,
          citations: extractCitations(response),
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
