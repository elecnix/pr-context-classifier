import { test } from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const WORKFLOW_FILE = ".claude/workflows/pr-context-sweep.js"

async function loadWorkflow() {
  const here = dirname(fileURLToPath(import.meta.url))
  return readFile(join(here, "..", "..", WORKFLOW_FILE), "utf8")
}

/** The runner requires meta to be a literal with no variable references.
 *  Brace-matching keeps the extraction independent of formatting. */
function extractMetaSource(text: string) {
  const start = text.indexOf("export const meta =")
  assert.notEqual(start, -1, "script has no exported meta")
  const open = text.indexOf("{", start)
  let depth = 0
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i]
    if (ch === "{") depth += 1
    if (ch === "}") {
      depth -= 1
      if (depth === 0) return text.slice(open, i + 1)
    }
  }
  throw new Error("meta literal is unbalanced")
}

/** Evaluating in an empty scope proves the literal references nothing. */
function evalMeta(source: string) {
  return new Function(`return (${source})`)() as {
    name?: string
    description?: string
    phases?: { title?: string }[]
  }
}

function phaseTitles(text: string) {
  const titles = new Set<string>()
  for (const m of text.matchAll(/\bphase\(\s*["'`]([^"'`]+)["'`]\s*\)/g)) titles.add(m[1]!)
  for (const m of text.matchAll(/\bphase:\s*["'`]([^"'`]+)["'`]/g)) titles.add(m[1]!)
  return [...titles]
}

test("meta is a pure literal naming the workflow", async () => {
  const meta = evalMeta(extractMetaSource(await loadWorkflow()))
  assert.equal(typeof meta.name, "string")
  assert.equal(typeof meta.description, "string")
  assert.ok(Array.isArray(meta.phases) && meta.phases.length > 0)
})

test("meta declares every phase the script starts", async () => {
  const text = await loadWorkflow()
  const declared = new Set((evalMeta(extractMetaSource(text)).phases ?? []).map((p) => p.title))
  for (const title of phaseTitles(text)) {
    assert.ok(declared.has(title), `phase ${title} is missing from meta.phases`)
  }
})

test("subagents run on Haiku unless the caller overrides it", async () => {
  const text = await loadWorkflow()
  assert.match(text, /MODEL\s*=\s*cfg\.model\s*\|\|\s*["']haiku["']/)
  const agents = [...text.matchAll(/\bagent\(/g)].length
  const models = [...text.matchAll(/\bmodel:/g)].length
  assert.ok(models >= agents, `${agents} agent calls but only ${models} pass a model`)
})

test("the subagent reads the measured prompt instead of a copy", async () => {
  assert.match(await loadWorkflow(), /prompt\/classifier-prompt\.md/)
})

test("the sweep needs no OpenRouter key", async () => {
  const text = await loadWorkflow()
  assert.doesNotMatch(text, /openrouter/i)
  assert.doesNotMatch(text, /keyCommand/)
})

test("comments carry a marker so reruns skip posted PRs", async () => {
  assert.match(await loadWorkflow(), /<!--\s*pr-context-classifier[^>]*-->/)
})
