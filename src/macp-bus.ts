import { randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { mkdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { MacpCore, MacpWorkspaceExtensions, MacpProtocolError } from 'macp';
import type { MemoryEntry, MemoryScope } from 'macp';
import { emit } from './event-bus.js';

const DB_PATH = path.join(os.homedir(), '.walle', 'macp', 'bus.db');

export interface MacpAgent {
  agentId: string;
  sessionId: string;
  name: string;
}

export interface WalleMessage {
  id: string;
  threadId: string;
  fromTask: string;
  fromRole?: string;
  toTask: string;
  toRole?: string;
  subject: string;
  body: string;
  createdAt: string;
  read: boolean;
}

let core: MacpCore | undefined;
let ext: MacpWorkspaceExtensions | undefined;
let msgDb: DatabaseSync | undefined;

function getCore(): MacpCore {
  if (!core) {
    core = new MacpCore({ dbPath: DB_PATH });
  }
  return core;
}

function getExt(): MacpWorkspaceExtensions {
  if (!ext) {
    ext = new MacpWorkspaceExtensions({ dbPath: DB_PATH });
  }
  return ext;
}

function ensureSystemAgent(channelId?: string): void {
  const c = getCore();
  try {
    c.registerAgent({
      agentId: SYSTEM_AGENT,
      sessionId: SYSTEM_AGENT,
      name: 'walle system',
      capabilities: {},
      interestTags: [],
      queuePreferences: { maxPendingMessages: 1000 },
    });
  } catch {
    // already registered
  }
  if (channelId) {
    try {
      c.joinChannel({ agentId: SYSTEM_AGENT, sessionId: SYSTEM_AGENT, channelId });
    } catch {
      // already a member
    }
  }
}

const SYSTEM_AGENT = '_walle';

function getMsgDb(): DatabaseSync {
  if (!msgDb) {
    mkdirSync(path.dirname(DB_PATH), { recursive: true });
    msgDb = new DatabaseSync(DB_PATH);
    msgDb.exec(`CREATE TABLE IF NOT EXISTS walle_messages (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      from_task TEXT NOT NULL,
      from_role TEXT,
      to_task TEXT NOT NULL,
      to_role TEXT,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL,
      read INTEGER NOT NULL DEFAULT 0
    )`);
    msgDb.exec(`CREATE INDEX IF NOT EXISTS idx_wm_thread ON walle_messages(thread_id)`);
    msgDb.exec(`CREATE INDEX IF NOT EXISTS idx_wm_to ON walle_messages(to_task)`);
    msgDb.exec(`CREATE INDEX IF NOT EXISTS idx_wm_from ON walle_messages(from_task)`);
  }
  return msgDb;
}

export function closeMacp(): void {
  try { msgDb?.close(); } catch {}
  msgDb = undefined;
  try { ext?.close(); } catch {}
  try { core?.close(); } catch {}
  core = undefined;
  ext = undefined;
}

export function registerAgent(name: string, agentId?: string): MacpAgent {
  const c = getCore();
  const id = agentId ?? randomUUID().slice(0, 8);
  const sessionId = randomUUID();
  c.registerAgent({
    agentId: id,
    sessionId,
    name,
    capabilities: {},
    interestTags: [],
    queuePreferences: { maxPendingMessages: 200 },
  });
  return { agentId: id, sessionId, name };
}

export function deregisterAgent(agentId: string, sessionId: string): void {
  try { getCore().deregister({ agentId, sessionId }); } catch {}
}

export function joinChannel(agentId: string, sessionId: string, channelId: string): string[] {
  return getCore().joinChannel({ agentId, sessionId, channelId }).peerAgentIds;
}

export function sendToAgent(from: MacpAgent, toAgentId: string, subject: string, body: string, options?: {
  priority?: 0 | 1 | 2 | 3;
  threadId?: string;
}): { messageId: string; deliveryId: string } {
  const threadId = options?.threadId ?? randomUUID().slice(0, 8);
  const content = JSON.stringify({ subject, body, threadId });
  const result = getCore().sendDirect({
    from: { agentId: from.agentId, sessionId: from.sessionId, name: from.name },
    destinationAgentId: toAgentId,
    content,
    contentType: 'application/json',
    priority: options?.priority ?? 1,
    type: 'agent-message',
  });
  saveMessageMeta({
    id: result.messageId,
    threadId,
    fromTask: from.agentId,
    toTask: toAgentId,
    subject,
    body,
    createdAt: new Date().toISOString(),
    read: false,
  });
  return { messageId: result.messageId, deliveryId: result.deliveryIds[0] };
}

export function sendToChannel(from: MacpAgent, channelId: string, subject: string, body: string, options?: {
  priority?: 0 | 1 | 2 | 3;
}): { messageId: string; deliveryIds: string[] } {
  const threadId = randomUUID().slice(0, 8);
  const content = JSON.stringify({ subject, body, threadId });
  const result = getCore().sendChannel({
    from: { agentId: from.agentId, sessionId: from.sessionId, name: from.name },
    channelId,
    content,
    contentType: 'application/json',
    priority: options?.priority ?? 1,
    type: 'channel-message',
  });
  for (const recipient of result.recipientAgentIds) {
    saveMessageMeta({
      id: randomUUID().slice(0, 8),
      threadId,
      fromTask: from.agentId,
      toTask: recipient,
      subject,
      body,
      createdAt: new Date().toISOString(),
      read: false,
    });
  }
  return { messageId: result.messageId, deliveryIds: result.deliveryIds };
}

export interface DeliveryMessage {
  deliveryId: string;
  messageId: string;
  fromAgentId: string;
  fromName: string;
  priority: number;
  type: string;
  subject: string;
  body: string;
  threadId?: string;
  timestamp: string;
  state: string;
}

export function pollInbox(agentId: string, maxMessages?: number): DeliveryMessage[] {
  const result = getCore().poll({ agentId, maxMessages: maxMessages ?? 20, applyBudgetPruning: false });
  return result.deliveries.map((d) => {
    let subject = '';
    let body = '';
    let threadId: string | undefined;
    try {
      const parsed = JSON.parse(d.content);
      subject = parsed.subject ?? '';
      body = parsed.body ?? '';
      threadId = parsed.threadId;
    } catch {
      body = d.content;
    }
    return {
      deliveryId: d.deliveryId,
      messageId: d.messageId,
      fromAgentId: d.from.agentId,
      fromName: d.from.name,
      priority: d.priority,
      type: d.type,
      subject,
      body,
      threadId,
      timestamp: d.timestamp,
      state: d.state,
    };
  });
}

export function ackDelivery(deliveryId: string): void {
  getCore().ack({ deliveryId });
}

export function getUnreadCount(agentId: string): number {
  try {
    const result = getCore().poll({ agentId, maxMessages: 100, applyBudgetPruning: false });
    return result.deliveries.length;
  } catch {
    return 0;
  }
}

export function listAgents(): { agentId: string; name: string; status: string; channels: string[] }[] {
  return getExt().listAgents().agents.map((a) => ({
    agentId: a.agentId,
    name: a.name,
    status: a.status,
    channels: a.channels,
  }));
}

// Memory wrappers

export function macpSetMemory(opts: {
  agentId: string;
  sessionId: string;
  key: string;
  value: string;
  scope?: MemoryScope;
  channelId?: string;
  tags?: string[];
}): MemoryEntry {
  ensureSystemAgent(opts.scope === 'channel' ? opts.channelId : undefined);
  return getExt().setMemory({
    agentId: opts.agentId,
    sessionId: opts.sessionId,
    scope: opts.scope ?? 'workspace',
    key: opts.key,
    value: opts.value,
    channelId: opts.channelId,
    tags: opts.tags,
  }).entry;
}

export function macpGetMemory(opts: {
  agentId: string;
  sessionId: string;
  key: string;
  scope?: MemoryScope;
  channelId?: string;
}): MemoryEntry | null {
  ensureSystemAgent(opts.scope === 'channel' ? opts.channelId : undefined);
  const result = getExt().getMemory({
    agentId: opts.agentId,
    sessionId: opts.sessionId,
    key: opts.key,
    scope: opts.scope,
    channelId: opts.channelId,
  });
  return result.entries[0] ?? null;
}

export function macpListMemory(opts: {
  agentId: string;
  sessionId: string;
  scope?: MemoryScope;
  channelId?: string;
  tags?: string[];
  limit?: number;
}): MemoryEntry[] {
  ensureSystemAgent(opts.scope === 'channel' ? opts.channelId : undefined);
  return getExt().listMemories({
    agentId: opts.agentId,
    sessionId: opts.sessionId,
    scope: opts.scope,
    channelId: opts.channelId,
    tags: opts.tags,
    limit: opts.limit,
  }).entries;
}

export function macpSearchMemory(opts: {
  agentId: string;
  sessionId: string;
  query: string;
  scope?: MemoryScope;
  channelId?: string;
  tags?: string[];
}): MemoryEntry[] {
  ensureSystemAgent(opts.scope === 'channel' ? opts.channelId : undefined);
  return getExt().searchMemory({
    agentId: opts.agentId,
    sessionId: opts.sessionId,
    query: opts.query,
    scope: opts.scope,
    channelId: opts.channelId,
    tags: opts.tags,
  }).entries;
}

export function macpDeleteMemory(opts: {
  agentId: string;
  sessionId: string;
  key: string;
  scope: MemoryScope;
  channelId?: string;
}): number {
  ensureSystemAgent(opts.scope === 'channel' ? opts.channelId : undefined);
  return getExt().deleteMemory({
    agentId: opts.agentId,
    sessionId: opts.sessionId,
    key: opts.key,
    scope: opts.scope,
    channelId: opts.channelId,
  }).archivedCount;
}

export function getSessionContext(agentId: string, sessionId: string, channelId?: string) {
  return getExt().getSessionContext({ agentId, sessionId, channelId });
}

export function claimFiles(opts: {
  agentId: string;
  sessionId: string;
  files: string[];
  ttlSeconds?: number;
  reason?: string;
}) {
  return getExt().claimFiles({ ...opts, ...opts });
}

export function releaseFiles(opts: {
  agentId: string;
  sessionId: string;
  files: string[];
  reason?: string;
}) {
  return getExt().releaseFiles({ ...opts, ...opts });
}

export function listFileClaims(agentId?: string, files?: string[]) {
  return getExt().listFileClaims({ agentId, files }).claims;
}

// --- Walle message metadata (persistent thread/inbox tracking) ---

export function saveMessageMeta(msg: WalleMessage): void {
  const db = getMsgDb();
  db.prepare(`INSERT OR REPLACE INTO walle_messages (id, thread_id, from_task, from_role, to_task, to_role, subject, body, created_at, read) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    msg.id, msg.threadId, msg.fromTask, msg.fromRole ?? null, msg.toTask, msg.toRole ?? null,
    msg.subject, msg.body, msg.createdAt, msg.read ? 1 : 0,
  );
  emit('message.sent', msg);
}

export function getInboxMessages(taskId: string, unreadOnly?: boolean): WalleMessage[] {
  const db = getMsgDb();
  if (unreadOnly) {
    return db.prepare(`SELECT * FROM walle_messages WHERE to_task = ? AND read = 0 ORDER BY created_at ASC`).all(taskId).map(rowToMessage);
  }
  return db.prepare(`SELECT * FROM walle_messages WHERE to_task = ? ORDER BY created_at ASC`).all(taskId).map(rowToMessage);
}

export function getSentMessages(taskId: string): WalleMessage[] {
  const db = getMsgDb();
  return db.prepare(`SELECT * FROM walle_messages WHERE from_task = ? ORDER BY created_at ASC`).all(taskId).map(rowToMessage);
}

export function getThreadMessages(threadId: string): WalleMessage[] {
  const db = getMsgDb();
  return db.prepare(`SELECT * FROM walle_messages WHERE thread_id = ? ORDER BY created_at ASC`).all(threadId).map(rowToMessage);
}

export function markMessageRead(messageId: string): void {
  const db = getMsgDb();
  db.prepare(`UPDATE walle_messages SET read = 1 WHERE id = ?`).run(messageId);
}

export function getUnreadMessageCount(taskId: string): number {
  const db = getMsgDb();
  const row = db.prepare(`SELECT COUNT(*) AS cnt FROM walle_messages WHERE to_task = ? AND read = 0`).get(taskId) as { cnt: number };
  return row?.cnt ?? 0;
}

export function getAllConversations(taskId: string): { threadId: string; subject: string; lastMessage: string; unread: number }[] {
  const db = getMsgDb();
  const rows = db.prepare(`
    SELECT thread_id, subject, MAX(created_at) AS last_msg,
      SUM(CASE WHEN to_task = ? AND read = 0 THEN 1 ELSE 0 END) AS unread
    FROM walle_messages
    WHERE from_task = ? OR to_task = ?
    GROUP BY thread_id
    ORDER BY last_msg DESC
  `).all(taskId, taskId, taskId) as { thread_id: string; subject: string; last_msg: string; unread: number }[];
  return rows.map((r) => ({
    threadId: r.thread_id,
    subject: r.subject,
    lastMessage: r.last_msg,
    unread: r.unread,
  }));
}

function rowToMessage(row: unknown): WalleMessage {
  const r = row as Record<string, unknown>;
  return {
    id: r.id as string,
    threadId: r.thread_id as string,
    fromTask: r.from_task as string,
    fromRole: r.from_role as string || undefined,
    toTask: r.to_task as string,
    toRole: r.to_role as string || undefined,
    subject: r.subject as string,
    body: r.body as string,
    createdAt: r.created_at as string,
    read: Boolean(r.read),
  };
}
