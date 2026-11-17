import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "../src/cli.js"
import { loadSystemPrompt } from "../src/prompt.js"

const BIN = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "bin", "pr-context-classifier.mjs")

function promptFile(text: string) {
  const dir = mkdtempSync(join(tmpdir(), "pcc-prompt-"))
  const path = join(dir, "card-prompt.md")
  writeFileSync(path, text)
  return path
}

test("parseArgs leaves the prompt path unset by default", () => {
  assert.equal(parseArgs([]).promptPath, undefined)
})

test("parseArgs reads a prompt file path with -p", () => {
  assert.equal(parseArgs(["-p", "my-prompt.md", "-"]).promptPath, "my-prompt.md")
})

test("loadSystemPrompt reads the text fence of the given file", async () => {
  const path = promptFile("Notes for people.\n\n```text\nYou review cards.\n```\n")
  assert.equal(await loadSystemPrompt(path), "You review cards.")
})

test("loadSystemPrompt names the path of a file that does not exist", async () => {
  await assert.rejects(loadSystemPrompt("/nonexistent/card-prompt.md"), /cannot load classifier prompt at \/nonexistent\/card-prompt\.md/)
})

test("loadSystemPrompt names the path of a file without a text fence", async () => {
  const path = promptFile("Only prose, no fence.\n")
  await assert.rejects(loadSystemPrompt(path), (err: Error) => {
    assert.match(err.message, /has no ```text fence/)
    assert.ok(err.message.includes(path), err.message)
    return true
  })
})

test("the bin script rejects -p without a value", () => {
  const result = spawnSync(process.execPath, [BIN, "-p"], { encoding: "utf8" })
  assert.equal(result.status, 2)
  assert.match(result.stderr, /-p needs a value/)
})

test("the bin script reports a missing prompt file before it looks for a key", () => {
  const env = { ...process.env, OPENROUTER_API_KEY: "" }
  const result = spawnSync(process.execPath, [BIN, "-c", "/nonexistent/config.json", "-p", "/nonexistent/card-prompt.md", "-"], { encoding: "utf8", input: "A body.", env })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /cannot load classifier prompt at \/nonexistent\/card-prompt\.md/)
})
