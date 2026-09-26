import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { countWords, parseMinWords, withMinWords } from "./min-words";
import { answerLengthInstruction, citationNudgeForAsk } from "./three-teacher-enforcement";

describe("minWords (optional)", () => {
  it("only applies to standard, non-guided asks within bounds", () => {
    assert.equal(parseMinWords({ minWords: 400 }), 400);
    assert.equal(parseMinWords({}), undefined);
    assert.equal(parseMinWords({ minWords: 400, depth: "deep" }), undefined);
    assert.equal(parseMinWords({ minWords: 400, guided: true }), undefined);
    assert.equal(parseMinWords({ minWords: 50 }), undefined);
    assert.equal(parseMinWords({ minWords: "400" }), undefined);
  });
  it("replaces the 350–500 guidance in the system length line and the nudge", () => {
    const sys = withMinWords(answerLengthInstruction("standard"), 400);
    assert.doesNotMatch(sys, /350–500/);
    assert.match(sys, /at least 400 words/);
    const nudge = withMinWords(citationNudgeForAsk("default", [], "standard"), 400);
    assert.doesNotMatch(nudge, /350–500/);
    assert.match(nudge, /at least 400 words/);
  });
  it("leaves text unchanged without minWords", () => {
    const t = answerLengthInstruction("standard");
    assert.equal(withMinWords(t, undefined), t);
  });
  it("counts words without cite marks", () => {
    assert.equal(countWords("One two [1] three [2][3]."), 3);
  });
});
