# pr-context-classifier

A CLI that reads a pull request body and reports whether the body gives a
reader complete context: what the PR is about and exactly what changed.
When context is missing, it writes author-facing clarifying questions.

The classifier runs on `openai/gpt-oss-20b` with bare routing through
OpenRouter. The system prompt is the artifact measured by an Ori Eval on
2026-09-17. Its provenance and the measurement are in Appendix A.

## Install

Requires Node 22 or newer.

```bash
npm install -g .
```

The config file must exist at `~/.config/pr-context-classifier/config.json`.
It stores one field, `keyCommand`. The CLI runs it through bash and uses
stdout as the OpenRouter key. The key itself never appears in the config
file.

```json
{
  "keyCommand": "cat ~/.secrets/openrouter-key"
}
```

Put the key in the file the command reads, and restrict its permissions.

```bash
umask 077
printf '%s' "$OPENROUTER_API_KEY" > ~/.secrets/openrouter-key
```

## Usage

```bash
# classify a body file
pr-context-classifier body.md

# classify PR 1909's body piped on stdin
pr-context-classifier -n 1909 - < body.md

# custom question and model
pr-context-classifier -q "Does this explain the change?" -m openai/gpt-oss-20b body.md
```

Output is one JSON document on stdout.

```json
{
  "verdict": "MISSING_CONTEXT",
  "rationale": "the body describes the staging-health status but no publisher for it.",
  "clarifyingQuestions": [
    "Which actor or workflow step publishes the staging-health status?"
  ],
  "model": "openai/gpt-oss-20b",
  "prNumber": "1909",
  "question": "Does this pull-request body give a reader complete context to understand what the PR is about and exactly what changed, without reading code or the diff?",
  "latencyMs": 25935
}
```

`verdict` is `COMPLETE` or `MISSING_CONTEXT`. `clarifyingQuestions` is empty
for `COMPLETE`.

## Options

| Flag | Meaning |
| -- | -- |
| `-q <text>` | reader question (default: built-in question) |
| `-n <number>` | PR number, echoed in the output |
| `-m <slug>` | model id (default: `openai/gpt-oss-20b`) |
| `-c <path>` | config file path |
| `-h` | help |
| `-` | read the body from stdin |

## Key resolution

1. If `OPENROUTER_API_KEY` is set, it wins.
2. Otherwise the CLI reads the config file, runs `keyCommand` through bash,
   and trims stdout for the key.

The config file is the only place that specifies the command. Credentials
stay in the file the command reads, so nothing in it is a credential.

## Tests

```bash
npm test
```

The tests cover config parsing, the bash key resolution, prompt loading,
response parsing, and argument parsing. They never call the network.

## Appendix A: prompt provenance

The system prompt in `prompt/classifier-prompt.md` is the exact text measured
by an Ori Eval run on 2026-09-17. The eval used eleven real PR bodies, one
labeled `missing-context` and ten labeled `complete`. The passing candidates
(Kimi K3, GPT-OSS 20B, DeepSeek V4 Flash, Ling Flash) were measured on the
eleven-case sweep. GPT-OSS 20B scored 11 of 11 label matches with the lowest
average latency and lowest cost, so the CLI defaults to it.