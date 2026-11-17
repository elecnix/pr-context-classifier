import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const PROMPT_FILE = "prompt/classifier-prompt.md"

export const DEFAULT_USER_QUESTION =
  "Does this pull-request body give a reader complete context to understand what the PR is about and exactly what changed, without reading code or the diff?"
export const DEFAULT_MODEL = "openai/gpt-oss-20b"
export const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions"

/** Reads the system prompt from `path`, or from the built-in prompt file
 *  when no path is given. Either file keeps the prompt in a ```text fence. */
export async function loadSystemPrompt(path = builtInPromptPath()) {
  try {
    const text = await readFile(path, "utf8")
    return extractFence(text)
  } catch (err) {
    throw new Error(`cannot load classifier prompt at ${path}: ${(err as Error).message}`)
  }
}

export function builtInPromptPath() {
  const here = dirname(fileURLToPath(import.meta.url))
  return join(here, "..", "..", PROMPT_FILE)
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