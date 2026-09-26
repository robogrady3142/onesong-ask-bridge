import assert from "node:assert/strict";
import { test } from "node:test";
import { OCR_MAX_BYTES, cleanOcrText, ocrMaxOutputTokens, parseOcrRequest } from "./page-ocr";

test("parseOcrRequest accepts images and PDFs and sizes the decoded bytes", () => {
  const r = parseOcrRequest({ mimeType: "IMAGE/JPEG", base64: Buffer.from("hello world").toString("base64") });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.mimeType, "image/jpeg");
    assert.equal(r.bytes, 11);
  }
  assert.equal(parseOcrRequest({ mimeType: "image/heic", base64: "AAAA" }).ok, true);
  assert.equal(parseOcrRequest({ mimeType: "application/pdf", base64: "AAAA" }).ok, true);
});

test("parseOcrRequest rejects other types, junk and oversized files", () => {
  assert.equal(parseOcrRequest({ mimeType: "text/html", base64: "AAAA" }).ok, false);
  assert.equal(parseOcrRequest({ mimeType: "image/png", base64: "not base64!" }).ok, false);
  assert.equal(parseOcrRequest({ mimeType: "image/png" }).ok, false);
  assert.equal(parseOcrRequest(null).ok, false);
  const big = Buffer.alloc(OCR_MAX_BYTES + 1).toString("base64");
  const r = parseOcrRequest({ mimeType: "image/png", base64: big });
  assert.equal(r.ok, false);
});

test("cleanOcrText strips fences and maps NO_TEXT to empty", () => {
  assert.equal(cleanOcrText("```text\nLine one.\n\n\n\nLine two.  \n```"), "Line one.\n\nLine two.");
  assert.equal(cleanOcrText("NO_TEXT"), "");
  assert.equal(cleanOcrText("  "), "");
  assert.equal(cleanOcrText("# Chapter One\r\n\r\nIt was."), "# Chapter One\n\nIt was.");
});

test("PDFs get a larger output budget than a single page", () => {
  assert.ok(ocrMaxOutputTokens("application/pdf") > ocrMaxOutputTokens("image/jpeg"));
});
