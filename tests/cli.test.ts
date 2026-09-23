import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "../src/cli.js"

const BIN = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "bin", "pr-context-classifier.mjs")

test("parseArgs defaults", () => {
  const opts = parseArgs([])
  assert.equal(opts.question.length > 0, true)
  assert.equal(opts.model, "openai/gpt-oss-20b")
  assert.equal(opts.readStdin, false)
  assert.equal(opts.bodyFile, undefined)
})

test("parseArgs reads a body file", () => {
  const opts = parseArgs(["body.md"])
  assert.equal(opts.bodyFile, "body.md")
})

test("parseArgs reads stdin with dash", () => {
  const opts = parseArgs(["-"])
  assert.equal(opts.readStdin, true)
})

test("parseArgs parses short flags", () => {
  const opts = parseArgs(["-q", "question?", "-n", "42", "-m", "model/x", "body.md"])
  assert.equal(opts.question, "question?")
  assert.equal(opts.prNumber, "42")
  assert.equal(opts.model, "model/x")
  assert.equal(opts.bodyFile, "body.md")
})
test("the bin script passes a body file argument through", () => {
  const result = spawnSync(process.execPath, [BIN, "/nonexistent/body.md"], { encoding: "utf8" })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /cannot read PR body file \/nonexistent\/body\.md/)
})
