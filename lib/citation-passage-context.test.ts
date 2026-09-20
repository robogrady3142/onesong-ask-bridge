import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  expandCitation,
  expandCitations,
  expandFromText,
  findParagraphIndex,
  splitParagraphs,
} from "./citation-passage-context.ts";
import { loadCorpus } from "./question-md-corpus.ts";

const BEFORE = "Attention must be divided between the seen and the seer.";
const PASSAGE =
  'You see both \'I\' and the \'here\' of \'I am here\'—both the anger and the \'I\' that is angry. Call this self-remembering if you like.';
const AFTER =
  "Self-remembering is a global envelope of consciousness that encompasses all things.";
const OTHER_BOOK =
  "This other volume never mentions the anger fragment at all. It talks only about food and impressions.";

const BOOK = `# Views from the Real World

${BEFORE}

${PASSAGE}

${AFTER}
`;

const SNIPPET = `also of yourself doing it. You see both ‘I’ and the ‘here’ of ‘I am
here’—both the anger and the ‘I’ that is angry. Call this self-remembering
if you like.`;

test("splitParagraphs drops headings and keeps body order", () => {
  const paras = splitParagraphs(BOOK);
  assert.deepEqual(paras, [BEFORE, PASSAGE, AFTER]);
});

test("findParagraphIndex locates the containing paragraph", () => {
  const idx = findParagraphIndex(splitParagraphs(BOOK), SNIPPET);
  assert.equal(idx, 1);
});

test("expandFromText returns neighbors from the source only", () => {
  const exp = expandFromText(BOOK, SNIPPET);
  assert.equal(exp.limitedContext, false);
  assert.equal(exp.passage, PASSAGE);
  assert.equal(exp.paragraph, PASSAGE);
  assert.equal(exp.contextBefore, BEFORE);
  assert.equal(exp.contextAfter, AFTER);
});

test("first paragraph has no invented contextBefore", () => {
  const exp = expandFromText(BOOK, BEFORE);
  assert.equal(exp.limitedContext, false);
  assert.equal(exp.passage, BEFORE);
  assert.equal(exp.contextBefore, undefined);
  assert.equal(exp.contextAfter, PASSAGE);
});

test("unknown snippet does not invent neighbors", () => {
  const exp = expandFromText(BOOK, "A sentence that does not exist in this book at all, even as a fragment.");
  assert.deepEqual(exp, { limitedContext: true });
});

test("corpus file match expands; limitedContext false", () => {
  const exp = expandCitation(
    { teacher: "Gurdjieff", file: "Views from the Real World", snippet: SNIPPET },
    {
      corpus: [
        {
          path: "Gurdjieff/Views_from_the_Real_World.md",
          teacher: "Gurdjieff",
          title: "Views from the Real World",
          text: BOOK,
        },
      ],
    },
  );
  assert.equal(exp.limitedContext, false);
  assert.equal(exp.passage, PASSAGE);
  assert.equal(exp.contextBefore, BEFORE);
  assert.equal(exp.contextAfter, AFTER);
});

test("ambiguous equal hits across books do not invent a neighbor pair", () => {
  const shared = "The work begins with observation of ordinary life and nothing else is added here.";
  const exp = expandCitation(
    { teacher: "Gurdjieff", file: "Unknown Title", snippet: shared },
    {
      corpus: [
        { path: "Gurdjieff/a.md", teacher: "Gurdjieff", title: "Alpha", text: `Intro A.\n\n${shared}\n\nAfter A.` },
        { path: "Gurdjieff/b.md", teacher: "Gurdjieff", title: "Beta", text: `Intro B.\n\n${shared}\n\nAfter B.` },
      ],
    },
  );
  assert.equal(exp.limitedContext, true);
  assert.equal(exp.contextBefore, undefined);
  assert.equal(exp.contextAfter, undefined);
});

test("empty corpus + short retrieved blob is limitedContext, no neighbors", () => {
  const exp = expandCitation(
    { teacher: "Gurdjieff", file: "Views from the Real World", snippet: "too short" },
    { corpus: [], retrievedText: "too short" },
  );
  assert.equal(exp.limitedContext, true);
  assert.equal(exp.passage, undefined);
  assert.equal(exp.contextBefore, undefined);
  assert.equal(exp.contextAfter, undefined);
});

test("retrieved File Search text can expand when corpus is absent", () => {
  const exp = expandCitation(
    { teacher: "Gurdjieff", file: "Views from the Real World", snippet: SNIPPET },
    { retrievedText: BOOK },
  );
  assert.equal(exp.limitedContext, false);
  assert.equal(exp.passage, PASSAGE);
  assert.equal(exp.contextBefore, BEFORE);
});

test("expandCitations leaves limitedContext only when no grounding text is attached", () => {
  const rows = expandCitations(
    [
      { teacher: "Gurdjieff", file: "Views from the Real World", snippet: SNIPPET },
      { teacher: "Gurdjieff", file: "Views from the Real World", snippet: "zzzz not in any source at all really truly" },
      { teacher: "Dougan", file: "Ego" },
    ],
    {
      corpus: [
        {
          path: "Gurdjieff/Views_from_the_Real_World.md",
          teacher: "Gurdjieff",
          title: "Views from the Real World",
          text: BOOK,
        },
      ],
    },
  );
  assert.equal(rows[0].limitedContext, false);
  assert.equal(rows[0].passage, PASSAGE);
  assert.equal(rows[1].limitedContext, false);
  assert.equal(rows[1].snippet, "zzzz not in any source at all really truly");
  assert.equal(rows[1].context, "zzzz not in any source at all really truly");
  assert.equal(rows[1].passage, undefined);
  assert.equal(rows[1].contextBefore, undefined);
  assert.equal(rows[2].limitedContext, true);
  assert.equal(rows[2].passage, undefined);
});

test("loadCorpus skips README and _-prefixed paths; reads frontmatter", () => {
  const root = mkdtempSync(join(tmpdir(), "onesong-corpus-"));
  writeFileSync(join(root, "README.md"), "# do not index\n");
  mkdirSync(join(root, "_fixture"));
  writeFileSync(join(root, "_fixture", "skip.md"), "should not load\n");
  mkdirSync(join(root, "Gurdjieff"));
  writeFileSync(
    join(root, "Gurdjieff", "views-from-the-real-world.md"),
    `---\nteacher: Gurdjieff\ntitle: Views from the Real World\n---\n\n${BOOK}`,
  );
  writeFileSync(join(root, "Gurdjieff", "other.md"), OTHER_BOOK);

  const docs = loadCorpus(root);
  assert.equal(docs.length, 2);
  const views = docs.find((d) => d.title === "Views from the Real World");
  assert.ok(views);
  assert.equal(views.teacher, "Gurdjieff");
  const exp = expandCitation(
    { teacher: "Gurdjieff", file: "Views from the Real World", snippet: SNIPPET },
    { corpus: docs },
  );
  assert.equal(exp.limitedContext, false);
  assert.equal(exp.passage, PASSAGE);
});
