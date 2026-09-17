import { readFileSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { loadConfig, fetchKey, defaultConfigPath, ConfigError } from "./config.js"
import { loadSystemPrompt, DEFAULT_USER_QUESTION, DEFAULT_MODEL, OPENROUTER_ENDPOINT } from "./prompt.js"
import { classify, parseResponse, toClassification, realFetch } from "./classify.js"

const USAGE = `pr-context-classifier

Classifies a pull request body as COMPLETE or MISSING_CONTEXT, and writes
author-facing clarifying questions when context is missing. Uses
openai/gpt-oss-20b (bare routing) through OpenRouter.

Usage:
  pr-context-classifier [options] [PR-BODY-FILE]
  pr-context-classifier [options] -

Options:
  -q <text>      reader question (default: built-in question)
  -n <number>    PR number, echoed in the output
  -m <slug>      model id (default: openai/gpt-oss-20b)
  -c <path>      path to config file
  -h             show this help
  -              read PR body from stdin

The config file holds keyCommand, a bash command whose stdout is the
OpenRouter key. The key never appears in the config file itself.

Example config (~/.config/pr-context-classifier/config.json):
  {"keyCommand": "cat ~/.secrets/openrouter-key"}
`

type CliOptions = {
  question: string
  prNumber?: string
  model: string
  configPath: string
  bodyFile?: string
  readStdin: boolean
}

function usageError(message: string): never {
  console.error(`error: ${message}`)
  console.error(USAGE)
  process.exit(2)
}

export function parseArgs(argv: string[]): CliOptions {
  let question = DEFAULT_USER_QUESTION
  let prNumber: string | undefined
  let model = DEFAULT_MODEL
  let configPath = defaultConfigPath()
  let bodyFile: string | undefined
  let readStdin = false
  let i = 0
  while (i < argv.length) {
    const arg = argv[i]!
    if (arg === "-h") {
      console.log(USAGE)
      process.exit(0)
    } else if (arg === "-q") {
      const value = argv[++i]
      if (!value) usageError("-q needs a value")
      question = value
    } else if (arg === "-n") {
      const value = argv[++i]
      if (!value) usageError("-n needs a value")
      prNumber = value
    } else if (arg === "-m") {
      const value = argv[++i]
      if (!value) usageError("-m needs a value")
      model = value
    } else if (arg === "-c") {
      const value = argv[++i]
      if (!value) usageError("-c needs a value")
      configPath = value
    } else if (arg === "-") {
      readStdin = true
    } else if (arg.length > 1 && arg.startsWith("-")) {
      usageError(`unknown flag: ${arg}`)
    } else {
      if (bodyFile) usageError("only one PR body file is allowed")
      bodyFile = arg
    }
    i++
  }
  return { question, prNumber, model, configPath, bodyFile, readStdin }
}

async function readBody(opts: CliOptions) {
  if (opts.readStdin || opts.bodyFile === undefined) {
    const data = readFileSync("/dev/stdin")
    return data.toString("utf8")
  }
  try {
    return await readFile(opts.bodyFile, "utf8")
  } catch (err) {
    throw new ConfigError(`cannot read PR body file ${opts.bodyFile}: ${(err as Error).message}`)
  }
}

async function resolveKey(opts: CliOptions) {
  const fromEnv = process.env.OPENROUTER_API_KEY
  if (typeof fromEnv === "string" && fromEnv.trim().length > 0) {
    return fromEnv.trim()
  }
  const config = await loadConfig(opts.configPath)
  return fetchKey(config.keyCommand)
}

export async function main(argv: string[]) {
  try {
    const opts = parseArgs(argv)
    const body = (await readBody(opts)).trim()
    if (body.length === 0) {
      usageError("PR body is empty")
    }
    const apiKey = await resolveKey(opts)
    const systemPrompt = await loadSystemPrompt()
    const request = {
      endpoint: OPENROUTER_ENDPOINT,
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: opts.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `${opts.question}\n\nPR BODY:\n${body}` },
        ],
        temperature: 0,
      }),
    }
    const started = Date.now()
    const result = await classify(realFetch(), request)
    const latencyMs = Date.now() - started
    if (result.status !== 200) {
      console.error(`error: OpenRouter returned HTTP ${result.status}`)
      process.exit(1)
    }
    const parsed = parseResponse(result.body)
    if (parsed.error) {
      console.error(`error: ${parsed.error}`)
      process.exit(1)
    }
    const classification = toClassification(parsed.text ?? "", {
      model: opts.model,
      ...(opts.prNumber ? { prNumber: opts.prNumber } : {}),
      question: opts.question,
      latencyMs,
    })
    console.log(JSON.stringify(classification, null, 2))
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`error: ${err.message}`)
      process.exit(1)
    }
    throw err
  }
}

if (import.meta.main) {
  await main(process.argv.slice(1))
}