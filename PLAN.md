# walle — Plan

> **Mission Control for coding agents** — ส่งงานเข้า queue แล้วมารีวิวผลลัพธ์
> ไม่ใช่ remote control แบบ maw-js (wake/hey/peek) แต่เป็น CI/CD สำหรับ coding agents

## Positioning

| | maw-js | walle |
|---|---|---|
| มุมมองต่อ agent | หน้าจอ tmux ที่ต้องแอบดู (pet) | stream ของ structured events (cattle) |
| หน่วยหลัก | agent | **task** |
| Platform | tmux + Bun (ไม่รองรับ Windows) | Node spawn ตรง ๆ — cross-platform ตั้งแต่วันแรก |
| เสร็จแล้วไง | ต้องเข้าไป peek เอง | verify อัตโนมัติ + diff review + merge gate |

## Core Concept

- **Task-first:** `walle do "fix the auth bug"` → walle spawn agent ใน git worktree แยก, รัน, verify, เก็บผล, ปิด
- **Structured events:** อ่าน `--output-format stream-json` ของ Claude Code (และ pipe ของ engine อื่น) ไม่ scrape หน้าจอ → timeline, cost, file-changes แม่นยำ
- **Review gate:** ทุก task จบใน worktree — ดู diff + สรุปก่อน merge

## Tech Stack

- **TypeScript / Node** (ไม่ผูก Bun) — ติดตั้งผ่าน npm
- Engine แรก: **Claude Code** (headless mode) → ตามด้วย Codex CLI, Aider/OpenCode ผ่าน adapter interface

## CLI Surface (MVP)

```bash
walle do "<prompt>" [--repo <path>] [--engine claude]  # ส่งงานเข้าคิว
walle ls                                               # สถานะทุก task
walle show <id>                                        # timeline + cost + สถานะ
walle diff <id>                                        # ดู diff ของ worktree
walle merge <id>                                       # รับงานเข้า branch หลัก
walle cancel <id>                                      # ยกเลิก task
```

## MVP Features

1. **Task lifecycle** — queued → running → verifying → done/failed; state เก็บใน `~/.walle/` (JSON)
2. **Task queue + concurrency limit** — รันพร้อมกันสูงสุด N ตัว ที่เหลือเข้าคิว
3. **Git worktree isolation** — 1 task = 1 worktree = 1 branch (`walle/<id>-<slug>`); ลบอัตโนมัติหลัง merge/cancel
4. **Verify loop** — หลัง agent เสร็จ รัน verify command จาก config; fail → feed error กลับให้ agent แก้ (สูงสุด N retry)
5. **Budget guard** — เพดาน cost/token ต่อ task และต่อวัน เกินแล้วหยุด + แจ้ง
6. **Notification hook** — task done/failed/blocked → webhook (Discord/LINE/ntfy)
7. **`walle.yaml` ต่อ repo** — verify command, budget, engine default, branch naming

```yaml
# walle.yaml ตัวอย่าง
engine: claude
verify: npm test
maxRetries: 2
budget:
  perTask: 2.00      # USD
  perDay: 20.00
notify:
  webhook: https://discord.com/api/webhooks/...
```

## Architecture

```
walle CLI
 ├─ TaskManager        — queue, lifecycle, state persistence (~/.walle/)
 ├─ WorktreeManager    — สร้าง/ลบ git worktree ต่อ task
 ├─ EngineAdapter      — interface เดียว, implement ต่อ engine
 │    ├─ ClaudeCodeAdapter   (stream-json events)
 │    ├─ CodexAdapter        (เฟส 2)
 │    └─ GenericAdapter      (stdin/stdout — Aider/OpenCode, เฟส 2)
 ├─ Verifier           — รัน verify command, retry loop
 ├─ BudgetGuard        — นับ cost จาก events, enforce เพดาน
 └─ Notifier           — webhook dispatch
```

`EngineAdapter` แปลง output ทุก engine เป็น event กลางชุดเดียว:
`task.started | agent.message | file.changed | tool.used | cost.updated | agent.blocked | task.finished`

## Phases

### Phase 1 — MVP (ชนะ maw ในมุมใช้งานจริง)
- CLI ครบ 6 คำสั่ง, ClaudeCodeAdapter, queue, worktree, verify loop, budget, webhook, walle.yaml

### Phase 2 — Engines & polish
- CodexAdapter + GenericAdapter (Aider/OpenCode)
- `walle logs <id> --follow` (stream timeline สด)
- Watchdog: ตรวจ agent ค้าง/วนลูป/รอ permission → แจ้งเตือน/auto-retry

### Phase 3 — ต่อเมื่อมีคนใช้
- Web dashboard (ครอบบน structured data ที่มีอยู่แล้ว)
- Federation ข้ามเครื่อง
- Multi-agent ร่วมงานใน task เดียว

### Non-goals
- ไม่ทำ plugin platform 89 ตัวแบบ maw — adapter interface พอ
- ไม่ผูก tmux / Bun

## Success Criteria (MVP)

- รันบน Windows/macOS/Linux ได้โดยไม่ต้องมี tmux
- ส่ง 3 tasks พร้อมกัน → รันตาม concurrency limit, จบใน worktree แยก, ไม่ชนกัน
- Task ที่ verify fail ถูก retry อัตโนมัติและรายงานตรงตามจริง
- Cost ต่อ task แสดงแม่นยำจาก event stream
