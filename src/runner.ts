import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import type { Task, WalleConfig, WalleEvent, MultiAgentSpec } from './types.js';
import { appendEvent, listTasks, saveTask } from './store.js';
import { commitAll, createWorktree } from './worktree.js';
import { claudeAdapter } from './engines/claude.js';
import { opencodeAdapter } from './engines/opencode.js';
import type { EngineAdapter } from './engines/adapter.js';
import { verify } from './verifier.js';
import { checkBudget } from './budget.js';
import { notify } from './notifier.js';
import { registerAgent, joinChannel, deregisterAgent, listAgents as macpListAgents } from './macp-bus.js';
import { spawnInTerminal, findExecutable } from './exec-utils.js';

const ADAPTERS: Record<string, EngineAdapter> = {
  claude: claudeAdapter,
  opencode: opencodeAdapter,
};

export function createTask(prompt: string, repo: string, config: WalleConfig, visible?: boolean): Task {
  const id = crypto.randomBytes(3).toString('hex');
  const task: Task = {
    id,
    prompt,
    repo,
    engine: config.engine,
    model: config.model,
    branch: '',
    worktree: '',
    status: 'queued',
    createdAt: new Date().toISOString(),
    costUsd: 0,
    retries: 0,
    visible,
  };
  saveTask(task);
  return task;
}

function slugify(prompt: string): string {
  return (
    prompt
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 30) || 'task'
  );
}

export type ProgressListener = (e: WalleEvent) => void;

/** Run one task through its full lifecycle: worktree → engine → verify loop. */
export async function runTask(task: Task, config: WalleConfig, onProgress?: ProgressListener): Promise<Task> {
  const preflight = checkBudget(config, 0);
  if (!preflight.ok) {
    task.status = 'failed';
    task.error = preflight.reason;
    saveTask(task);
    await notify(config, task, task.error!);
    return task;
  }

  const { dir, branch } = await createWorktree(task.repo, task.id, slugify(task.prompt));
  task.worktree = dir;
  task.branch = branch;
  task.status = 'running';
  task.startedAt = new Date().toISOString();
  saveTask(task);

  let prompt = task.prompt;

  let macpAgent: { agentId: string; sessionId: string } | undefined;
  if (task.groupId) {
    macpAgent = registerAgent(task.role ?? task.id, task.id);
    task.macpSessionId = macpAgent.sessionId;
    saveTask(task);
    joinChannel(macpAgent.agentId, macpAgent.sessionId, `group:${task.groupId}`);
    const peers = listTasks().filter((t) => t.groupId === task.groupId && t.id !== task.id);
    const peerList = peers.map((p) => `  - ${p.role ?? 'agent'} (ID: ${p.id})`).join('\n');
    const channelId = `group:${task.groupId}`;
    const macpBlock = `\n\n## Multi-Agent Collaboration (MACP)\n\nYou are part of a multi-agent team as **${task.role ?? 'agent'}**.\n\n- **Agent ID:** \`${task.id}\`\n- **Channel:** \`${channelId}\`\n\nOther agents in this group:\n${peerList || '  (none yet)'}\n\nUse MCP tools to collaborate in real-time:\n- \`walle_send\` — send a direct message to another agent\n- \`walle_inbox\` — check your inbox for incoming messages\n- \`walle_conversation\` — read a full message thread\n- \`walle_memory_set\` / \`walle_memory_get\` / \`walle_memory_search\` — shared memory across the team\n- \`walle_subscribe\` — get the SSE URL to receive push notifications for new messages\n\nAlways check your inbox (\`walle_inbox\`) before starting new work, and report progress via shared memory.\n`;
    prompt = macpBlock + prompt;
  }

  if (task.visible) {
    const result = await runTaskVisible(task, config, dir, prompt);
    return finish(task, config, result.success, result.error);
  }

  const adapter = ADAPTERS[task.engine];
  if (!adapter) {
    return finish(task, config, false, `unknown engine: ${task.engine}`);
  }

  const onEvent = (e: WalleEvent) => {
    appendEvent(e);
    onProgress?.(e);
    if (e.type === 'cost.updated') {
      task.costUsd = e.costUsd;
      saveTask(task);
    }
  };
  for (let attempt = 0; ; attempt++) {
    const budget = checkBudget(config, task.costUsd);
    if (!budget.ok) {
      return finish(task, config, false, `budget exceeded: ${budget.reason}`);
    }

    const run = adapter.run({ taskId: task.id, prompt, cwd: dir, model: task.model, onEvent });
    task.pid = run.pid;
    saveTask(task);
    const result = await run.done;
    task.pid = undefined;

    if (!result.success) {
      return finish(task, config, false, result.error ?? 'engine failed');
    }

    await commitAll(dir, `walle(${task.id}) attempt ${attempt + 1}: ${task.prompt.slice(0, 60)}`);

    if (!config.verify) return finish(task, config, true);

    task.status = 'verifying';
    saveTask(task);
    const v = await verify(config.verify, dir);
    if (v.success) return finish(task, config, true);

    if (attempt >= config.maxRetries) {
      return finish(task, config, false, `verify failed after ${attempt + 1} attempts:\n${v.output}`);
    }
    task.retries = attempt + 1;
    task.status = 'running';
    saveTask(task);
    prompt = `The previous attempt did not pass verification. Fix the following and make \`${config.verify}\` pass:\n\n${v.output}`;
  }
}

