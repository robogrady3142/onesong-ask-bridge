import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanGuidedReply, GUIDED_SYSTEM_PROMPT, parseGuided } from "./guided-exploration";

describe("guided exploration", () => {
  it("is only on for guided: true", () => {
    assert.equal(parseGuided({ guided: true }), true);
    assert.equal(parseGuided({ guided: "true" }), false);
    assert.equal(parseGuided({}), false);
  });

  it("asks for a short reflection, one open question and a crisis-line safeguard", () => {
    assert.match(GUIDED_SYSTEM_PROMPT, /one to three sentences/);
    assert.match(GUIDED_SYSTEM_PROMPT, /exactly ONE open, non-leading question/);
    assert.match(GUIDED_SYSTEM_PROMPT, /1737/);
    assert.match(GUIDED_SYSTEM_PROMPT, /111/);
  });

  it("strips cite marks and a References block", () => {
    const out = cleanGuidedReply(
      "You feel stuck [1][2].\n\nWhat feels most important about that?\n\nReferences\n1. Dougan — Forty Days",
    );
    assert.equal(out, "You feel stuck.\n\nWhat feels most important about that?");
  });
});
