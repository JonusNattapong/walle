import type { WalleConfig } from './types.js';
import type { Task } from './types.js';

export async function notify(config: WalleConfig, task: Task, message: string): Promise<void> {
  const url = config.notify?.webhook;
  if (!url) return;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: `[walle] ${task.id} (${task.status}): ${message}` }),
    });
  } catch {
    // notifications are best-effort
  }
}
