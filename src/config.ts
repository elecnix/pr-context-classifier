import { execFileSync } from "node:child_process"
import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

export const CONFIG_DIR = ".config/pr-context-classifier"
export const CONFIG_FILE_NAME = "config.json"

export type Config = {
  keyCommand: string
}

export function defaultConfigPath() {
  return join(homedir(), CONFIG_DIR, CONFIG_FILE_NAME)
}

/** Parse a config file body. Accepts keyCommand, or openRouterKeyCommand
 *  as a legacy alias. keyCommand wins when both are present. */
export function parseConfig(text: string) {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (err) {
    throw new ConfigError(`config is not valid JSON: ${(err as Error).message}`)
  }
  if (typeof raw !== "object" || raw === null) {
    throw new ConfigError("config root must be a JSON object")
  }
  const obj = raw as { [k: string]: unknown }
  const keyCommand = obj.keyCommand ?? obj.openRouterKeyCommand
  if (typeof keyCommand !== "string" || keyCommand.trim().length === 0) {
    throw new ConfigError("config must contain keyCommand, a bash command whose stdout is the OpenRouter key")
  }
  return { keyCommand }
}

export async function loadConfig(path: string) {
  let text: string
  try {
    text = await readFile(path, "utf8")
  } catch {
    throw new ConfigError(`no config file at ${path}`)
  }
  return parseConfig(text)
}

// Resolve a key by running its command through bash and taking stdout.
export function fetchKey(command: string) {
  let stdout: string
  try {
    stdout = execFileSync("/bin/bash", ["-c", command], {
      encoding: "utf8",
      env: process.env,
    })
  } catch (err) {
    throw new ConfigError(`keyCommand failed: ${(err as Error).message}`)
  }
  const key = stdout.trim()
  if (key.length === 0) {
    throw new ConfigError("keyCommand produced empty output on stdout")
  }
  return key
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ConfigError"
  }
}