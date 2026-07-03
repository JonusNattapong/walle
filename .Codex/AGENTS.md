# walle

Mission Control for coding agents — CI/CD for AI coding agents. Queue tasks, spawn agents in isolated git worktrees, auto-verify, review diffs, merge.

## Stack

- **Runtime**: Node ≥ 22.5 (uses `node:sqlite` via MACP)
- **Language**: TypeScript (ESM), builds to `dist/`
- **CLI**: `commander`
- **MCP**: `@modelcontextprotocol/sdk` (stdio + HTTP/SSE)
- **Agent engines**: Claude Code (`claude`), OpenCode (`opencode`)
- **Message bus + memory**: MACP (`multiagentcognition/macp`) — SQLite-backed, durable

## Commands

```bash
npm run build       # tsc → dist/
npm run dev         # tsx src/cli.ts (run without build)
npm run typecheck   # tsc --noEmit
npm run dev:watch   # tsx watch src/cli.ts

# CLI (after build or via npm run dev)
walle do "<prompt>"              # queue + run a task
walle do "<prompt>" --queue-only  # queue only
walle ls                          # list all tasks
walle ls --json                   # JSON output
walle show <id>                   # task detail + timeline
walle logs <id>                   # raw events
walle logs <id> -f                # tail (follow) live
walle diff <id>                   # diff from worktree
walle merge <id>                  # merge into main branch
walle cancel <id>                 # cancel + cleanup
walle mcp                         # start MCP stdio server
walle serve                       # web dashboard + optional /mcp
walle serve --mcp                 # serve dashboard + MCP HTTP
walle run                         # drain pending queue
```

## Architecture

```
src/
├── cli.ts             # CLI entry (commander)
├── server.ts          # Express + SSE for dashboard (/api/*)
├── mcp-server.ts      # MCP tools: walle_do, walle_send, walle_memory_*, etc.
├── runner.ts          # task lifecycle: worktree → engine → verify loop
├── macp-bus.ts        # MACP wrapper: agent register, send/poll, memory, metadata tables
├── message-bus.ts     # Message API (delegates to MACP SQLite)
├── memory.ts          # Memory API (delegates to MACP memory)
├── store.ts           # Task state persistence (~/.walle/tasks/*.json)
├── worktree.ts        # Git worktree management
├── config.ts          # walle.yaml loader
├── event-bus.ts       # Simple in-memory pub/sub (for SSE push)
├── budget.ts          # Per-task / per-day cost guard
├── notifier.ts        # Webhook dispatch
├── verifier.ts        # Verify command runner
├── types.ts           # Shared types (Task, Message, WalleEvent, WalleConfig)
├── exec-utils.ts      # Subprocess helpers
├── engines/
│   ├── adapter.ts     # EngineAdapter interface
│   ├── claude.ts      # Claude Code adapter
│   └── opencode.ts    # OpenCode adapter
└── ui.ts              # Dashboard HTML (office floor)
```

### Data flow

1. `walle do "prompt"` → `createTask()` → saved to `~/.walle/tasks/`
2. `drainQueue()` → `runTask()` per worktree:
   - `createWorktree(repo, id)` → git worktree + branch
   - For multi-agent (`groupId`): auto-register in MACP, join channel, inject MACP context into prompt
   - `adapter.run(...)` → spawn engine subprocess
   - Engine emits structured events → saved as JSONL
   - `verify()` → if fail → retry (up to `maxRetries`)
   - `commitAll()` → `finish()` → deregister MACP agent
3. Review: `walle diff <id>` → `walle merge <id>`

### MACP integration

- **DB**: `~/.walle/macp/bus.db` (SQLite, WAL mode)
- **System agent**: `_walle` (auto-registered for workspace/channel memory)
- **Messages**: Send/receive via `sendToAgent()`/`pollInbox()`/`ackDelivery()`; metadata stored in `walle_messages` table
- **Memory**: `macpSetMemory()`/`macpGetMemory()` wraps MACP workspace memory; scope mapping: `global`→workspace, `group:x`→channel, `task:x`→agent
- **Multi-agent**: Tasks with `groupId` auto-register in MACP, join `group:{id}` channel, get MACP prompt injection
- **MCP tools**: `walle_agent_register`, `walle_channel_join`, `walle_agent_list`, `walle_send_channel`, `walle_poll`, `walle_ack`, `walle_session_context`, `walle_file_claims`, `walle_macp_set/get/search/delete`

## Conventions

- ESM modules (`.js` extensions in imports)
- No classes — functions + module-level state
- `camelCase` for variables/functions
- Imports: Node builtins first, then npm packages, then local (`./`)
- Errors propagate via throw / try-catch (no Result types)
- Task state in JSON files at `~/.walle/tasks/`
- MACP data in SQLite at `~/.walle/macp/bus.db`

## walle.yaml (per-repo config)

```yaml
engine: claude            # default engine
model: claude-sonnet-4-5  # model override
verify: npm test          # verify command after agent finishes
maxRetries: 2             # retry on verify failure
concurrency: 2            # parallel task limit
budget:
  perTask: 2.00           # USD per task
  perDay: 20.00           # daily budget cap
notify:
  webhook: <url>          # task notification webhook
```

## Evidence

- Files examined: `package.json`, `tsconfig.json`, `walle.yaml`, `src/*.ts`, `src/engines/*.ts`
- Commands verified against `package.json` scripts

## Assumptions

- Node ≥ 22.5 required (MACP uses `node:sqlite` DatabaseSync)
- `node:sqlite` is experimental (warning appears but harmless)
- Git must be available for worktree operations
- Engine binaries (`claude`, `opencode`) must be installed separately
