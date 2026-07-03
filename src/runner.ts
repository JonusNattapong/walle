import crypto from 'node:crypto';
import type { Task, WalleConfig, WalleEvent } from './types.js';
import { appendEvent, listTasks, saveTask } from './store.js';
import { commitAll, createWorktree } from './worktree.js';
import { claudeAdapter } from './engines/claude.js';
import type { EngineAdapter } from './engines/adapter.js';
import { verify } from './verifier.js';
import { checkBudget } from './budget.js';
import { notify } from './notifier.js';

const ADAPTERS: Record<string, EngineAdapter> = {
  claude: claudeAdapter,
};

export function createTask(prompt: string, repo: string, config: WalleConfig): Task {
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
  const adapter = ADAPTERS[task.engine];
  if (!adapter) {
    task.status = 'failed';
    task.error = `unknown engine: ${task.engine}`;
    saveTask(task);
    return task;
  }

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

  const onEvent = (e: WalleEvent) => {
    appendEvent(e);
    onProgress?.(e);
    if (e.type === 'cost.updated') {
      task.costUsd = e.costUsd;
      saveTask(task);
    }
  };

  let prompt = task.prompt;
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

async function finish(task: Task, config: WalleConfig, success: boolean, error?: string): Promise<Task> {
  task.status = success ? 'done' : 'failed';
  task.error = error;
  task.finishedAt = new Date().toISOString();
  saveTask(task);
  appendEvent({ type: 'task.finished', taskId: task.id, success, error });
  await notify(config, task, success ? 'task completed' : `task failed: ${error}`);
  return task;
}

/** Run all queued tasks with a concurrency cap. */
export async function drainQueue(config: WalleConfig, onProgress?: ProgressListener): Promise<void> {
  const queued = listTasks().filter((t) => t.status === 'queued');
  let index = 0;
  const workers = Array.from({ length: Math.max(1, config.concurrency) }, async () => {
    while (index < queued.length) {
      const task = queued[index++];
      await runTask(task, config, onProgress);
    }
  });
  await Promise.all(workers);
}
