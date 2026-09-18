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

const SYSTEM_PROMPT = `You are answering questions for OneSong Question using only the retrieved File Search documents.

Rules:
- Ground answers only in retrieved docs. Do not invent teachings or fill gaps from general knowledge.
- Write NotebookLM-like natural prose: clear, warm, readable paragraphs — not bullet dumps unless the user asks.
- Cite sources as teacher + filename (from metadata/citations) so a reader can find the passage.
- If sources conflict or differ in emphasis, briefly say how they meet or where they diverge.
- If retrieval is thin, say what you found and what is missing — do not speculate.
- You are not a therapist, not a medical professional, and not a replacement for a human teacher. If the person is in crisis, urge local professional help. Do not provide methods of harm.
- Plain prose preferred. Keep answers compact unless the question needs more depth.`;

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

      const response = await ai.models.generateContent({
        model,
        contents: question,
        config: {
          systemInstruction: SYSTEM_PROMPT,
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
