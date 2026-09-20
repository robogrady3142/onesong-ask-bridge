import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeCitations } from "./question-citations.ts";
import {
  DEEP_FIVE_TEACHER_CITATION_NUDGE,
  DEEP_NARROW_TEACHER_CITATION_NUDGE,
  FIVE_TEACHER_AUTHOR_RULE,
  FIVE_TEACHER_REWRITE_SYSTEM,
  NARROW_TEACHER_CITATION_NUDGE,
  THREE_TEACHER_AUTHOR_RULE,
  THREE_TEACHER_CITATION_NUDGE,
  THREE_TEACHER_REWRITE_SYSTEM,
  answerLengthInstruction,
  citationNudgeForAsk,
  customDeepRewriteSystem,
  mergeRetrievedTextByFile,
  modelCandidatesForDepth,
  parseAskDepth,
  requiredMinDistinctTeachers,
  requiresThreeDistinctTeachers,
  rewriteNudgeForAsk,
  rewriteSystemForAsk,
  shouldKeepRewrite,
  shouldRetryForMinTeachers,
  shouldRetryForThreeTeachers,
  teacherAuthorRule,
  teacherSurname,
  threeTeacherRewriteNudge,
  uniqueTeacherSurnames,
} from "./three-teacher-enforcement.ts";

test("teacherSurname maps store metadata and Abdullah to last names", () => {
  assert.equal(teacherSurname("Abdullah"), "Dougan");
  assert.equal(teacherSurname("Abdullah Dougan"), "Dougan");
  assert.equal(teacherSurname("Sri Aurobindo"), "Aurobindo");
  assert.equal(teacherSurname("Irina Tweedie"), "Tweedie");
  assert.equal(teacherSurname("Hazrat Inayat Khan"), "Khan");
  assert.equal(teacherSurname("Nisragadatta"), "Nisargadatta");
  assert.equal(teacherSurname("Hakim Sinai"), "Sanai");
  assert.equal(teacherSurname("Ramana Maharshi"), "Ramana");
  assert.equal(teacherSurname(undefined), undefined);
  assert.equal(teacherSurname("  "), undefined);
});

test("uniqueTeacherSurnames counts distinct surnames, not distinct works", () => {
  // The Live Default bug: 3 References, only 2 teachers (Aurobindo ×2 + Aivanhov).
  const surnames = uniqueTeacherSurnames([
    { teacher: "Aurobindo" },
    { teacher: "Sri Aurobindo" },
    { teacher: "Aivanhov" },
  ]);
  assert.deepEqual(surnames, ["Aurobindo", "Aivanhov"]);
  assert.equal(surnames.length, 2);
});

test("uniqueTeacherSurnames treats Abdullah metadata and Dougan as one teacher", () => {
  const surnames = uniqueTeacherSurnames([
    { teacher: "Abdullah" },
    { teacher: "Dougan" },
    { teacher: "Abdullah Dougan" },
  ]);
  assert.deepEqual(surnames, ["Dougan"]);
});

test("three works from one teacher still count as one surname", () => {
  const surnames = uniqueTeacherSurnames([
    { teacher: "Gurdjieff" },
    { teacher: "G. I. Gurdjieff" },
    { teacher: "Gurdjieff" },
  ]);
  assert.deepEqual(surnames, ["Gurdjieff"]);
  assert.equal(
    shouldRetryForThreeTeachers("default", [], [
      { teacher: "Gurdjieff" },
      { teacher: "Gurdjieff" },
      { teacher: "Gurdjieff" },
    ]),
    true,
  );
});

test("uniqueTeacherSurnames keeps first-seen display form and ignores blanks", () => {
  const surnames = uniqueTeacherSurnames([
    { teacher: "Gurdjieff" },
    { teacher: "" },
    { teacher: "Tweedie" },
    { teacher: "G. I. Gurdjieff" },
    { teacher: "Dougan" },
  ]);
  assert.deepEqual(surnames, ["Gurdjieff", "Tweedie", "Dougan"]);
});

test("requiresThreeDistinctTeachers: Default always; Custom only at ≥3 surnames", () => {
  assert.equal(requiresThreeDistinctTeachers("default", []), true);
  assert.equal(requiresThreeDistinctTeachers("default", ["Aurobindo"]), true);
  assert.equal(requiresThreeDistinctTeachers("custom", ["Aurobindo"]), false);
  assert.equal(
    requiresThreeDistinctTeachers("custom", ["Aurobindo", "Aivanhov"]),
    false,
  );
  assert.equal(
    requiresThreeDistinctTeachers("custom", [
      "Aurobindo",
      "Aivanhov",
      "Gurdjieff",
    ]),
    true,
  );
});

