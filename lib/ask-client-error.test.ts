import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GENERIC_ASK_ERROR,
  HIGH_DEMAND_CODE,
  HIGH_DEMAND_ERROR,
  classifyAskModelExhaustion,
  clientSafeError,
  containsRawApiJson,
  isHighDemandError,
  scrubError,
} from "./ask-client-error.ts";

const GEMINI_503_JSON =
  '{"error":{"code":503,"message":"This model is currently experiencing high demand. Please try again later.","status":"UNAVAILABLE"}}';

class FakeApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

test("isHighDemandError: ApiError status 503", () => {
  assert.equal(isHighDemandError(new FakeApiError(GEMINI_503_JSON, 503)), true);
});

test("isHighDemandError: raw Gemini JSON string with UNAVAILABLE", () => {
  assert.equal(isHighDemandError(GEMINI_503_JSON), true);
});

test("isHighDemandError: prefixed model + JSON blob", () => {
  assert.equal(
    isHighDemandError(`gemini-3.5-flash-lite: ${GEMINI_503_JSON}`),
    true,
  );
});

test("isHighDemandError: nested error object", () => {
  assert.equal(
    isHighDemandError({
      error: { code: 503, message: "The model is overloaded.", status: "UNAVAILABLE" },
    }),
    true,
  );
});

test("isHighDemandError: high demand / overloaded copy", () => {
  assert.equal(isHighDemandError("The service is experiencing high demand."), true);
  assert.equal(isHighDemandError("The model is overloaded. Please try again later."), true);
  assert.equal(isHighDemandError("UNAVAILABLE"), true);
});

test("isHighDemandError: other Gemini failures stay false", () => {
  const invalidKey =
    '{"error":{"code":400,"message":"API key not valid.","status":"INVALID_ARGUMENT"}}';
  assert.equal(isHighDemandError(invalidKey), false);
  assert.equal(isHighDemandError(new FakeApiError("API key not valid.", 400)), false);
  assert.equal(isHighDemandError("gemini-3.5-flash: empty answer"), false);
  assert.equal(isHighDemandError("All models failed."), false);
  assert.equal(isHighDemandError(null), false);
});

test("classifyAskModelExhaustion: all 503s become high_demand without raw JSON", () => {
  const failure = classifyAskModelExhaustion(
    [
      new FakeApiError(GEMINI_503_JSON, 503),
      new FakeApiError('{"error":{"code":503,"status":"UNAVAILABLE"}}', 503),
    ],
    `gemini-3.5-flash: ${GEMINI_503_JSON}`,
  );
  assert.equal(failure.ok, false);
  assert.equal(failure.code, HIGH_DEMAND_CODE);
  assert.equal(failure.error, HIGH_DEMAND_ERROR);
  assert.equal(failure.status, 503);
  assert.equal(containsRawApiJson(failure.error), false);
  assert.doesNotMatch(failure.error, /\{/);
  assert.doesNotMatch(failure.error, /UNAVAILABLE/);
});

test("classifyAskModelExhaustion: mixed failures keep code error and strip JSON", () => {
  const failure = classifyAskModelExhaustion(
    [new FakeApiError(GEMINI_503_JSON, 503), "gemini-3.5-flash: empty answer"],
    `gemini-3.5-flash-lite: ${GEMINI_503_JSON}`,
  );
  assert.equal(failure.code, "error");
  assert.equal(failure.status, 502);
  assert.equal(containsRawApiJson(failure.error), false);
  assert.doesNotMatch(failure.error, /"status"\s*:\s*"UNAVAILABLE"/);
});

test("classifyAskModelExhaustion: empty answers stay code error", () => {
  const failure = classifyAskModelExhaustion(
    ["gemini-3.5-flash-lite: empty answer"],
    "gemini-3.5-flash-lite: empty answer",
  );
  assert.equal(failure.code, "error");
  assert.equal(failure.error, "gemini-3.5-flash-lite: empty answer");
  assert.equal(failure.status, 502);
});

test("clientSafeError never returns raw Gemini JSON", () => {
  assert.equal(clientSafeError(GEMINI_503_JSON), HIGH_DEMAND_ERROR);
  assert.equal(
    clientSafeError(
      '{"error":{"code":400,"message":"API key not valid.","status":"INVALID_ARGUMENT"}}',
    ),
    GENERIC_ASK_ERROR,
  );
  assert.equal(clientSafeError("Please enter a question."), "Please enter a question.");
});

test("scrubError redacts API key material", () => {
  const key = "AIzaSyDummyTestKeyMaterial99";
  assert.equal(scrubError(`failed ${key}`, key), "failed [redacted]");
  assert.doesNotMatch(clientSafeError(`boom ${key} ${GEMINI_503_JSON}`, key), /AIzaSy/);
});
