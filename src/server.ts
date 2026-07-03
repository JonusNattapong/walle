import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { TASKS_DIR, listTasks, loadEvents, loadTask, saveTask } from './store.js';
import { diffWorktree, mergeBranch, removeWorktree } from './worktree.js';
import { createTask, drainQueue } from './runner.js';
import { loadConfig } from './config.js';
import { DASHBOARD_HTML } from './ui.js';

export function startServer(port: number, defaultRepo: string): void {
  const app = express();
  app.use(express.json());

  app.get('/', (_req, res) => {
    res.type('html').send(DASHBOARD_HTML);
  });

  app.get('/api/tasks', (_req, res) => {
    res.json(listTasks());
  });

  app.get('/api/tasks/:id', (req, res) => {
    const task = loadTask(req.params.id);
    if (!task) return void res.status(404).json({ error: 'not found' });
    res.json({ task, events: loadEvents(req.params.id) });
  });

  app.get('/api/tasks/:id/diff', async (req, res) => {
    const task = loadTask(req.params.id);
    if (!task) return void res.status(404).json({ error: 'not found' });
    if (!task.branch) return void res.status(400).json({ error: 'no branch yet' });
    try {
      res.type('text').send(await diffWorktree(task.repo, task.branch));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/tasks/:id/merge', async (req, res) => {
    const task = loadTask(req.params.id);
    if (!task) return void res.status(404).json({ error: 'not found' });
    if (task.status !== 'done') return void res.status(400).json({ error: `task is ${task.status}, not done` });
    try {
      await mergeBranch(task.repo, task.branch);
      await removeWorktree(task.repo, task.worktree, task.branch);
      task.status = 'merged';
      saveTask(task);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/tasks/:id/cancel', async (req, res) => {
    const task = loadTask(req.params.id);
    if (!task) return void res.status(404).json({ error: 'not found' });
    if (task.pid) {
      try {
        process.kill(task.pid);
      } catch {}
    }
    if (task.worktree) await removeWorktree(task.repo, task.worktree, task.branch);
    task.status = 'cancelled';
    saveTask(task);
    res.json({ ok: true });
  });

  app.post('/api/do', (req, res) => {
    const { prompt, repo, model } = req.body ?? {};
    if (!prompt || typeof prompt !== 'string') return void res.status(400).json({ error: 'prompt required' });
    const repoPath = path.resolve(repo || defaultRepo);
    if (!fs.existsSync(path.join(repoPath, '.git'))) {
      return void res.status(400).json({ error: `not a git repo: ${repoPath}` });
    }
    const config = loadConfig(repoPath);
    if (model) config.model = model;
    const task = createTask(prompt, repoPath, config);
    // fire and forget — progress reaches clients via SSE
    void drainQueue(config).catch(() => {});
    res.json({ id: task.id });
  });

  app.get('/api/stream', (req, res) => {
    res.set({
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    res.flushHeaders();
    res.write('data: hello\n\n');

    fs.mkdirSync(TASKS_DIR, { recursive: true });
    let timer: NodeJS.Timeout | undefined;
    const watcher = fs.watch(TASKS_DIR, () => {
      clearTimeout(timer);
      timer = setTimeout(() => res.write('data: change\n\n'), 300);
    });
    const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
    req.on('close', () => {
      watcher.close();
      clearInterval(ping);
      clearTimeout(timer);
    });
  });

  app.listen(port, () => {
    console.log(`walle dashboard → http://localhost:${port}  (repo: ${defaultRepo})`);
  });
}
