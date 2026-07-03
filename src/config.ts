import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { DEFAULT_CONFIG, type WalleConfig } from './types.js';

/** Load walle.yaml from the repo root, merged over defaults. */
export function loadConfig(repo: string): WalleConfig {
  const file = path.join(repo, 'walle.yaml');
  if (!fs.existsSync(file)) return { ...DEFAULT_CONFIG };
  const raw = YAML.parse(fs.readFileSync(file, 'utf8')) ?? {};
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    budget: { ...DEFAULT_CONFIG.budget, ...(raw.budget ?? {}) },
    notify: raw.notify,
  };
}

export function saveConfig(repo: string, config: WalleConfig): void {
  const file = path.join(repo, 'walle.yaml');
  const raw: any = {
    engine: config.engine,
    maxRetries: Number(config.maxRetries),
    concurrency: Number(config.concurrency),
  };
  if (config.model) raw.model = config.model;
  if (config.verify) raw.verify = config.verify;
  if (config.budget) {
    raw.budget = {};
    if (config.budget.perTask !== undefined && config.budget.perTask !== null && !isNaN(config.budget.perTask)) {
      raw.budget.perTask = Number(config.budget.perTask);
    }
    if (config.budget.perDay !== undefined && config.budget.perDay !== null && !isNaN(config.budget.perDay)) {
      raw.budget.perDay = Number(config.budget.perDay);
    }
  }
  if (config.notify) {
    raw.notify = {};
    if (config.notify.webhook !== undefined) {
      raw.notify.webhook = config.notify.webhook;
    }
  }
  fs.writeFileSync(file, YAML.stringify(raw), 'utf8');
}