test("shouldRetryForThreeTeachers after mergeCitations: Default Aurobindo×2 + Aivanhov", () => {
  const merged = mergeCitations(
    [
      { teacher: "Aurobindo", file: "The Life Divine" },
      { teacher: "Aurobindo", file: "Savitri" },
      { teacher: "Aivanhov", file: "The Yoga of Nutrition" },
    ],
    [
      { teacher: "Aurobindo", file: "The Life Divine" },
      { teacher: "Aurobindo", file: "Savitri" },
      { teacher: "Aivanhov", file: "The Yoga of Nutrition" },
    ],
  );
  assert.equal(uniqueTeacherSurnames(merged).length, 2);
  assert.equal(shouldRetryForThreeTeachers("default", [], merged), true);
  assert.equal(
    shouldRetryForThreeTeachers("custom", ["Aurobindo", "Aivanhov"], merged),
    false,
  );
  assert.equal(
    shouldRetryForThreeTeachers(
      "custom",
      ["Aurobindo", "Aivanhov", "Gurdjieff"],
      merged,
    ),
    true,
  );
});

test("shouldRetryForThreeTeachers is false when three distinct surnames are present", () => {
  const merged = [
    { teacher: "Aurobindo" },
    { teacher: "Aivanhov" },
    { teacher: "Tweedie" },
  ];
  assert.equal(shouldRetryForThreeTeachers("default", [], merged), false);
  assert.equal(
    shouldRetryForThreeTeachers(
      "custom",
      ["Aurobindo", "Aivanhov", "Tweedie"],
      merged,
    ),
    false,
  );
});

test("Custom 1–2 stays exempt even with a single citation", () => {
  const one = [{ teacher: "Aurobindo" }];
  assert.equal(
    shouldRetryForThreeTeachers("custom", ["Aurobindo"], one),
    false,
  );
  assert.equal(
    shouldRetryForThreeTeachers("custom", ["Aurobindo", "Aivanhov"], one),
    false,
  );
});

test("prompt + citation nudge require DISTINCT surnames, not three works", () => {
  assert.match(THREE_TEACHER_AUTHOR_RULE, /three DIFFERENT teachers/i);
  assert.match(THREE_TEACHER_AUTHOR_RULE, /distinct surnames/i);
  assert.match(THREE_TEACHER_AUTHOR_RULE, /Three works from one teacher do not count/i);
  assert.match(THREE_TEACHER_CITATION_NUDGE, /three DIFFERENT teachers/i);
  assert.match(THREE_TEACHER_CITATION_NUDGE, /Three works from one teacher do not count/i);
  assert.equal(
    citationNudgeForAsk("default", []),
    THREE_TEACHER_CITATION_NUDGE,
  );
  assert.equal(
    citationNudgeForAsk("custom", ["Aurobindo"]),
    NARROW_TEACHER_CITATION_NUDGE,
  );
  assert.equal(
    citationNudgeForAsk("custom", ["Aurobindo", "Aivanhov"]),
    NARROW_TEACHER_CITATION_NUDGE,
  );
  assert.equal(
    citationNudgeForAsk("custom", ["Aurobindo", "Aivanhov", "Gurdjieff"]),
    THREE_TEACHER_CITATION_NUDGE,
  );
  assert.doesNotMatch(NARROW_TEACHER_CITATION_NUDGE, /three DIFFERENT/i);
});

test("rewrite nudge forbids invented citations and names the missing surnames", () => {
  const nudge = threeTeacherRewriteNudge(["Aurobindo", "Aivanhov"]);
  assert.match(nudge, /REWRITE REQUIRED/);
  assert.match(nudge, /Aurobindo, Aivanhov/);
  assert.match(nudge, /THREE DIFFERENT teachers/i);
  assert.match(nudge, /do not invent/i);
  assert.match(nudge, /File Search/);
  assert.match(THREE_TEACHER_REWRITE_SYSTEM, /Do not invent sources/);
});

test("shouldKeepRewrite drops an empty or weaker rewrite instead of inventing cites", () => {
  assert.equal(shouldKeepRewrite(2, 3, true), true);
  assert.equal(shouldKeepRewrite(2, 2, true), true);
  assert.equal(shouldKeepRewrite(2, 1, true), false);
  assert.equal(shouldKeepRewrite(0, 2, true), true);
  assert.equal(shouldKeepRewrite(2, 3, false), false);
});

