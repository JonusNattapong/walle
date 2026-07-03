import { spawn } from 'node:child_process';
import readline from 'node:readline';
import type { EngineAdapter, EngineRun } from './adapter.js';
import type { WalleEvent } from '../types.js';

/**
 * Runs Claude Code headless (`claude -p --output-format stream-json`) and
 * translates its stream-json events into walle's normalized event set.
 */
export const claudeAdapter: EngineAdapter = {
  name: 'claude',

  run({ taskId, prompt, cwd, onEvent }): EngineRun {
    const child = spawn(
      'claude',
      ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits'],
      { cwd, shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'pipe'] },
    );

    onEvent({ type: 'task.started', taskId });

    const rl = readline.createInterface({ input: child.stdout });
    let resultError: string | undefined;

    rl.on('line', (line) => {
      let msg: any;
      try {
        msg = JSON.parse(line);
      } catch {
        return;
      }
      for (const e of translate(taskId, msg)) onEvent(e);
      if (msg.type === 'result') {
        if (msg.is_error) resultError = msg.result ?? 'engine reported error';
        if (typeof msg.total_cost_usd === 'number') {
          onEvent({ type: 'cost.updated', taskId, costUsd: msg.total_cost_usd });
        }
      }
    });

    let stderr = '';
    child.stderr.on('data', (d) => (stderr += d));

    const done = new Promise<{ success: boolean; error?: string }>((resolve) => {
      child.on('close', (code) => {
        const success = code === 0 && !resultError;
        resolve({
          success,
          error: success ? undefined : resultError ?? stderr.slice(-500) ?? `exit code ${code}`,
        });
      });
      child.on('error', (err) => resolve({ success: false, error: err.message }));
    });

    return { done, pid: child.pid, kill: () => child.kill() };
  },
};

function translate(taskId: string, msg: any): WalleEvent[] {
  const events: WalleEvent[] = [];
  if (msg.type === 'assistant' && msg.message?.content) {
    for (const block of msg.message.content) {
      if (block.type === 'text' && block.text) {
        events.push({ type: 'agent.message', taskId, text: block.text });
      } else if (block.type === 'tool_use') {
        events.push({ type: 'tool.used', taskId, tool: block.name });
        const filePath = block.input?.file_path;
        if (filePath && ['Write', 'Edit', 'NotebookEdit'].includes(block.name)) {
          events.push({ type: 'file.changed', taskId, path: filePath });
        }
      }
    }
  }
  return events;
}
