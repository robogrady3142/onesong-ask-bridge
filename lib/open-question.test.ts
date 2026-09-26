import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildOpenQuestionPrompt, cleanOpenQuestion, parseOpenQuestion } from "./open-question";

describe("parseOpenQuestion", () => {
  it("is on only for openQuestion: true without guided", () => {
    assert.equal(parseOpenQuestion({ openQuestion: true }), true);
    assert.equal(parseOpenQuestion({}), false);
    assert.equal(parseOpenQuestion({ openQuestion: "yes" }), false);
    assert.equal(parseOpenQuestion({ openQuestion: true, guided: true }), false);
  });
});

describe("cleanOpenQuestion", () => {
  it("keeps one question and strips labels and quotes", () => {
    assert.equal(cleanOpenQuestion("Question: “What do you notice when that happens?”"), "What do you notice when that happens?");
    assert.equal(cleanOpenQuestion("**Follow-up question:** What feels most alive in that for you?"), "What feels most alive in that for you?");
    assert.equal(cleanOpenQuestion("Here is one.\nWhat happens in you just before you decide? [2]"), "What happens in you just before you decide?");
  });
  it("returns empty when there is no question", () => {
    assert.equal(cleanOpenQuestion(""), "");
    assert.equal(cleanOpenQuestion("Please reach out to 1737."), "");
  });
});

describe("buildOpenQuestionPrompt", () => {
  it("includes the question and answer without [n] marks", () => {
    const p = buildOpenQuestionPrompt("Why am I restless?", "Restlessness is common [1] [2].");
    assert.match(p, /Why am I restless\?/);
    assert.match(p, /Restlessness is common\./);
    assert.doesNotMatch(p, /\[1\]/);
  });
});
