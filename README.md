# walle

**Mission Control for coding agents** — queue tasks, review results.

walle treats agents as cattle, not pets: you don't wake and babysit an agent, you hand walle a task. It spawns the agent headless in an isolated git worktree, streams structured events (not screen-scrapes), verifies the result, and holds the diff for your review.

```bash
walle do "fix the auth bug"      # queue + run in an isolated worktree
walle ls                          # status of all tasks
walle show <id>                   # timeline, cost, files changed
walle logs <id> --follow          # tail a running task live
walle diff <id>                   # review the result
walle merge <id>                  # accept it
walle cancel <id>                 # kill + clean up
walle serve                       # web dashboard — pixel office floor on :4711
```

## Dashboard

`walle serve` opens a live pixel-office view: one desk per task, robot posture = status (typing = running, sign = done, raised hand = blocked, smoke = failed). Click a desk for the timeline and diff; merge, discard, and queue new tasks straight from the page. Live updates via SSE — no build step, no frontend framework.

## Setup

```bash
npm install
npm run build
node dist/cli.js --help    # or: npm link → walle --help
```

Requires Node ≥ 20, git, and [Claude Code](https://claude.com/claude-code) on PATH. Cross-platform — no tmux, no Bun.

## Per-repo config — `walle.yaml`

```yaml
engine: claude
model: claude-haiku-4-5   # optional — cheap model for simple tasks (or per-task: walle do --model ...)
verify: npm test          # run after the agent finishes; failures are fed back for retry
maxRetries: 2
concurrency: 2
budget:
  perTask: 2.00           # USD
  perDay: 20.00
notify:
  webhook: https://discord.com/api/webhooks/...
```

See [PLAN.md](PLAN.md) for the roadmap and architecture.
