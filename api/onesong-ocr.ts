/**
 * Page OCR for Meet readings (server-to-server from onesong.group only).
 * POST { mimeType, base64 } → { ok: true, text, model } | { ok: false, code, error }.
 *
 * Auth: x-onesong-bridge header (same shared value as /api/onesong-question).
 * No CORS headers: browsers cannot call this directly; the app's signed-in server
 * function checks the group's 2 MB upload allowance first and then calls here.
 * Env: GEMINI_API_KEY. The image is sent to Gemini and not stored.
 */
import { GoogleGenAI } from "@google/genai";
import { classifyAskModelExhaustion, isHighDemandError } from "../lib/ask-client-error";
import {
  OCR_SYSTEM_PROMPT,
  cleanOcrText,
  ocrMaxOutputTokens,
  ocrUserPrompt,
  parseOcrRequest,
} from "../lib/page-ocr";

export const config = {
  runtime: "nodejs",
  maxDuration: 120,
};

const BRIDGE_HEADER = "x-onesong-bridge";
const BRIDGE_TOKEN = "onesong-bridge-2026-09";
const OCR_MODELS = ["gemini-3.5-flash", "gemini-3.5-flash-lite"] as const;

type OcrResult =
  | { ok: true; text: string; model: string }
  | { ok: false; code: "unauthorized" | "not_configured" | "bad_request" | "high_demand" | "error"; error?: string };

function json(body: OcrResult, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request): Promise<Response> {
  if (request.headers.get(BRIDGE_HEADER) !== BRIDGE_TOKEN) {
    return json({ ok: false, code: "unauthorized" }, 401);
  }
  const apiKey = process.env.GEMINI_API_KEY?.trim() ?? "";
  if (apiKey.length < 20) {
    return json({ ok: false, code: "not_configured", error: "Text extraction is not available right now." }, 503);
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, code: "bad_request", error: "Expected JSON." }, 400);
  }
  const parsed = parseOcrRequest(body);
  if (!parsed.ok) return json({ ok: false, code: "bad_request", error: parsed.error }, 400);

  const ai = new GoogleGenAI({ apiKey });
  const failures: unknown[] = [];
  let lastError = "";
  for (const model of OCR_MODELS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: [
            {
              role: "user",
              parts: [
                { inlineData: { mimeType: parsed.mimeType, data: parsed.data } },
                { text: ocrUserPrompt(parsed.mimeType) },
              ],
            },
          ],
          config: {
            systemInstruction: OCR_SYSTEM_PROMPT,
            temperature: 0,
            maxOutputTokens: ocrMaxOutputTokens(parsed.mimeType),
          },
        });
        const raw = typeof (response as { text?: string }).text === "string" ? (response as { text: string }).text : "";
        return json({ ok: true, text: cleanOcrText(raw), model }, 200);
      } catch (err) {
        failures.push(err);
        lastError = err instanceof Error ? err.message : String(err);
        console.error("[ocr] model failed:", `${model}: ${lastError}`.split(apiKey).join("[redacted]").slice(0, 1200));
        if (!isHighDemandError(err)) break;
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
  }
  const failure = classifyAskModelExhaustion(failures, lastError, apiKey);
  return json(
    {
      ok: false,
      code: failure.code,
      error:
        failure.code === "high_demand"
          ? "Text extraction uses a free-tier Gemini model and it is busy right now. Please try again shortly."
          : "The text could not be extracted from this file. Please try again.",
    },
    failure.status,
  );
}