async function runTaskVisible(task: Task, config: WalleConfig, dir: string, prompt: string): Promise<{ success: boolean; error?: string }> {
  const eng = task.engine;
  const bin = findExecutable(eng);
  if (!bin) {
    return { success: false, error: `${eng} CLI not found on PATH` };
  }

  const binDir = path.dirname(fs.realpathSync(bin));
  const pathEnv = `${binDir}${path.delimiter}${process.env.PATH ?? ''}`;

  // Start temp MCP HTTP server
  const app = express();
  app.use(express.json());
  const { mountMcpOnExpress } = await import('./mcp-server.js');
  mountMcpOnExpress(app, task.repo);
  const httpServer = app.listen(0);
  const port = (httpServer.address() as import('net').AddressInfo).port;
  const mcpUrl = `http://localhost:${port}/mcp`;

  // Build engine command
  const pathSet = `set "PATH=${pathEnv.replace(/"/g, '')};%PATH%"`;
  let command: string;
  if (eng === 'claude') {
    const mcpConfig = JSON.stringify({ walle: { type: 'http', url: mcpUrl } });
    command = `${pathSet}\n${bin} -p ${JSON.stringify(prompt)} --mcp-servers ${JSON.stringify(mcpConfig)}`;
  } else {
    const mcpConfigPath = path.join(dir, 'opencode.json');
    fs.writeFileSync(mcpConfigPath, JSON.stringify({
      mcpServers: { walle: { type: 'http', url: mcpUrl } },
    }, null, 2), 'utf8');
    command = `${pathSet}\n${bin} run ${JSON.stringify(prompt)} --auto`;
  }

  task.pid = undefined;
  saveTask(task);
  appendEvent({ type: 'task.started', taskId: task.id });

  const { child } = spawnInTerminal(command, dir, task.id);

  return new Promise((resolve) => {
    child.on('exit', (code) => {
      try { httpServer.close(); } catch {}
      const success = code === 0;
      resolve({ success, error: success ? undefined : `terminal exited with code ${code}` });
    });
    child.on('error', (err) => {
      try { httpServer.close(); } catch {}
      resolve({ success: false, error: err.message });
    });
  });
}

async function finish(task: Task, config: WalleConfig, success: boolean, error?: string): Promise<Task> {
  task.status = success ? 'done' : 'failed';
  task.error = error;
  task.finishedAt = new Date().toISOString();
  saveTask(task);
  appendEvent({ type: 'task.finished', taskId: task.id, success, error });
  await notify(config, task, success ? 'task completed' : `task failed: ${error}`);

  // Deregister from MACP if part of a multi-agent group
  if (task.groupId && task.macpSessionId) {
    try { deregisterAgent(task.id, task.macpSessionId); } catch {}
  }

  return task;
}

export function createMultiTask(spec: MultiAgentSpec, repo: string, config: WalleConfig): Task[] {
  const groupId = spec.groupId ?? crypto.randomBytes(3).toString('hex');
  const tasks: Task[] = [];
  for (const role of spec.roles) {
    const id = crypto.randomBytes(3).toString('hex');
    const task: Task = {
      id,
      prompt: role.prompt,
      repo,
      engine: config.engine,
      model: role.model ?? config.model,
      branch: '',
      worktree: '',
      status: role.dependsOn?.length ? 'waiting' : 'queued',
      createdAt: new Date().toISOString(),
      costUsd: 0,
      retries: 0,
      groupId,
      role: role.role,
      dependsOn: role.dependsOn,
    };
    saveTask(task);
    tasks.push(task);
  }
  // Wire up dependedBy
  for (const t of tasks) {
    if (!t.dependsOn) continue;
    for (const depId of t.dependsOn) {
      const dep = tasks.find((d) => d.id === depId);
      if (dep) {
        dep.dependedBy = [...(dep.dependedBy ?? []), t.id];
        saveTask(dep);
      }
    }
  }
  return tasks;
}

type QueuedEntry = { task: Task; config: WalleConfig };

async function runSingleTask(entry: QueuedEntry, onProgress?: ProgressListener): Promise<void> {
  await runTask(entry.task, entry.config, onProgress);
  // Unblock dependents
  if (entry.task.dependedBy) {
    for (const depId of entry.task.dependedBy) {
      const dep = listTasks().find((t) => t.id === depId);
      if (dep && dep.status === 'waiting' && dep.dependsOn) {
        const allDone = dep.dependsOn.every((did) => {
          const dt = listTasks().find((t) => t.id === did);
          return dt && (dt.status === 'done' || dt.status === 'merged');
        });
        if (allDone) {
          dep.status = 'queued';
          saveTask(dep);
        }
      }
    }
  }
}

/** Run all queued tasks with a concurrency cap. Respects task dependencies. */
export async function drainQueue(config: WalleConfig, onProgress?: ProgressListener): Promise<void> {
  while (true) {
    const ready = listTasks().filter(
      (t) => t.status === 'queued' || t.status === 'waiting',
    );
    if (ready.length === 0) break;

    const runnable = ready.filter((t) => t.status === 'queued');
    if (runnable.length === 0) {
      // All remaining tasks are waiting — check if any dependency just finished
      const stillWaiting = ready.filter((t) => t.status === 'waiting');
      let progressed = false;
      for (const t of stillWaiting) {
        const allDone = (t.dependsOn ?? []).every((did) => {
          const dt = listTasks().find((x) => x.id === did);
          return dt && (dt.status === 'done' || dt.status === 'merged');
        });
        if (allDone) {
          t.status = 'queued';
          saveTask(t);
          progressed = true;
        }
      }
      if (!progressed) break; // deadlock or nothing to do
      continue;
    }

    const batch = runnable.slice(0, Math.max(1, config.concurrency));
    await Promise.all(batch.map((task) => runSingleTask({ task, config }, onProgress)));
  }
}
