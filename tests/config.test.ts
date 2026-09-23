import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { parseConfig, loadConfig, fetchKey, ConfigError } from "../src/config.js"
import { extractFence, loadSystemPrompt } from "../src/prompt.js"

async function tempDir() {
  return mkdtemp(join(tmpdir(), "prcc-"))
}

test("parseConfig rejects invalid JSON", () => {
  assert.throws(() => parseConfig("not json"), ConfigError)
})

test("parseConfig rejects missing key field", () => {
  assert.throws(() => parseConfig("{}"), ConfigError)
})

test("parseConfig reads keyCommand", () => {
  const config = parseConfig(`{"keyCommand": "cat ~/.openrouter-key"}`)
  assert.equal(config.keyCommand, "cat ~/.openrouter-key")
})

test("parseConfig accepts legacy alias", () => {
  const config = parseConfig(`{"openRouterKeyCommand": "cat /tmp/key"}`)
  assert.equal(config.keyCommand, "cat /tmp/key")
})

test("parseConfig prefers keyCommand over alias", () => {
  const config = parseConfig(`{"openRouterKeyCommand": "cat /tmp/a", "keyCommand": "cat /tmp/b"}`)
  assert.equal(config.keyCommand, "cat /tmp/b")
})

test("loadConfig reads a file", async () => {
  const dir = await tempDir()
  const path = join(dir, "config.json")
  await writeFile(path, `{"keyCommand": "cat /tmp/x"}`, "utf8")
  const config = await loadConfig(path)
  assert.equal(config.keyCommand, "cat /tmp/x")
})

test("fetchKey runs a bash command and trims stdout", async () => {
  const dir = await tempDir()
  const keyFile = join(dir, "key")
  await writeFile(keyFile, "sk-abc123\n", "utf8")
  const key = await fetchKey(`cat ${keyFile}`)
  assert.equal(key, "sk-abc123")
})

test("fetchKey throws on empty stdout", () => {
  assert.throws(
    () => fetchKey("cat /nonexistent/key 2>/dev/null || true"),
    (err: unknown) => err instanceof ConfigError
  )
})

test("extractFence pulls the prompt body", () => {
  const text = "intro\n```text\nhello world\n```\ntrailer"
  assert.equal(extractFence(text), "hello world")
})
// Terms from the special-calibration block that issue #2 removed. A prompt
// that names them encodes one eval case's answer, not a general rule.
const EVAL_CASE_TERMS = ["calibration", "staging-health", "gh debug", "successor"]

test("system prompt names no term from a single eval case", async () => {
  const prompt = (await loadSystemPrompt()).toLowerCase()
  const found = EVAL_CASE_TERMS.filter((term) => prompt.includes(term))
  assert.deepEqual(found, [])
})

// The two checks a study of body edits found missing, each pinned by a phrase
// only that check carries. Deleting a check fails here rather than silently
// costing recall. A reworded check needs its entry updated, which is the point:
// the phrase is the contract between the prompt and its evidence.
const REQUIRED_CHECKS = [
  { name: "blast radius", phrase: "how long it was broken" },
  { name: "negative scope", phrase: "deliberately does not touch" },
]

test("system prompt carries every check a body edit supplies", async () => {
  const prompt = (await loadSystemPrompt()).toLowerCase()
  const missing = REQUIRED_CHECKS.filter((c) => !prompt.includes(c.phrase)).map((c) => c.name)
  assert.deepEqual(missing, [])
})

// A check with no limit fires on every body, which is the failure the removed
// special-calibration block had in reverse: it named one case, an unbounded
// check names none. So each check states when it does not apply, and the
// carve-out is pinned by wording that appears nowhere else. Pinning a phrase
// shared with the main clause would let a deleted carve-out pass.
const BOUNDS = [
  { check: "blast radius", phrase: "this check does not apply" },
  { check: "negative scope", phrase: "has nothing to list" },
]

test("every new check states its own limit", async () => {
  const prompt = (await loadSystemPrompt()).toLowerCase()
  const unbounded = BOUNDS.filter((b) => !prompt.includes(b.phrase)).map((b) => b.check)
  assert.deepEqual(unbounded, [])
})
