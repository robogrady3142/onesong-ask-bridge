import assert from "node:assert/strict";
import { test } from "node:test";
import { expandCitations } from "./citation-passage-context.ts";
import {
  extractFileSearchCitations,
  filesMatch,
  mergeCitations,
  readGroundingText,
  teachersMatch,
} from "./question-citations.ts";

const EGO_TEXT =
  "The ego, the imaginary idea you have of yourself, is a part of the negative force of the Earth.";
const TWEEDIE_TEXT =
  "the me, the I, which separates me from you -- that is the only evil, say the Sufi.";
const GURDJIEFF_TEXT =
  "Self-observation begins in ordinary life and attention must be divided.";

test("readGroundingText prefers text, then snippet, then ragChunk", () => {
  assert.equal(
    readGroundingText({ retrievedContext: { text: "from-text", snippet: "from-snippet" } }),
    "from-text",
  );
  assert.equal(
    readGroundingText({ retrievedContext: { snippet: "from-snippet" } }),
    "from-snippet",
  );
  assert.equal(
    readGroundingText({
      retrieved_context: { rag_chunk: { text: "from-rag" } },
    }),
    "from-rag",
  );
  assert.equal(readGroundingText({ ragChunk: { text: "top-rag" } }), "top-rag");
});

test("teachersMatch maps Abdullah store metadata to Dougan", () => {
  assert.equal(teachersMatch("Abdullah", "Dougan"), true);
  assert.equal(teachersMatch("Irina Tweedie", "Tweedie"), true);
  assert.equal(teachersMatch("Gurdjieff", "Tweedie"), false);
});

test("filesMatch is path/title tolerant", () => {
  assert.equal(filesMatch("Ego", "Abdullah/Ego.md"), true);
  assert.equal(
    filesMatch("Views from the Real World", "Gurdjieff/Views_from_the_Real_World.md"),
    true,
  );
  assert.equal(filesMatch("Ego", "Daughter of Fire"), false);
});

test("extractFileSearchCitations reads chunks with no rc.text", () => {
  const { citations, retrievedTextByFile } = extractFileSearchCitations({
    candidates: [
      {
        groundingMetadata: {
          groundingChunks: [
            {
              retrievedContext: {
                title: "Abdullah/Ego.md",
                snippet: EGO_TEXT,
                customMetadata: [{ key: "teacher", stringValue: "Abdullah" }],
              },
            },
            {
              retrieved_context: {
                title: "Irina Tweedie/interview.md",
                ragChunk: { text: TWEEDIE_TEXT },
                custom_metadata: [{ key: "teacher", string_value: "Irina Tweedie" }],
              },
            },
          ],
        },
      },
    ],
  });
  assert.equal(citations.length, 2);
  assert.equal(citations[0].teacher, "Dougan");
  assert.equal(citations[0].snippet, EGO_TEXT);
  assert.equal(citations[0].context, EGO_TEXT);
  assert.equal(citations[1].teacher, "Tweedie");
  assert.equal(citations[1].snippet, TWEEDIE_TEXT);
  assert.ok(retrievedTextByFile.get("ego"));
  assert.ok(retrievedTextByFile.get("abdullah/ego.md"));
});

test("mergeCitations attaches grounding text onto the model References list", () => {
  const grounding = [
    { teacher: "Dougan", file: "Abdullah/Ego.md", snippet: EGO_TEXT, sourceFile: "Abdullah/Ego.md" },
    {
      teacher: "Tweedie",
      file: "Irina Tweedie/interview.md",
      snippet: TWEEDIE_TEXT,
      sourceFile: "Irina Tweedie/interview.md",
    },
    {
      teacher: "Gurdjieff",
      file: "Gurdjieff/Views_from_the_Real_World.md",
      snippet: GURDJIEFF_TEXT,
      sourceFile: "Gurdjieff/Views_from_the_Real_World.md",
    },
  ];
  const parsed = [
    { teacher: "Dougan", file: "Ego" },
    { teacher: "Gurdjieff", file: "Views from the Real World" },
    { teacher: "Tweedie", file: "Daughter of Fire" },
  ];
  const merged = mergeCitations(grounding, parsed);
  assert.equal(merged.length, 3);
  assert.equal(merged[0].teacher, "Dougan");
  assert.equal(merged[0].file, "Ego");
  assert.equal(merged[0].snippet, EGO_TEXT);
  assert.equal(merged[0].context, EGO_TEXT);
  assert.equal(merged[1].teacher, "Gurdjieff");
  assert.equal(merged[1].file, "Views from the Real World");
  assert.equal(merged[1].snippet, GURDJIEFF_TEXT);
  assert.equal(merged[2].teacher, "Tweedie");
  assert.equal(merged[2].snippet, TWEEDIE_TEXT);
  assert.ok(merged.every((row) => typeof row.snippet === "string" && row.snippet.length > 0));
});

test("mergeCitations falls back to index when names do not match", () => {
  const grounding = [
    { teacher: "Dougan", file: "unknown-a.md", snippet: EGO_TEXT },
    { teacher: "Tweedie", file: "unknown-b.md", snippet: TWEEDIE_TEXT },
  ];
  const parsed = [{ teacher: "Dougan", file: "Ego" }, { teacher: "Tweedie", file: "Interview" }];
  const merged = mergeCitations(grounding, parsed);
  assert.equal(merged[0].snippet, EGO_TEXT);
  assert.equal(merged[1].snippet, TWEEDIE_TEXT);
});

test("mergeCitations does not invent text when grounding has no chunks", () => {
  const merged = mergeCitations([], [{ teacher: "Dougan", file: "Ego" }]);
  assert.equal(merged[0].teacher, "Dougan");
  assert.equal(merged[0].file, "Ego");
  assert.equal(merged[0].snippet, undefined);
  assert.equal(merged[0].context, undefined);
});

test("expandCitations keeps retrieved snippet and limitedContext false", () => {
  const merged = mergeCitations(
    [{ teacher: "Dougan", file: "Abdullah/Ego.md", snippet: EGO_TEXT, sourceFile: "Abdullah/Ego.md" }],
    [{ teacher: "Dougan", file: "Ego" }],
  );
  const retrievedTextByFile = new Map<string, string>([
    ["abdullah/ego.md", `# Ego\n\nIntro paragraph about work.\n\n${EGO_TEXT}\n\nA later paragraph.`],
    ["ego", `# Ego\n\nIntro paragraph about work.\n\n${EGO_TEXT}\n\nA later paragraph.`],
  ]);
  const rows = expandCitations(merged, { retrievedTextByFile });
  assert.equal(rows[0].limitedContext, false);
  assert.equal(rows[0].snippet, EGO_TEXT);
  assert.equal(rows[0].passage, EGO_TEXT);
  assert.equal(rows[0].contextBefore, "Intro paragraph about work.");
  assert.equal(rows[0].contextAfter, "A later paragraph.");
});
