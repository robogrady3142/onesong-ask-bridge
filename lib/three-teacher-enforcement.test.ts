import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeCitations } from "./question-citations.ts";
import {
  NARROW_TEACHER_CITATION_NUDGE,
  THREE_TEACHER_AUTHOR_RULE,
  THREE_TEACHER_CITATION_NUDGE,
  THREE_TEACHER_REWRITE_SYSTEM,
  citationNudgeForAsk,
  mergeRetrievedTextByFile,
  requiresThreeDistinctTeachers,
  shouldKeepRewrite,
  shouldRetryForThreeTeachers,
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
