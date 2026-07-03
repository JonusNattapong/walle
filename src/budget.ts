import type { WalleConfig } from './types.js';
import { costToday } from './store.js';

export interface BudgetCheck {
  ok: boolean;
  reason?: string;
}

export function checkBudget(config: WalleConfig, taskCostUsd: number): BudgetCheck {
  const { perTask, perDay } = config.budget;
  if (perTask !== undefined && taskCostUsd >= perTask) {
    return { ok: false, reason: `task cost $${taskCostUsd.toFixed(2)} hit per-task budget $${perTask}` };
  }
  if (perDay !== undefined && costToday() >= perDay) {
    return { ok: false, reason: `daily cost hit per-day budget $${perDay}` };
  }
  return { ok: true };
}
