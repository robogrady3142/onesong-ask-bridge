/**
 * Page OCR for Meet readings: a photo, screenshot, or scanned PDF of book pages
 * goes to a Gemini vision model and comes back as plain text for the organiser
 * to check and correct. Nothing is stored here.
 */

/** Largest decoded file the endpoint accepts (the app caps each group at 2 MB in total). */
export const OCR_MAX_BYTES = 2 * 1024 * 1024;

export const OCR_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
] as const;

export type OcrMimeType = (typeof OCR_MIME_TYPES)[number];

export const OCR_NO_TEXT = "NO_TEXT";

export const OCR_SYSTEM_PROMPT = [
  "You transcribe printed pages for a reading group.",
  "Return only the text that is printed on the page, word for word, in reading order.",
  "Keep paragraph breaks as a blank line. Join words hyphenated across a line break, and join lines within a paragraph.",
  "Leave out running headers, running footers and page numbers.",
  "Do not summarise, translate, correct, explain or add anything. Do not use code fences.",
  "Mark a heading with a leading '# ' only if it is clearly a chapter or section title.",
  `If there is no readable printed text, reply with exactly ${OCR_NO_TEXT}.`,
].join("\n");

export function ocrUserPrompt(mimeType: OcrMimeType): string {
  return mimeType === "application/pdf"
    ? "Transcribe every page of this scanned document in order. Separate pages with a blank line."
    : "Transcribe the printed text on this page.";
}

/** Output budget: one page is short; a scanned PDF can run to many pages. */
export function ocrMaxOutputTokens(mimeType: OcrMimeType): number {
  return mimeType === "application/pdf" ? 32_768 : 8_192;
}

export type OcrRequest =
  | { ok: true; mimeType: OcrMimeType; data: string; bytes: number }
  | { ok: false; error: string };

export function parseOcrRequest(body: unknown): OcrRequest {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Expected JSON." };
  }
  const rec = body as Record<string, unknown>;
  const mimeType = typeof rec.mimeType === "string" ? rec.mimeType.trim().toLowerCase() : "";
  if (!(OCR_MIME_TYPES as readonly string[]).includes(mimeType)) {
    return { ok: false, error: "Use a JPEG, PNG, WebP or HEIC image, or a PDF." };
  }
  const data = typeof rec.base64 === "string" ? rec.base64.replace(/\s+/g, "") : "";
  if (!data || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
    return { ok: false, error: "The file could not be read." };
  }
  const pad = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  const bytes = Math.floor((data.length * 3) / 4) - pad;
  if (bytes <= 0) return { ok: false, error: "The file could not be read." };
  if (bytes > OCR_MAX_BYTES) return { ok: false, error: "The file is larger than 2 MB." };
  return { ok: true, mimeType: mimeType as OcrMimeType, data, bytes };
}

/** Strip fences and chatter; "" means no readable text. */
export function cleanOcrText(raw: string): string {
  let text = (raw ?? "").replace(/\r\n?/g, "\n").trim();
  const fenced = text.match(/^```[a-z]*\n([\s\S]*?)\n```$/i);
  if (fenced) text = fenced[1].trim();
  if (!text || text === OCR_NO_TEXT || /^no[_ ]text\.?$/i.test(text)) return "";
  return text
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
