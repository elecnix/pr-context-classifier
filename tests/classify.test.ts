import { test } from "node:test"
import assert from "node:assert/strict"
import { parseResponse, parseVerdict, parseRationale, parseQuestions, toClassification } from "../src/classify.js"

const MISSING_TEXT = `VERDICT: MISSING_CONTEXT
RATIONALE: the body lowers the cache TTL but never describes the stale data it fixes.
CLARIFYING_QUESTIONS:
- What stale data did users see before the TTL change, and how was it noticed?
- Who consumes the status, and at what decision point?`

const COMPLETE_TEXT = `VERDICT: COMPLETE
RATIONALE: the body states the old behavior, the new behavior, the mechanism, the rationale, and the effect.
CLARIFYING_QUESTIONS: none`

test("parseVerdict reads the verdict line", () => {
  assert.equal(parseVerdict(MISSING_TEXT), "MISSING_CONTEXT")
  assert.equal(parseVerdict(COMPLETE_TEXT), "COMPLETE")
  assert.equal(parseVerdict("no verdict here"), null)
})

test("parseRationale reads the rationale line", () => {
  assert.equal(
    parseRationale(MISSING_TEXT),
    "the body lowers the cache TTL but never describes the stale data it fixes."
  )
})

test("parseQuestions collects bullet questions only", () => {
  const questions = parseQuestions(MISSING_TEXT)
  assert.equal(questions.length, 2)
  assert.ok(questions[0]!.includes("stale data"))
  assert.ok(!questions[0]!.includes("- "))
})

test("parseQuestions on COMPLETE has no list", () => {
  assert.deepEqual(parseQuestions(COMPLETE_TEXT), [])
})

test("toClassification builds the structured output", () => {
  const out = toClassification(MISSING_TEXT, {
    model: "openai/gpt-oss-20b",
    question: "does it have context?",
    latencyMs: 1234,
  })
  assert.equal(out.verdict, "MISSING_CONTEXT")
  assert.equal(out.model, "openai/gpt-oss-20b")
  assert.equal(out.latencyMs, 1234)
  assert.equal(out.clarifyingQuestions.length, 2)
})

test("toClassification passes prNumber through", () => {
  const out = toClassification(COMPLETE_TEXT, {
    model: "openai/gpt-oss-20b",
    prNumber: "42",
    question: "does it have context?",
    latencyMs: 5,
  })
  assert.equal(out.prNumber, "42")
  assert.equal(out.clarifyingQuestions.length, 0)
})

test("parseResponse reads content from a chat payload", () => {
  const payload = {
    choices: [{ message: { content: "VERDICT: COMPLETE\nRATIONALE: good" } }],
  }
  assert.equal(parseResponse(payload).text, "VERDICT: COMPLETE\nRATIONALE: good")
})

test("parseResponse reports API errors", () => {
  const payload = { error: { message: "rate limit hit" } }
  assert.equal(parseResponse(payload).error, "rate limit hit")
})

test("parseResponse handles empty choices", () => {
  assert.equal(parseResponse({ choices: [] }).error, "response contains no choices")
})