test("mergeRetrievedTextByFile keeps File Search grounding from both attempts", () => {
  const first = new Map([["aurobindo/life.md", "short"]]);
  const second = new Map([
    ["aurobindo/life.md", "a longer retrieved chunk"],
    ["aivanhov/yoga.md", "nutrition"],
  ]);
  const merged = mergeRetrievedTextByFile(first, second);
  assert.equal(merged.get("aurobindo/life.md"), "a longer retrieved chunk");
  assert.equal(merged.get("aivanhov/yoga.md"), "nutrition");
});

test("parseAskDepth: omitted / standard stay standard; depth deep or deepDive true is deep", () => {
  assert.equal(parseAskDepth({}), "standard");
  assert.equal(parseAskDepth({ depth: "standard" }), "standard");
  assert.equal(parseAskDepth({ depth: "deep" }), "deep");
  assert.equal(parseAskDepth({ deepDive: true }), "deep");
  assert.equal(parseAskDepth({ deepDive: false }), "standard");
  assert.equal(parseAskDepth({ depth: "standard", deepDive: true }), "standard");
  assert.equal(parseAskDepth({ depth: "other", deepDive: true }), "deep");
  assert.equal(parseAskDepth({ depth: "other" }), "standard");
});

const FIVE = ["Aurobindo", "Aivanhov", "Gurdjieff", "Tweedie", "Steiner"];
const TWO = FIVE.slice(0, 2);
const FOUR = FIVE.slice(0, 4);
const SEVEN = [...FIVE, "Rumi", "Ramdas"];

test("requiredMinDistinctTeachers: standard 3 / deep default 5; deep custom = selected count", () => {
  assert.equal(requiredMinDistinctTeachers("default", [], "standard"), 3);
  assert.equal(requiredMinDistinctTeachers("default", [], "deep"), 5);
  assert.equal(requiredMinDistinctTeachers("custom", ["Aurobindo"], "standard"), 0);
  assert.equal(requiredMinDistinctTeachers("custom", ["Aurobindo"], "deep"), 1);
  assert.equal(requiredMinDistinctTeachers("custom", TWO, "deep"), 2);
  assert.equal(requiredMinDistinctTeachers("custom", FOUR, "deep"), 4);
  assert.equal(requiredMinDistinctTeachers("custom", FIVE, "deep"), 5);
  assert.equal(requiredMinDistinctTeachers("custom", SEVEN, "deep"), 7);
  assert.equal(
    requiredMinDistinctTeachers("custom", ["Aurobindo", "Aivanhov", "Gurdjieff"], "standard"),
    3,
  );
});

test("shouldRetryForMinTeachers: deep Default retries below 5 surnames", () => {
  const four = [
    { teacher: "Aurobindo" },
    { teacher: "Aivanhov" },
    { teacher: "Gurdjieff" },
    { teacher: "Tweedie" },
  ];
  const five = [...four, { teacher: "Steiner" }];
  assert.equal(shouldRetryForMinTeachers("default", [], four, "deep"), true);
  assert.equal(shouldRetryForMinTeachers("default", [], five, "deep"), false);
  assert.equal(shouldRetryForMinTeachers("default", [], four, "standard"), false);
  assert.equal(
    shouldRetryForMinTeachers("custom", FIVE, four, "deep"),
    true,
  );
  assert.equal(
    shouldRetryForMinTeachers("custom", FOUR, [{ teacher: "Aurobindo" }], "deep"),
    true,
  );
  assert.equal(
    shouldRetryForMinTeachers("custom", TWO, [{ teacher: "Aurobindo" }], "deep"),
    true,
  );
  assert.equal(
    shouldRetryForMinTeachers(
      "custom",
      TWO,
      [{ teacher: "Aurobindo" }, { teacher: "Aivanhov" }],
      "deep",
    ),
    false,
  );
  assert.equal(
    shouldRetryForMinTeachers("custom", FOUR, four, "deep"),
    false,
  );
});

test("standard citation nudge is unchanged when depth is omitted or standard", () => {
  assert.equal(citationNudgeForAsk("default", []), THREE_TEACHER_CITATION_NUDGE);
  assert.equal(
    citationNudgeForAsk("default", [], "standard"),
    THREE_TEACHER_CITATION_NUDGE,
  );
  assert.equal(
    citationNudgeForAsk("custom", ["Aurobindo"]),
    NARROW_TEACHER_CITATION_NUDGE,
  );
  assert.equal(
    citationNudgeForAsk("custom", ["Aurobindo"], "standard"),
    NARROW_TEACHER_CITATION_NUDGE,
  );
  assert.doesNotMatch(citationNudgeForAsk("default", []), /1000/);
  assert.doesNotMatch(citationNudgeForAsk("default", [], "standard"), /five DIFFERENT/i);
});

