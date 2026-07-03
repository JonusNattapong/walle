import { randomUUID } from 'node:crypto';
import type { MemoryScope } from 'macp';
import {
  macpSetMemory, macpGetMemory, macpSearchMemory, macpListMemory, macpDeleteMemory,
} from './macp-bus.js';

const SYSTEM_AGENT = '_walle';

export interface MemoryEntry {
  id: string;
  key: string;
  value: string;
  scope: string;
  tags: string[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

function mapScope(scope?: string): { macpScope: MemoryScope; channelId?: string; agentId: string } {
  if (!scope || scope === 'global') {
    return { macpScope: 'workspace', agentId: SYSTEM_AGENT };
  }
  if (scope.startsWith('group:')) {
    return { macpScope: 'channel', channelId: scope.slice(6), agentId: SYSTEM_AGENT };
  }
  if (scope.startsWith('task:')) {
    return { macpScope: 'agent', agentId: scope.slice(5) };
  }
  return { macpScope: 'workspace', agentId: SYSTEM_AGENT };
}

function buildTags(scope?: string, tags?: string[], createdBy?: string): string[] {
  const result: string[] = ['walle-memory'];
  if (scope) result.push(`walle-scope:${scope}`);
  if (createdBy) result.push(`walle-creator:${createdBy}`);
  if (tags) result.push(...tags);
  return result;
}

function fromMacpEntry(e: { memoryId: string; key: string; value: string; scope: MemoryScope; tags: string[]; authorAgentId: string; createdAt: string; updatedAt: string; channelId: string | null }): MemoryEntry {
  const walleScope = e.tags.find((t) => t.startsWith('walle-scope:'))?.slice(12) ?? e.scope;
  const createdBy = e.tags.find((t) => t.startsWith('walle-creator:'))?.slice(14) ?? e.authorAgentId;
  const pureTags = e.tags.filter((t) => !t.startsWith('walle-'));
  return {
    id: e.memoryId,
    key: e.key,
    value: e.value,
    scope: walleScope,
    tags: pureTags,
    createdBy,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
}

export function memorySet(opts: {
  key: string;
  value: string;
  scope?: string;
  tags?: string[];
  createdBy?: string;
}): MemoryEntry {
  const { macpScope, channelId, agentId } = mapScope(opts.scope);
  const entry = macpSetMemory({
    agentId,
    sessionId: SYSTEM_AGENT,
    key: opts.key,
    value: opts.value,
    scope: macpScope,
    channelId,
    tags: buildTags(opts.scope, opts.tags, opts.createdBy),
  });
  return fromMacpEntry(entry);
}

export function memoryGet(opts: { key: string; scope?: string }): MemoryEntry | null {
  const { macpScope, channelId, agentId } = mapScope(opts.scope);
  const entry = macpGetMemory({
    agentId,
    sessionId: SYSTEM_AGENT,
    key: opts.key,
    scope: macpScope,
    channelId,
  });
  return entry ? fromMacpEntry(entry) : null;
}

export function memoryGetById(id: string): MemoryEntry | null {
  // MACP doesn't support direct ID lookup, search all workspace entries
  const results = macpSearchMemory({
    agentId: SYSTEM_AGENT,
    sessionId: SYSTEM_AGENT,
    query: '',
    scope: 'workspace',
    tags: ['walle-memory'],
  });
  return results.find((e) => e.memoryId === id) ? fromMacpEntry(results.find((e) => e.memoryId === id)!) : null;
}

export function memorySearch(opts: {
  query: string;
  scope?: string;
  tags?: string[];
}): MemoryEntry[] {
  const { macpScope, channelId, agentId } = mapScope(opts.scope);
  const searchTags = ['walle-memory'];
  if (opts.tags) searchTags.push(...opts.tags);
  if (!opts.query || !opts.query.trim()) {
    const results = macpListMemory({
      agentId,
      sessionId: SYSTEM_AGENT,
      scope: macpScope,
      channelId,
      tags: searchTags,
      limit: 200,
    });
    return results.map(fromMacpEntry);
  }
  const results = macpSearchMemory({
    agentId,
    sessionId: SYSTEM_AGENT,
    query: opts.query,
    scope: macpScope,
    channelId,
    tags: searchTags,
  });
  return results.map(fromMacpEntry);
}

export function memoryDelete(opts: { key: string; scope?: string }): boolean {
  const { macpScope, channelId, agentId } = mapScope(opts.scope);
  try {
    const count = macpDeleteMemory({
      agentId,
      sessionId: SYSTEM_AGENT,
      key: opts.key,
      scope: macpScope as MemoryScope,
      channelId,
    });
    return count > 0;
  } catch {
    return false;
  }
}

export function memoryDeleteById(id: string): boolean {
  // Find the entry first, then delete by key+scope
  const results = macpSearchMemory({
    agentId: SYSTEM_AGENT,
    sessionId: SYSTEM_AGENT,
    query: '',
    scope: 'workspace',
    tags: ['walle-memory'],
  });
  const entry = results.find((e) => e.memoryId === id);
  if (!entry) return false;
  try {
    macpDeleteMemory({
      agentId: SYSTEM_AGENT,
      sessionId: SYSTEM_AGENT,
      key: entry.key,
      scope: entry.scope,
      channelId: entry.channelId ?? undefined,
    });
    return true;
  } catch {
    return false;
  }
}

export function memoryList(opts: { scope?: string; tags?: string[] }): MemoryEntry[] {
  return memorySearch({ query: '', ...opts });
}
