import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const PROMPT_FILE = "prompt/classifier-prompt.md"

export const DEFAULT_USER_QUESTION =
  "Does this pull-request body give a reader complete context to understand what the PR is about and exactly what changed, without reading code or the diff?"
export const DEFAULT_MODEL = "openai/gpt-oss-20b"
export const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions"

export async function loadSystemPrompt() {
  const here = dirname(fileURLToPath(import.meta.url))
  const path = join(here, "..", "..", PROMPT_FILE)
  try {
    const text = await readFile(path, "utf8")
    return extractFence(text)
  } catch (err) {
    throw new Error(`cannot load classifier prompt at ${path}: ${(err as Error).message}`)
  }
}

/** The prompt file stores the artifact inside a fenced code block so
 *  prose linters skip it. This extracts the block body. */
export function extractFence(text: string) {
  const match = text.match(/```text\r?\n([\s\S]*?)\r?\n```/)
  if (!match) {
    throw new Error("prompt file has no ```text fence")
  }
  return match[1]!.trim()
}