test("deep citation nudge requires five teachers and ~1000 words when applicable", () => {
  assert.equal(
    citationNudgeForAsk("default", [], "deep"),
    DEEP_FIVE_TEACHER_CITATION_NUDGE,
  );
  const fiveCustom = citationNudgeForAsk("custom", FIVE, "deep");
  assert.match(fiveCustom, /1000–1400/);
  assert.match(fiveCustom, /all 5 selected teacher/);
  assert.match(fiveCustom, /Cite only within the selection/);
  assert.doesNotMatch(fiveCustom, /five DIFFERENT/i);
  const fourCustom = citationNudgeForAsk("custom", FOUR, "deep");
  assert.match(fourCustom, /1000–1400/);
  assert.match(fourCustom, /all 4 selected teacher/);
  assert.doesNotMatch(fourCustom, /five DIFFERENT/i);
  const twoCustom = citationNudgeForAsk("custom", TWO, "deep");
  assert.match(twoCustom, /all 2 selected teacher/);
  assert.doesNotMatch(twoCustom, /five DIFFERENT/i);
  assert.match(DEEP_FIVE_TEACHER_CITATION_NUDGE, /1000–1400/);
  assert.match(DEEP_FIVE_TEACHER_CITATION_NUDGE, /five DIFFERENT teachers/i);
  assert.match(DEEP_NARROW_TEACHER_CITATION_NUDGE, /1000–1400/);
  assert.doesNotMatch(DEEP_NARROW_TEACHER_CITATION_NUDGE, /five DIFFERENT/i);
  assert.match(DEEP_NARROW_TEACHER_CITATION_NUDGE, /Do not invent teachers/);
});

test("deep author rule and rewrite nudge: five surnames, no invented cites", () => {
  assert.equal(teacherAuthorRule("default", [], "deep"), FIVE_TEACHER_AUTHOR_RULE);
  assert.equal(teacherAuthorRule("default", [], "standard"), THREE_TEACHER_AUTHOR_RULE);
  assert.match(FIVE_TEACHER_AUTHOR_RULE, /five DIFFERENT teachers/i);
  assert.match(FIVE_TEACHER_AUTHOR_RULE, /four teachers, not five/);
  const nudge = rewriteNudgeForAsk(["Aurobindo", "Aivanhov"], "default", [], "deep");
  assert.match(nudge, /FIVE DIFFERENT teachers/i);
  assert.match(nudge, /1000–1400/);
  assert.match(nudge, /do not invent/i);
  assert.equal(rewriteSystemForAsk("default", [], "deep"), FIVE_TEACHER_REWRITE_SYSTEM);
  assert.equal(rewriteSystemForAsk("default", [], "standard"), THREE_TEACHER_REWRITE_SYSTEM);
  assert.match(FIVE_TEACHER_REWRITE_SYSTEM, /Do not invent sources/);
  assert.match(answerLengthInstruction("deep"), /1000–1400/);
  assert.match(answerLengthInstruction("standard"), /350–500/);
});

test("deep Custom requires the selected count and stays inside the selection", () => {
  const rule = teacherAuthorRule("custom", FOUR, "deep");
  assert.match(rule, /selected 4 teacher/);
  assert.match(rule, /all 4 selected teachers/);
  assert.match(rule, /do not invent authors outside that selection/i);
  assert.doesNotMatch(rule, /five DIFFERENT/i);
  const twoRule = teacherAuthorRule("custom", TWO, "deep");
  assert.match(twoRule, /all 2 selected teachers/);
  assert.doesNotMatch(twoRule, /five DIFFERENT/i);
  const sevenRule = teacherAuthorRule("custom", SEVEN, "deep");
  assert.match(sevenRule, /all 7 selected teachers/);
  assert.doesNotMatch(sevenRule, /five DIFFERENT/i);
  assert.equal(
    rewriteSystemForAsk("custom", FOUR, "deep"),
    customDeepRewriteSystem(["Aurobindo", "Aivanhov", "Gurdjieff", "Tweedie"]),
  );
  const rewrite = rewriteNudgeForAsk(["Aurobindo"], "custom", FOUR, "deep");
  assert.match(rewrite, /all 4 selected teacher/);
  assert.match(rewrite, /Cite only within the selection/);
  assert.doesNotMatch(rewrite, /THREE DIFFERENT/i);
  assert.doesNotMatch(rewrite, /FIVE DIFFERENT/i);
});

test("deep prefers gemini-3.5-flash; standard keeps lite first", () => {
  assert.deepEqual(modelCandidatesForDepth("standard"), [
    "gemini-3.5-flash-lite",
    "gemini-3.5-flash",
  ]);
  assert.deepEqual(modelCandidatesForDepth("deep"), [
    "gemini-3.5-flash",
    "gemini-3.5-flash-lite",
  ]);
});
