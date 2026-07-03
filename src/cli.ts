#!/usr/bin/env node
import { Command } from 'commander';
import path from 'node:path';
import { loadConfig } from './config.js';
import { listTasks, loadEvents, loadTask, saveTask } from './store.js';
import { createTask, drainQueue, runTask } from './runner.js';
import { diffWorktree, mergeBranch, removeWorktree } from './worktree.js';
import fs from 'node:fs';
import os from 'node:os';
import type { WalleEvent } from './types.js';

function formatEvent(e: WalleEvent): string {
  switch (e.type) {
    case 'task.started':
      return `▶ ${e.taskId} started`;
    case 'agent.message':
      return `💬 ${e.text.slice(0, 120).replace(/\n/g, ' ')}`;
    case 'tool.used':
      return `🔧 ${e.tool}`;
    case 'file.changed':
      return `📝 ${e.path}`;
    case 'cost.updated':
      return `💲 $${e.costUsd.toFixed(4)}`;
    case 'agent.blocked':
      return `⏸ blocked: ${e.reason}`;
    case 'task.finished':
      return e.success ? '✅ finished' : `❌ failed: ${e.error}`;
  }
}

const program = new Command();

program
  .name('walle')
  .description('Mission Control for coding agents — queue tasks, review results')
  .version('0.1.0');

program
  .command('do')
  .description('queue a task and run it')
  .argument('<prompt>', 'what the agent should do')
  .option('--repo <path>', 'target git repo', process.cwd())
  .option('--engine <name>', 'engine override')
  .option('--model <name>', 'model override (e.g. claude-haiku-4-5 for cheap tasks)')
  .option('--queue-only', 'queue without running')
  .option('-q, --quiet', 'suppress live progress output')
  .action(async (prompt: string, opts: { repo: string; engine?: string; model?: string; queueOnly?: boolean; quiet?: boolean }) => {
    const repo = path.resolve(opts.repo);
    const config = loadConfig(repo);
    if (opts.engine) config.engine = opts.engine;
    if (opts.model) config.model = opts.model;
    const task = createTask(prompt, repo, config);
    console.log(`queued ${task.id}: ${prompt}`);
    if (opts.queueOnly) return;
    await drainQueue(config, opts.quiet ? undefined : (e) => console.log(formatEvent(e)));
    const done = loadTask(task.id)!;
    console.log(`${done.id} → ${done.status}${done.error ? `\n${done.error}` : ''}`);
    if (done.status === 'done') {
      console.log(`review with: walle diff ${done.id}  |  accept with: walle merge ${done.id}`);
    }
  });

program
  .command('ls')
  .description('list all tasks')
  .option('--json', 'print tasks as JSON')
  .action((opts: { json?: boolean }) => {
    const tasks = listTasks();
    if (opts.json) {
      console.log(
        JSON.stringify(
          tasks.map((t) => ({
            id: t.id,
            status: t.status,
            costUsd: t.costUsd,
            prompt: t.prompt,
            createdAt: t.createdAt,
          })),
          null,
          2,
        ),
      );
      return;
    }
    if (tasks.length === 0) {
      console.log('no tasks yet — try: walle do "your prompt"');
      return;
    }
    for (const t of tasks) {
      const cost = t.costUsd ? ` $${t.costUsd.toFixed(2)}` : '';
      console.log(`${t.id}  ${t.status.padEnd(9)}${cost}  ${t.prompt.slice(0, 60)}`);
    }
  });

program
  .command('show')
  .description('show task timeline, cost, and status')
  .argument('<id>')
  .action((id: string) => {
    const task = loadTask(id);
    if (!task) return fail(`no such task: ${id}`);
    console.log(`task    ${task.id} (${task.status})`);
    console.log(`prompt  ${task.prompt}`);
    console.log(`repo    ${task.repo}`);
    if (task.branch) console.log(`branch  ${task.branch}`);
    console.log(`cost    $${task.costUsd.toFixed(4)}  retries ${task.retries}`);
    if (task.error) console.log(`error   ${task.error}`);
    console.log('--- timeline ---');
    for (const e of loadEvents(id)) console.log(formatEvent(e));
  });

program
  .command('logs')
  .description('print task events; --follow tails a running task live')
  .argument('<id>')
  .option('-f, --follow', 'keep watching for new events until the task finishes')
  .action(async (id: string, opts: { follow?: boolean }) => {
    const task = loadTask(id);
    if (!task) return fail(`no such task: ${id}`);
    for (const e of loadEvents(id)) console.log(formatEvent(e));
    if (!opts.follow) return;

    const file = path.join(os.homedir(), '.walle', 'tasks', `${id}.events.jsonl`);
    let offset = fs.existsSync(file) ? fs.statSync(file).size : 0;
    while (true) {
      const t = loadTask(id)!;
      if (['done', 'failed', 'cancelled'].includes(t.status)) break;
      await new Promise((r) => setTimeout(r, 1000));
      if (!fs.existsSync(file)) continue;
      const size = fs.statSync(file).size;
      if (size <= offset) continue;
      const fd = fs.openSync(file, 'r');
      const buf = Buffer.alloc(size - offset);
      fs.readSync(fd, buf, 0, buf.length, offset);
      fs.closeSync(fd);
      offset = size;
      for (const line of buf.toString('utf8').split('\n').filter(Boolean)) {
        try {
          console.log(formatEvent(JSON.parse(line)));
        } catch {}
      }
    }
  });

program
  .command('diff')
  .description('show the diff produced by a task')
  .argument('<id>')
  .action(async (id: string) => {
    const task = loadTask(id);
    if (!task) return fail(`no such task: ${id}`);
    if (!task.branch) return fail(`task ${id} has no branch yet`);
    console.log(await diffWorktree(task.repo, task.branch));
  });

program
  .command('merge')
  .description('merge a finished task into the current branch')
  .argument('<id>')
  .action(async (id: string) => {
    const task = loadTask(id);
    if (!task) return fail(`no such task: ${id}`);
    if (task.status !== 'done') return fail(`task ${id} is ${task.status}, not done`);
    await mergeBranch(task.repo, task.branch);
    await removeWorktree(task.repo, task.worktree, task.branch);
    task.status = 'merged';
    saveTask(task);
    console.log(`merged ${task.branch} and cleaned up worktree`);
  });

program
  .command('cancel')
  .description('cancel a task and clean up its worktree')
  .argument('<id>')
  .action(async (id: string) => {
    const task = loadTask(id);
    if (!task) return fail(`no such task: ${id}`);
    if (task.pid) {
      try {
        process.kill(task.pid);
      } catch {}
    }
    if (task.worktree) await removeWorktree(task.repo, task.worktree, task.branch);
    task.status = 'cancelled';
    saveTask(task);
    console.log(`cancelled ${task.id}`);
  });

program
  .command('serve')
  .description('start the web dashboard (pixel office floor)')
  .option('--port <n>', 'port', '4711')
  .option('--repo <path>', 'default repo for tasks created from the UI', process.cwd())
  .action(async (opts: { port: string; repo: string }) => {
    const { startServer } = await import('./server.js');
    startServer(Number(opts.port), path.resolve(opts.repo));
  });

program
  .command('run')
  .description('run all queued tasks (respects concurrency limit)')
  .option('--repo <path>', 'repo whose walle.yaml to use', process.cwd())
  .action(async (opts: { repo: string }) => {
    await drainQueue(loadConfig(path.resolve(opts.repo)));
    console.log('queue drained');
  });

function fail(msg: string): void {
  console.error(msg);
  process.exitCode = 1;
}

program.parseAsync().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
