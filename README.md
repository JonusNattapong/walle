# walle

**Mission Control for coding agents** — queue tasks, review results, coordinate multi-agent teams.

walle treats agents as cattle, not pets: you don't wake and babysit an agent, you hand walle a task. It spawns the agent headless in an isolated git worktree, streams structured events (not screen-scrapes), verifies the result, and holds the diff for your review.

```bash
walle do "fix the auth bug"         # queue + run in an isolated worktree
walle do "add tests" -v             # open agent in a visible terminal window
walle do -r "write api" -m "OAuth"  # multi-agent: roles + optional model per role
walle ls                            # status of all tasks
walle show <id>                     # timeline, cost, files changed
walle logs <id> --follow            # tail a running task live
walle diff <id>                     # review the result
walle merge <id>                    # accept it
walle cancel <id>                   # kill + clean up
walle serve                         # web dashboard on :4711
```

## Features

- **Headless or visible** — run agents in the background (default) or in a visible terminal (`-v`) for real-time feedback.
- **Multi-agent orchestration** — define roles with `-r`; agents collaborate via [MACP](https://github.com/multiagentcognition/macp) message bus (SQLite-backed channels, inboxes, shared memory, file claims).
- **Web dashboard** — pixel office floor with live SSE updates. One character per task, click for timeline and diff.
- **Budget & retries** — per-task and per-day USD budgets, auto-retry on verify failure.
- **Cross-platform** — Windows, macOS, Linux. No tmux, no Bun.

## Setup

```bash
npm install
npm run build
node dist/cli.js --help    # or: npm link → walle --help
```

Requires Node ≥ 22.5 (for `node:sqlite`), git, and [Claude Code](https://claude.com/claude-code) or OpenCode on PATH.

## Per-repo config — `walle.yaml`

```yaml
engine: claude
model: claude-haiku-4-5   # optional — cheap model for simple tasks
verify: npm test          # run after the agent finishes; failures fed back for retry
maxRetries: 2
concurrency: 2
budget:
  perTask: 2.00           # USD
  perDay: 20.00
notify:
  webhook: https://discord.com/api/webhooks/...
```

## CLI reference

| Command | Description |
|---|---|
| `walle do <prompt>` | Queue and run a task |
| `walle do <prompt> -v` | Visible mode — opens agent in a new terminal window |
| `walle do -r <json>` | Multi-agent: JSON array of roles |
| `walle ls` | List all tasks |
| `walle show <id>` | Timeline, cost, files changed |
| `walle logs <id> [--follow]` | Agent output (tail with SSE) |
| `walle diff <id>` | Review changes before merging |
| `walle merge <id>` | Accept and apply the diff |
| `walle cancel <id>` | Kill task and clean up worktree |
| `walle serve` | Launch web dashboard |
| `walle ls --json` | Machine-readable task list |

See [PLAN.md](PLAN.md) for the roadmap and architecture.

## License

MIT
