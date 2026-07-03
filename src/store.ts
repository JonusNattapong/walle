import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Task, WalleEvent } from './types.js';

const ROOT = path.join(os.homedir(), '.walle');
const TASKS_DIR = path.join(ROOT, 'tasks');

function ensureDirs(): void {
  fs.mkdirSync(TASKS_DIR, { recursive: true });
}

function taskFile(id: string): string {
  return path.join(TASKS_DIR, `${id}.json`);
}

function eventsFile(id: string): string {
  return path.join(TASKS_DIR, `${id}.events.jsonl`);
}

export function saveTask(task: Task): void {
  ensureDirs();
  fs.writeFileSync(taskFile(task.id), JSON.stringify(task, null, 2));
}

export function loadTask(id: string): Task | undefined {
  const file = taskFile(id);
  if (!fs.existsSync(file)) return undefined;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function listTasks(): Task[] {
  ensureDirs();
  return fs
    .readdirSync(TASKS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(TASKS_DIR, f), 'utf8')) as Task)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function appendEvent(event: WalleEvent): void {
  ensureDirs();
  fs.appendFileSync(eventsFile(event.taskId), JSON.stringify(event) + '\n');
}

export function loadEvents(id: string): WalleEvent[] {
  const file = eventsFile(id);
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

/** Total cost of tasks created today (for the daily budget guard). */
export function costToday(): number {
  const today = new Date().toISOString().slice(0, 10);
  return listTasks()
    .filter((t) => t.createdAt.startsWith(today))
    .reduce((sum, t) => sum + t.costUsd, 0);
}
