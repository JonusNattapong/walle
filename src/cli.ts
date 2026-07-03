#!/usr/bin/env node
import { Command } from 'commander';
import path from 'node:path';
import { loadConfig } from './config.js';
import { listTasks, loadEvents, loadTask, saveTask } from './store.js';
import { createTask, drainQueue, runTask } from './runner.js';
import { diffWorktree, mergeBranch, removeWorktree } from './worktree.js';

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
  .option('--queue-only', 'queue without running')
  .action(async (prompt: string, opts: { repo: string; engine?: string; queueOnly?: boolean }) => {
    const repo = path.resolve(opts.repo);
    const config = loadConfig(repo);
    if (opts.engine) config.engine = opts.engine;
    const task = createTask(prompt, repo, config);
    console.log(`queued ${task.id}: ${prompt}`);
    if (opts.queueOnly) return;
    await drainQueue(config);
    const done = loadTask(task.id)!;
    console.log(`${done.id} → ${done.status}${done.error ? `\n${done.error}` : ''}`);
    if (done.status === 'done') {
      console.log(`review with: walle diff ${done.id}  |  accept with: walle merge ${done.id}`);
    }
  });

program
  .command('ls')
  .description('list all tasks')
  .action(() => {
    const tasks = listTasks();
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
    for (const e of loadEvents(id)) {
      switch (e.type) {
        case 'agent.message':
          console.log(`💬 ${e.text.slice(0, 120).replace(/\n/g, ' ')}`);
          break;
        case 'tool.used':
          console.log(`🔧 ${e.tool}`);
          break;
        case 'file.changed':
          console.log(`📝 ${e.path}`);
          break;
        case 'cost.updated':
          console.log(`💲 $${e.costUsd.toFixed(4)}`);
          break;
        case 'task.finished':
          console.log(e.success ? '✅ finished' : `❌ failed: ${e.error}`);
          break;
        default:
          console.log(`• ${e.type}`);
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
