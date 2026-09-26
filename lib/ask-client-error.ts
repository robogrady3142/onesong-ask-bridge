/**
 * Map Gemini / model failures to client-safe Ask error payloads.
 * Never leak raw API JSON (or key material) to the browser.
 */

export const HIGH_DEMAND_CODE = "high_demand" as const;

export const HIGH_DEMAND_ERROR =
  "We use a free-tier Gemini model for Ask. There is high demand right now — please try again shortly.";

/** Some models are at their free-tier limit and the rest are busy. */
export const QUOTA_OR_BUSY_ERROR =
  "We use a free-tier Gemini model for Ask, and it is busy or has reached its limit right now. Please try again in a few minutes.";

export const GENERIC_ASK_ERROR =
  "Ask could not complete this request. Please try again.";

export type AskModelFailureCode = typeof HIGH_DEMAND_CODE | "error";

export type AskModelFailure = {
  ok: false;
  code: AskModelFailureCode;
  error: string;
  status: number;
};

function redactApiKey(message: string, apiKey?: string): string {
  const key = apiKey ?? process.env.GEMINI_API_KEY;
  if (!key || key.length < 8) return message;
  return message.split(key).join("[redacted]");
}

function errorText(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) {
    const status = (err as { status?: unknown }).status;
    const extra = status !== undefined ? ` status=${String(status)}` : "";
    return `${err.message}${extra}`;
  }
  if (err && typeof err === "object") {
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  return String(err);
}

function numericCode(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d{3}$/.test(value.trim())) {
    return Number(value.trim());
  }
  return undefined;
}

function isUnavailableToken(value: unknown): boolean {
  return typeof value === "string" && value.trim().toUpperCase() === "UNAVAILABLE";
}

function extractJsonObjects(text: string): unknown[] {
  const out: unknown[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "{") continue;
    let depth = 0;
    for (let j = i; j < text.length; j++) {
      if (text[j] === "{") depth++;
      else if (text[j] === "}") {
        depth--;
        if (depth === 0) {
          try {
            out.push(JSON.parse(text.slice(i, j + 1)));
          } catch {
            // not a complete JSON object
          }
          i = j;
          break;
        }
      }
    }
  }
  return out;
}

function looksLikeHighDemandText(text: string): boolean {
  const t = text.toLowerCase();
  if (t.includes("high demand")) return true;
  if (t.includes("overloaded")) return true;
  if (/\bunavailable\b/.test(t)) return true;
  if (/\b503\b/.test(t)) return true;
  return false;
}

function inspectRecord(rec: Record<string, unknown>): boolean {
  if (numericCode(rec.status) === 503) return true;
  if (numericCode(rec.code) === 503) return true;
  if (isUnavailableToken(rec.status) || isUnavailableToken(rec.code)) return true;
  if (rec.error && typeof rec.error === "object" && rec.error !== null) {
    if (inspectRecord(rec.error as Record<string, unknown>)) return true;
  }
  return false;
}

export function isHighDemandError(err: unknown): boolean {
  if (err == null) return false;
  if (typeof err === "object") {
    if (inspectRecord(err as Record<string, unknown>)) return true;
  }
  const text = errorText(err);
  if (looksLikeHighDemandText(text)) return true;
  for (const obj of extractJsonObjects(text)) {
    if (obj && typeof obj === "object" && inspectRecord(obj as Record<string, unknown>)) {
      return true;
    }
  }
  return false;
}

/** Free-tier quota hit (429 / RESOURCE_EXHAUSTED): per-minute or per-day request limits. */
export function isQuotaError(err: unknown): boolean {
  if (err == null) return false;
  if (typeof err === "object") {
    const rec = err as Record<string, unknown>;
    if (numericCode(rec.status) === 429 || numericCode(rec.code) === 429) return true;
  }
  const text = errorText(err);
  return /\b429\b|RESOURCE_EXHAUSTED|exceeded your current quota/i.test(text);
}

/** Per-day quota (as opposed to a per-minute burst limit). */
export function isDailyQuotaError(err: unknown): boolean {
  return isQuotaError(err) && /PerDay/i.test(errorText(err));
}

/** Seconds Gemini suggests waiting before a retry, if it said. */
export function quotaRetryDelaySeconds(err: unknown): number | undefined {
  const m = errorText(err).match(/retry(?:Delay"?\s*:\s*"|\s+in\s+)(\d+(?:\.\d+)?)s/i);
  return m ? Math.ceil(Number(m[1])) : undefined;
}

/** The model name is not available to this key / API version. */
export function isModelNotFoundError(err: unknown): boolean {
  if (err && typeof err === "object") {
    const rec = err as Record<string, unknown>;
    if (numericCode(rec.status) === 404) return true;
  }
  const text = errorText(err);
  return /"code"\s*:\s*404|\bNOT_FOUND\b|is not found for API version|models\/[\w.-]+ is not found/i.test(text);
}

/** Temporary capacity problems: busy model (503) or free-tier quota (429). */
export function isBusyOrQuotaError(err: unknown): boolean {
  return isHighDemandError(err) || isQuotaError(err);
}

export function containsRawApiJson(message: string): boolean {
  return extractJsonObjects(message).length > 0;
}

/** Key-only redact for internal lastError notes. */
export function scrubError(message: string, apiKey?: string): string {
  return redactApiKey(message, apiKey);
}

/** Client-visible message: never raw Gemini JSON, never key material. */
export function clientSafeError(message: string, apiKey?: string): string {
  const redacted = redactApiKey(message, apiKey);
  if (isHighDemandError(redacted)) return HIGH_DEMAND_ERROR;
  if (containsRawApiJson(redacted)) return GENERIC_ASK_ERROR;
  return redacted;
}

/**
 * When every model attempt failed with 503 / high demand / UNAVAILABLE,
 * return high_demand. Other exhaustion stays `error` but still strips JSON.
 */
export function classifyAskModelExhaustion(
  failures: unknown[],
  lastError: string,
  apiKey?: string,
): AskModelFailure {
  // A fallback model this key cannot use (404) says nothing about capacity; judge the rest.
  const relevant = failures.filter((f) => !isModelNotFoundError(f));
  if (relevant.length > 0 && relevant.every(isBusyOrQuotaError)) {
    return {
      ok: false,
      code: HIGH_DEMAND_CODE,
      error: relevant.some(isQuotaError) ? QUOTA_OR_BUSY_ERROR : HIGH_DEMAND_ERROR,
      status: 503,
    };
  }
  return {
    ok: false,
    code: "error",
    error: clientSafeError(lastError, apiKey),
    status: 502,
  };
}
