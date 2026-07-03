export type TaskStatus =
  | 'queued'
  | 'running'
  | 'verifying'
  | 'done'
  | 'failed'
  | 'cancelled';

export interface Task {
  id: string;
  prompt: string;
  repo: string;
  engine: string;
  branch: string;
  worktree: string;
  status: TaskStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  costUsd: number;
  retries: number;
  error?: string;
  /** OS pid of the running engine process, if any */
  pid?: number;
}

export type WalleEvent =
  | { type: 'task.started'; taskId: string }
  | { type: 'agent.message'; taskId: string; text: string }
  | { type: 'file.changed'; taskId: string; path: string }
  | { type: 'tool.used'; taskId: string; tool: string }
  | { type: 'cost.updated'; taskId: string; costUsd: number }
  | { type: 'agent.blocked'; taskId: string; reason: string }
  | { type: 'task.finished'; taskId: string; success: boolean; error?: string };

export interface WalleConfig {
  engine: string;
  verify?: string;
  maxRetries: number;
  concurrency: number;
  budget: {
    perTask?: number;
    perDay?: number;
  };
  notify?: {
    webhook?: string;
  };
}

export const DEFAULT_CONFIG: WalleConfig = {
  engine: 'claude',
  maxRetries: 2,
  concurrency: 2,
  budget: {},
};
