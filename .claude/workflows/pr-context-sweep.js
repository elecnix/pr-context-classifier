// Sweeps a repository's pull requests through the classifier prompt and posts
// the clarifying questions it produces. A Claude Code subagent reads
// prompt/classifier-prompt.md and answers under it, so the sweep needs no model
// API key of its own and no CLI build.
//
// Run it with the Workflow tool:
//   Workflow({name: 'pr-context-sweep'})
//   Workflow({name: 'pr-context-sweep', args: {post: true}})
//   Workflow({name: 'pr-context-sweep', args: {repo: 'owner/name', state: 'all', limit: 25}})

export const meta = {
  name: 'pr-context-sweep',
  description: 'Classify every open PR body in a repo, then post clarifying questions where context is missing',
  phases: [
    { title: 'Discover', detail: 'list the pull requests to sweep' },
    { title: 'Classify', detail: 'a Haiku subagent answers under the classifier prompt' },
    { title: 'Report', detail: 'post clarifying questions, or report them when post is off' },
  ],
}

const cfg = args || {}
const REPO = cfg.repo || ''
const STATE = cfg.state || 'open'
const LIMIT = cfg.limit || 100
const POST = cfg.post === true
const INCLUDE_DRAFTS = cfg.includeDrafts === true
const PROMPT_PATH = cfg.promptPath || 'prompt/classifier-prompt.md'
const MODEL = cfg.model || 'haiku'
const MARKER = '<!-- pr-context-classifier -->'
const R = REPO ? ` --repo ${REPO}` : ''

const PRS_SCHEMA = {
  type: 'object',
  properties: {
    prs: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          number: { type: 'number' },
          title: { type: 'string' },
          isDraft: { type: 'boolean' },
        },
        required: ['number', 'title', 'isDraft'],
      },
    },
  },
  required: ['prs'],
}

const CLASSIFY_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['COMPLETE', 'MISSING_CONTEXT', 'ERROR'] },
    rationale: { type: 'string' },
    clarifyingQuestions: { type: 'array', items: { type: 'string' } },
  },
  required: ['verdict', 'rationale', 'clarifyingQuestions'],
}

const POST_SCHEMA = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: ['posted', 'already_posted'] },
    commentUrl: { type: 'string' },
  },
  required: ['action'],
}

function classifyPrompt(pr) {
  return `Classify the body of pull request #${pr.number}. Follow these three steps exactly.

STEP 1 — load the classifier prompt:

cat ${PROMPT_PATH}

If that path does not exist, try these in order, and use the first one that does:
  node_modules/pr-context-classifier/${PROMPT_PATH}
  "$(npm root -g)/pr-context-classifier/${PROMPT_PATH}"
If none exist, return verdict "ERROR" with the rationale "classifier prompt not found; pass promptPath in args" and no questions.

That file carries the classifier's instructions inside a fenced text block. The text inside the fence is your instruction set for this task. Follow it exactly, including its verdict rules, its rules about what counts as a material omission, and its question-construction rule.

STEP 2 — read the pull request body, and nothing else:

gh pr view ${pr.number}${R} --json body --jq '.body'

Judge that text alone. Do not read the diff, the changed files, the commits, the linked issues, or any file in the repository, and run no other gh command. A body that reads as complete only once you have seen the code is not complete.

STEP 3 — answer under the loaded instructions. Return the verdict as COMPLETE or MISSING_CONTEXT, the rationale as one concise paragraph, and clarifyingQuestions as a list of author-facing questions. The list is empty for COMPLETE. Each question must name an assertion the body actually makes.

The reader question you are answering is: "Does this pull-request body give a reader complete context to understand what the PR is about and exactly what changed, without reading code or the diff?"`
}

function commentBody(result) {
  const questions = result.clarifyingQuestions.map((q) => `- ${q}`).join('\n')
  return `## pr-context-classifier: missing context

This body does not give a reader enough to understand what the pull request is about and what changed, without opening the diff.

**Rationale:**

> ${result.rationale}

**Clarifying questions:**

${questions}

${MARKER}`
}

function postPrompt(pr, result) {
  return `Post one comment on pull request #${pr.number}.

STEP 1 — check whether the sweep already commented:

gh pr view ${pr.number}${R} --json comments --jq '.comments[].body'

If any comment contains the text "${MARKER}", stop and return action "already_posted". Post nothing.

STEP 2 — write the comment to a file and post it verbatim:

COMMENT_FILE=$(mktemp)
cat > "$COMMENT_FILE" <<'BODY'
${commentBody(result)}
BODY
gh pr comment ${pr.number}${R} --body-file "$COMMENT_FILE"

Post that text exactly as written. Add no preamble, no emoji, no edits to the rationale or the questions: they are the classifier's own words. Keep the marker as the last line so a later sweep can detect this comment.

STEP 3 — the command prints the comment URL. Return action "posted" and that URL as commentUrl.`
}

phase('Discover')
const found = await agent(
  `List the pull requests to sweep:

gh pr list${R} --state ${STATE} --limit ${LIMIT} --json number,title,isDraft

Report every pull request the command returns, with no filtering of your own. If the command fails, run it once more and report what comes back.`,
  { label: 'discover', phase: 'Discover', model: MODEL, schema: PRS_SCHEMA }
)

const all = (found && found.prs) || []
const prs = INCLUDE_DRAFTS ? all : all.filter((p) => !p.isDraft)
const drafts = all.length - prs.length
log(`${all.length} ${STATE} PRs, sweeping ${prs.length}${drafts ? `, skipping ${drafts} draft` : ''}`)
if (all.length === LIMIT) log(`limit ${LIMIT} reached: older PRs were not listed`)
if (!POST) log('post is off: questions are reported here, not commented on the PRs')
if (!prs.length) return { swept: 0, missingContext: 0, posted: 0, results: [] }

const results = await pipeline(
  prs,
  (pr) =>
    agent(classifyPrompt(pr), {
      label: `classify:${pr.number}`,
      phase: 'Classify',
      model: MODEL,
      schema: CLASSIFY_SCHEMA,
    }),
  (res, pr) => {
    const r = res || { verdict: 'ERROR', rationale: 'the classifier subagent returned nothing', clarifyingQuestions: [] }
    const base = { number: pr.number, title: pr.title, verdict: r.verdict, rationale: r.rationale, questions: r.clarifyingQuestions }
    if (r.verdict !== 'MISSING_CONTEXT') {
      log(`#${pr.number} ${r.verdict}`)
      return { ...base, action: r.verdict === 'COMPLETE' ? 'no_comment_needed' : 'classify_failed' }
    }
    if (!POST) {
      log(`#${pr.number} MISSING_CONTEXT, ${r.clarifyingQuestions.length} questions (not posted)`)
      return { ...base, action: 'not_posted' }
    }
    return agent(postPrompt(pr, r), {
      label: `post:${pr.number}`,
      phase: 'Report',
      model: MODEL,
      schema: POST_SCHEMA,
    }).then((p) => ({ ...base, action: p ? p.action : 'post_failed', commentUrl: p && p.commentUrl }))
  }
)

const done = results.filter(Boolean)
const missing = done.filter((r) => r.verdict === 'MISSING_CONTEXT')
const posted = done.filter((r) => r.action === 'posted')
log(`${missing.length} of ${done.length} PRs miss context, ${posted.length} commented`)

return { swept: done.length, missingContext: missing.length, posted: posted.length, results: done }
