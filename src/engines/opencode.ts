import { spawn } from 'node:child_process';
import readline from 'node:readline';
import type { EngineAdapter, EngineRun } from './adapter.js';
import type { WalleEvent } from '../types.js';
import { findExecutable, needsShell } from '../exec-utils.js';

function quoteForCmd(arg: string): string {
  return `"${arg.replace(/"/g, '""')}"`;
}

export const opencodeAdapter: EngineAdapter = {
  name: 'opencode',

  run({ taskId, prompt, cwd, model, onEvent }): EngineRun {
    const bin = findExecutable('opencode');
    if (!bin) {
      onEvent({ type: 'task.started', taskId });
      return {
        done: Promise.resolve({
          success: false,
          error: 'opencode CLI not found on PATH — install opencode first',
        }),
        kill: () => {},
      };
    }

    const args = ['run', prompt, '--format', 'json', '--auto'];
    if (model) args.push('--model', model);
    
    const useShell = needsShell(bin);
    const child = useShell
      ? spawn(quoteForCmd(bin), args.map(quoteForCmd), { cwd, shell: true, stdio: ['ignore', 'pipe', 'pipe'] })
      : spawn(bin, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });

    onEvent({ type: 'task.started', taskId });

    const rl = readline.createInterface({ input: child.stdout });
    let resultError: string | undefined;

    rl.on('line', (line) => {
      let msg: any;
      try {
        msg = JSON.parse(line);
      } catch {
        if (line.trim()) {
          onEvent({ type: 'agent.message', taskId, text: line.trim() });
        }
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
        const filePath = block.input?.file_path || block.input?.path;
        if (filePath && ['Write', 'Edit', 'NotebookEdit', 'replace_file_content', 'write_to_file'].includes(block.name)) {
          events.push({ type: 'file.changed', taskId, path: filePath });
        }
      }
    }
    return events;
  }
  
  if (msg.type === 'message' || msg.type === 'text' || msg.type === 'agent.message') {
    const text = msg.text || msg.content || (msg.message && (msg.message.text || msg.message.content));
    if (text && typeof text === 'string') {
      events.push({ type: 'agent.message', taskId, text });
    }
  }
  if (msg.type === 'tool_call' || msg.type === 'tool_use' || msg.type === 'tool.used') {
    const toolName = msg.name || msg.tool || msg.toolName;
    if (toolName) {
      events.push({ type: 'tool.used', taskId, tool: toolName });
      const filePath = msg.path || msg.filePath || (msg.arguments && (msg.arguments.path || msg.arguments.filePath || msg.arguments.file_path));
      if (filePath) {
        events.push({ type: 'file.changed', taskId, path: filePath });
      }
    }
  }
  
  return events;
}
