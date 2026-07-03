import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TASKS_DIR, listTasks, loadEvents, loadTask, saveTask } from './store.js';
import { diffWorktree, mergeBranch, removeWorktree } from './worktree.js';
import { createTask, drainQueue } from './runner.js';
import { loadConfig, saveConfig } from './config.js';
import { DASHBOARD_HTML } from './ui.js';
import { on as onEvent } from './event-bus.js';

export async function startServer(port: number, defaultRepo: string, serveMcp?: boolean): Promise<void> {
  const app = express();
  app.use(express.json());
  const assetsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets');
  app.use('/assets', express.static(assetsDir));

  app.get('/debug/tiles', (req, res) => {
    const sheet = req.query.sheet === 'chars' ? 'chars' : 'indoor';
    res.type('html').send(`<!doctype html><body style="background:#222;margin:0">
<canvas id="c"></canvas><script>
const img = new Image(); img.src = '/assets/${sheet}.png';
img.onload = () => {
  const T = 16, SP = 1, Z = 3;
  const cols = Math.floor((img.width + SP) / (T + SP)), rows = Math.floor((img.height + SP) / (T + SP));
  const cv = document.getElementById('c'); cv.width = cols * T * Z; cv.height = rows * T * Z;
  const x = cv.getContext('2d'); x.imageSmoothingEnabled = false;
  x.fillStyle = '#444'; x.fillRect(0, 0, cv.width, cv.height);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    x.drawImage(img, c * (T + SP), r * (T + SP), T, T, c * T * Z, r * T * Z, T * Z, T * Z);
    x.strokeStyle = 'rgba(255,0,255,.25)'; x.strokeRect(c * T * Z, r * T * Z, T * Z, T * Z);
    x.fillStyle = '#fff'; x.font = '8px monospace';
    x.fillText(r * cols + c, c * T * Z + 1, r * T * Z + 8);
  }
};
</script></body>`);
  });

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

  app.post('/api/tasks/:id/settings', (req, res) => {
    const task = loadTask(req.params.id);
    if (!task) return void res.status(404).json({ error: 'not found' });
    const { model, engine } = req.body ?? {};
    if (typeof engine === 'string') task.engine = engine;
    if (typeof model === 'string') task.model = model || undefined;
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

  app.post('/api/layout', (req, res) => {
    const { desks, lounge, width, height } = req.body ?? {};
    if (!Array.isArray(desks) || !desks.length) return void res.status(400).json({ error: 'desks[] required' });
    fs.writeFileSync(path.join(assetsDir, 'office-layout.json'), JSON.stringify({ width, height, desks, lounge }, null, 2));
    res.json({ ok: true });
  });

  app.get('/api/config', (req, res) => {
    const repoPath = path.resolve(defaultRepo);
    const config = loadConfig(repoPath);
    res.json(config);
  });

  app.post('/api/config', (req, res) => {
    const repoPath = path.resolve(defaultRepo);
    const { engine, model, verify, maxRetries, concurrency, budget, notify } = req.body ?? {};
    const config = loadConfig(repoPath);
    if (typeof engine === 'string') config.engine = engine;
    if (model !== undefined) config.model = model || undefined;
    if (verify !== undefined) config.verify = verify || undefined;
    if (maxRetries !== undefined) config.maxRetries = Number(maxRetries);
    if (concurrency !== undefined) config.concurrency = Number(concurrency);
    if (budget) {
      config.budget = config.budget ?? {};
      config.budget.perTask = (budget.perTask !== undefined && budget.perTask !== null && budget.perTask !== '') ? Number(budget.perTask) : undefined;
      config.budget.perDay = (budget.perDay !== undefined && budget.perDay !== null && budget.perDay !== '') ? Number(budget.perDay) : undefined;
    }
    if (notify) {
      config.notify = config.notify ?? {};
      config.notify.webhook = notify.webhook || undefined;
    }
    try {
      saveConfig(repoPath, config);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  const agentStreams = new Map<string, import('express').Response[]>();
  app.get('/api/agent-stream/:taskId', (req, res) => {
    const { taskId } = req.params;
    res.set({
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    res.flushHeaders();
    res.write(`data: {"type":"connected","taskId":"${taskId}"}\n\n`);

    if (!agentStreams.has(taskId)) agentStreams.set(taskId, []);
    agentStreams.get(taskId)!.push(res);

    const unsub = onEvent('message.sent', (data: any) => {
      if (data.toTask === taskId) {
        res.write(`event: message.sent\ndata: ${JSON.stringify(data)}\n\n`);
      }
    });

    const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
    req.on('close', () => {
      unsub();
      clearInterval(ping);
      const list = agentStreams.get(taskId);
      if (list) {
        const idx = list.indexOf(res);
        if (idx >= 0) list.splice(idx, 1);
        if (list.length === 0) agentStreams.delete(taskId);
      }
    });
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

  if (serveMcp) {
    const { mountMcpOnExpress } = await import('./mcp-server.js');
    mountMcpOnExpress(app, defaultRepo);
    console.log(`walle mcp → http://localhost:${port}/mcp`);
  }

  app.listen(port, () => {
    console.log(`walle dashboard → http://localhost:${port}  (repo: ${defaultRepo})`);
  });
}
