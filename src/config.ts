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
