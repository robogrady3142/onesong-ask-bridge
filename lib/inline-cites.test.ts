import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ensureInlineNumberedCites,
  stripModelReferencesSection,
  takeModelReferencesSection,
} from "../api/onesong-question.ts";

const BODY_WITH_CITES =
  "Self-observation begins in ordinary life [1], and attention must be divided [2], while the heart stays soft [3].";

const CLASSIC_REFS = `References
1. Dougan — Forty Days
2. Gurdjieff — Views from the Real World
3. Tweedie — Daughter of Fire`;

const CITATIONS = [
  { teacher: "Dougan", file: "Forty Days" },
  { teacher: "Gurdjieff", file: "Views from the Real World" },
  { teacher: "Tweedie", file: "Daughter of Fire" },
];

test("takeModelReferencesSection keeps in-body [n] and parses classic 1. rows", () => {
  const raw = `${BODY_WITH_CITES}\n\n${CLASSIC_REFS}`;
  const taken = takeModelReferencesSection(raw);
  assert.match(taken.answer, /\[1\]/);
  assert.match(taken.answer, /\[2\]/);
  assert.match(taken.answer, /\[3\]/);
  assert.doesNotMatch(taken.answer, /References/i);
  assert.equal(taken.citations.length, 3);
  assert.equal(taken.citations[0].teacher, "Dougan");
  assert.equal(taken.citations[1].teacher, "Gurdjieff");
  assert.equal(taken.citations[2].teacher, "Tweedie");
});

test("takeModelReferencesSection keeps [n] when References is a markdown heading", () => {
  const raw = `${BODY_WITH_CITES}\n\n## References\n1. Gurdjieff — Views from the Real World\n2. Tweedie — Daughter of Fire`;
  const taken = takeModelReferencesSection(raw);
  assert.match(taken.answer, /\[1\].*\[2\]/s);
  assert.doesNotMatch(taken.answer, /## References/);
  assert.equal(taken.citations.length, 2);
});

test("takeModelReferencesSection does not eat prose after the word reference", () => {
  const raw = `They treat this as a
reference
1. Gurdjieff says it begins in ordinary life [1]
2. Tweedie says the heart stays soft [2]`;
  const taken = takeModelReferencesSection(raw);
  assert.match(taken.answer, /\[1\]/);
  assert.match(taken.answer, /\[2\]/);
  assert.match(taken.answer, /ordinary life/);
  assert.equal(taken.citations.length, 0);
});

test("takeModelReferencesSection parses [n] and [n]: bibliography rows", () => {
  const raw = `Gurdjieff teaches self-observation. Tweedie keeps the heart soft.

[1] Gurdjieff — Views from the Real World
[2]: Tweedie — Daughter of Fire`;
  const taken = takeModelReferencesSection(raw);
  assert.doesNotMatch(taken.answer, /\[1\] Gurdjieff/);
  assert.doesNotMatch(taken.answer, /\[2\]:/);
  assert.match(taken.answer, /Gurdjieff teaches self-observation/);
  assert.equal(taken.citations[0].teacher, "Gurdjieff");
  assert.equal(taken.citations[1].teacher, "Tweedie");
});

test("stripModelReferencesSection is take() without dropping body [n]", () => {
  const raw = `${BODY_WITH_CITES}\n\n${CLASSIC_REFS}`;
  const stripped = stripModelReferencesSection(raw);
  assert.equal(stripped, takeModelReferencesSection(raw).answer);
  assert.match(stripped, /\[1\].*\[2\].*\[3\]/s);
});

test("ensureInlineNumberedCites leaves a Gemini answer that already has [n] in prose", () => {
  const out = ensureInlineNumberedCites(BODY_WITH_CITES, CITATIONS);
  assert.equal(out, BODY_WITH_CITES);
  assert.equal(out.match(/\[\d+\]/g)?.length, 3);
});

test("ensureInlineNumberedCites injects [n] after teacher mentions when omitted", () => {
  const body =
    "Dougan writes of ordinary life. Gurdjieff divides attention. Tweedie keeps the heart soft.";
  const out = ensureInlineNumberedCites(body, CITATIONS);
  assert.match(out, /Dougan \[1\]/);
  assert.match(out, /Gurdjieff \[2\]/);
  assert.match(out, /Tweedie \[3\]/);
});

test("ensureInlineNumberedCites ignores leftover bibliography [n] and still injects into prose", () => {
  const body = `Gurdjieff teaches self-observation. Tweedie keeps the heart soft.
[1] Gurdjieff — Views from the Real World
[2] Tweedie — Daughter of Fire`;
  const out = ensureInlineNumberedCites(body, [
    { teacher: "Gurdjieff", file: "Views from the Real World" },
    { teacher: "Tweedie", file: "Daughter of Fire" },
  ]);
  assert.match(out, /Gurdjieff \[1\] teaches/);
  assert.match(out, /Tweedie \[2\] keeps/);
});

test("ensureInlineNumberedCites fills missing [n] when only some cites are in prose", () => {
  const body = "Gurdjieff starts with self-observation [1]. Tweedie keeps the heart soft.";
  const out = ensureInlineNumberedCites(body, [
    { teacher: "Gurdjieff", file: "Views from the Real World" },
    { teacher: "Tweedie", file: "Daughter of Fire" },
  ]);
  assert.match(out, /\[1\]/);
  assert.match(out, /Tweedie \[2\]/);
  assert.equal(out.match(/Gurdjieff \[1\]/g)?.length ?? 0, 0);
});

test("ensureInlineNumberedCites maps Abdullah body mention to Dougan [n]", () => {
  const body = "Abdullah describes the work of ordinary life. Gurdjieff divides attention.";
  const out = ensureInlineNumberedCites(body, [
    { teacher: "Dougan", file: "Forty Days" },
    { teacher: "Gurdjieff", file: "Views from the Real World" },
  ]);
  assert.match(out, /Abdullah \[1\]/);
  assert.match(out, /Gurdjieff \[2\]/);
});

test("POST path: take then ensure keeps Gemini [n] and matches References", () => {
  const raw = `${BODY_WITH_CITES}\n\n${CLASSIC_REFS}`;
  const taken = takeModelReferencesSection(raw);
  const answer = ensureInlineNumberedCites(taken.answer, taken.citations);
  assert.equal(answer, BODY_WITH_CITES);
  assert.match(answer, /\[1\]/);
  assert.match(answer, /\[2\]/);
  assert.match(answer, /\[3\]/);
});

test("POST path: take then ensure injects when Gemini omits body [n]", () => {
  const raw = `Dougan writes of ordinary life. Gurdjieff divides attention. Tweedie keeps the heart soft.

${CLASSIC_REFS}`;
  const taken = takeModelReferencesSection(raw);
  const answer = ensureInlineNumberedCites(taken.answer, taken.citations);
  assert.match(answer, /Dougan \[1\]/);
  assert.match(answer, /Gurdjieff \[2\]/);
  assert.match(answer, /Tweedie \[3\]/);
  assert.doesNotMatch(answer, /References/i);
});
