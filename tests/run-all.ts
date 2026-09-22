import { run } from "node:test"

const MANY_FILES = [
  "dist/tests/config.test.js",
  "dist/tests/classify.test.js",
  "dist/tests/cli.test.js",
  "dist/tests/workflow.test.js",
]

const counts = { pass: 0, fail: 0 }
const stream = await run({ files: MANY_FILES })
for await (const ev of stream) {
  if (ev.type !== "test:stderr") continue
  let inner: { type?: string, data?: { message?: string } } | undefined
  try {
    inner = JSON.parse(ev.data.message) as typeof inner
  } catch {
    continue
  }
  if (inner?.type !== "test:diagnostic") continue
  const message = inner.data?.message ?? ""
  const match = /^(pass|fail|cancelled) ([0-9]+)/.exec(message)
  if (match) {
    const key = match[1] === "pass" || match[1] === "cancelled" ? "pass" : "fail"
    counts[key] += Number(match[2])
  }
}
console.log(`tests: ${counts.pass} passed, ${counts.fail} failed`)
process.exit(counts.fail > 0 ? 1 : 0)