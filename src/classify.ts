export type Verdict = "COMPLETE" | "MISSING_CONTEXT"

export type Transport = {
  post: (url: string, headers: { [k: string]: string }, body: string) => Promise<FetchResult>
}

export type FetchResult = {
  status: number
  body: unknown
}

export const DEFAULT_TIMEOUT_MS = 120_000

export class RequestTimeoutError extends Error {}

export function realFetch(opts: { timeoutMs?: number } = {}) {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  return {
    async post(url: string, headers: { [k: string]: string }, payload: string) {
      let text: string
      let status: number
      try {
        const res = await fetch(url, {
          method: "POST",
          headers,
          body: payload,
          signal: AbortSignal.timeout(timeoutMs),
        })
        status = res.status
        text = await res.text()
      } catch (err) {
        if (err instanceof DOMException && err.name === "TimeoutError") {
          throw new RequestTimeoutError(`OpenRouter request timed out after ${timeoutMs / 1000}s`)
        }
        throw err
      }
      let body: unknown
      try {
        body = JSON.parse(text)
      } catch {
        body = text
      }
      return { status, body }
    },
  }
}

export function classify(transport: unknown, request: { endpoint: string, headers: { [k: string]: string }, body: string }) {
  const t = transport as Transport
  return t.post(request.endpoint, request.headers, request.body)
}

export function parseResponse(payload: unknown) {
  if (typeof payload !== "object" || payload === null) {
    return { error: "response is not a JSON object" }
  }
  const obj: { [k: string]: unknown } = payload as { [k: string]: unknown }
  const error = obj.error
  if (error !== undefined) {
    const message =
      typeof error === "object" && error !== null
        ? (error as { message: unknown }).message
        : `${error}`
    return { error: typeof message === "string" ? message : "unknown API error" }
  }
  const choices = obj.choices
  if (!Array.isArray(choices) || choices.length === 0) {
    return { error: "response contains no choices" }
  }
  const first = choices[0] as { [k: string]: unknown }
  const message = first.message
  if (typeof message !== "object" || message === null) {
    return { error: "first choice has no message" }
  }
  const content = (message as { [k: string]: unknown }).content
  if (typeof content !== "string") {
    return { error: "message content is not a string" }
  }
  return { text: content }
}

export function parseVerdict(text: string) {
  const m = text.match(/\bVERDICT:\s*(COMPLETE|MISSING_CONTEXT)\b/i)
  return m ? (m[1]!.toUpperCase() as Verdict) : null
}

export function parseRationale(text: string) {
  const m = text.match(/RATIONALE:\s*([^\n]+)/i)
  return m ? m[1]!.trim() : ""
}

export function parseQuestions(text: string) {
  const lines = text.split("\n")
  const out: string[] = []
  let inList = false
  for (const line of lines) {
    const trimmed = line.trim()
    if (/^CLARIFYING_QUESTIONS:/i.test(trimmed)) {
      inList = true
      continue
    }
    if (inList) {
      if (trimmed.length === 0) continue
      if (/^[-*] /.test(trimmed)) {
        out.push(trimmed.replace(/^[-*] /, "").trim())
      } else if (out.length > 0 && !/^[A-Z]+:/i.test(trimmed)) {
        out.push(trimmed)
      }
    }
  }
  return out
}

export function toClassification(
  text: string,
  ctx: { model: string, prNumber?: string, question: string, latencyMs: number }
) {
  const verdict = parseVerdict(text) ?? "COMPLETE"
  const clarifyingQuestions = parseQuestions(text)
  const cleaned =
    verdict === "COMPLETE"
      ? clarifyingQuestions.filter((q) => q !== "none" && q.length > 0)
      : clarifyingQuestions
  return {
    verdict,
    rationale: parseRationale(text),
    clarifyingQuestions: cleaned,
    model: ctx.model,
    ...(ctx.prNumber ? { prNumber: ctx.prNumber } : {}),
    question: ctx.question,
    latencyMs: ctx.latencyMs,
  }
}