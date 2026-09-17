import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { parseConfig, loadConfig, fetchKey, ConfigError } from "../src/config.js"
import { extractFence } from "../src/prompt.js"

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