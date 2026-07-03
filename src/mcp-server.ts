import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import path from 'node:path';
import { loadConfig } from './config.js';
import { listTasks, loadEvents, loadTask, saveTask } from './store.js';
import { createTask, createMultiTask, drainQueue } from './runner.js';
import { diffWorktree, mergeBranch, removeWorktree } from './worktree.js';
import { sendMessage, getInbox, getSent, getThread, markRead, getUnreadCount, getAllConversations } from './message-bus.js';
import { memorySet, memoryGet, memoryGetById, memorySearch, memoryDelete, memoryDeleteById, memoryList } from './memory.js';
import { emit } from './event-bus.js';
import {
  registerAgent, joinChannel, listAgents, getSessionContext,
  pollInbox, ackDelivery, sendToChannel, listFileClaims,
  macpSetMemory, macpGetMemory, macpSearchMemory, macpDeleteMemory,
} from './macp-bus.js';

function formatEvent(e: { type: string; [key: string]: unknown }): string {
  switch (e.type) {
    case 'task.started':
      return `▶ started`;
    case 'agent.message':
      return `💬 ${String(e.text ?? '').slice(0, 200)}`;
    case 'tool.used':
      return `🔧 ${String(e.tool)}`;
    case 'file.changed':
      return `📝 ${String(e.path)}`;
    case 'cost.updated':
      return `💲 $${Number(e.costUsd).toFixed(4)}`;
    case 'agent.blocked':
      return `⏸ blocked: ${String(e.reason)}`;
    case 'task.finished':
      return e.success ? '✅ finished' : `❌ failed: ${String(e.error)}`;
    default:
      return JSON.stringify(e);
  }
}

export function createMcpServer(cwd?: string): McpServer {
  const server = new McpServer(
    { name: 'walle', version: '0.1.0' },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    },
  );

  const repo = cwd ?? process.cwd();

  server.tool(
    'walle_do',
    'Queue a coding-agent task. For single-agent: set prompt. For multi-agent: set roles as JSON array.',
    {
      prompt: z.string().optional().describe('Single-agent prompt (leave blank if using roles)'),
      roles: z.string().optional().describe('Multi-agent: JSON array of {role, prompt, dependsOn?, model?}'),
      queueOnly: z.boolean().optional().describe('Only queue, do not run immediately'),
      model: z.string().optional().describe('Model override (single-agent only)'),
      visible: z.boolean().optional().describe('Open agent in a visible terminal window'),
    },
    async ({ prompt, roles, queueOnly, model, visible }) => {
      const config = loadConfig(repo);
      if (roles) {
        let parsed: { role: string; prompt: string; dependsOn?: string[]; model?: string }[];
        try { parsed = JSON.parse(roles); } catch {
          return { content: [{ type: 'text', text: 'Invalid roles JSON' }], isError: true };
        }
        if (!Array.isArray(parsed) || parsed.length === 0) {
          return { content: [{ type: 'text', text: 'roles must be a non-empty array' }], isError: true };
        }
        // Map role names to task IDs by running order
        const roleTasks: { role: string; prompt: string; model?: string; dependsOn?: string[] }[] = parsed;
        // Resolve dependsOn role names to task IDs (indices in the same array)
        const resolved = roleTasks.map((r, i) => ({
          ...r,
          dependsOn: r.dependsOn?.map((depRole: string) => {
            const idx = roleTasks.findIndex((x) => x.role === depRole);
            return idx >= 0 && idx < i ? String(idx) : undefined;
          }).filter(Boolean) as string[] | undefined,
        }));
        const spec = { roles: resolved };
        const tasks = createMultiTask(spec, repo, config);
        if (queueOnly) {
          return { content: [{ type: 'text', text: `queued ${tasks.length} tasks in group ${tasks[0].groupId}: ${tasks.map(t => `${t.role} (${t.id})`).join(', ')}` }] };
        }
        await drainQueue(config);
        const lines = tasks.map((t) => {
          const done = loadTask(t.id)!;
          return `${done.role} (${done.id}) → ${done.status}${done.error ? `: ${done.error}` : ''}`;
        });
        return { content: [{ type: 'text', text: lines.join('\n') }] };
      }
      if (!prompt) {
        return { content: [{ type: 'text', text: 'provide prompt (single-agent) or roles (multi-agent)' }], isError: true };
      }
      if (model) config.model = model;
      const task = createTask(prompt, repo, config, visible);
      if (queueOnly) {
        return { content: [{ type: 'text', text: `queued ${task.id}: ${prompt}` }] };
      }
      await drainQueue(config);
      const done = loadTask(task.id)!;
      const output = [`${done.id} → ${done.status}${done.error ? `\n${done.error}` : ''}`];
      if (done.status === 'done') {
        output.push(`review with: walle diff ${done.id}  |  accept with: walle merge ${done.id}`);
      }
      return { content: [{ type: 'text', text: output.join('\n') }] };
    },
  );

  server.tool(
    'walle_ls',
    'List all tasks with status and cost',
    {
      json: z.boolean().optional().describe('Return JSON format'),
    },
    async ({ json }) => {
      const tasks = listTasks();
      if (json) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                tasks.map((t) => ({
                  id: t.id,
                  status: t.status,
                  costUsd: t.costUsd,
                  prompt: t.prompt,
                  createdAt: t.createdAt,
                })),
                null,
                2,
              ),
            },
          ],
        };
      }
      if (tasks.length === 0) {
        return { content: [{ type: 'text', text: 'no tasks yet' }] };
      }
      const lines = tasks.map((t) => {
        const cost = t.costUsd ? ` $${t.costUsd.toFixed(2)}` : '';
        return `${t.id}  ${t.status.padEnd(9)}${cost}  ${t.prompt.slice(0, 60)}`;
      });
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    },
  );

  server.tool(
    'walle_show',
    'Show task details, timeline, cost, and status',
    {
      id: z.string().describe('Task ID'),
    },
    async ({ id }) => {
      const task = loadTask(id);
      if (!task) return { content: [{ type: 'text', text: `no such task: ${id}` }], isError: true };
      const lines: string[] = [];
      lines.push(`task    ${task.id} (${task.status})`);
      lines.push(`prompt  ${task.prompt}`);
      lines.push(`repo    ${task.repo}`);
      if (task.branch) lines.push(`branch  ${task.branch}`);
      lines.push(`cost    $${task.costUsd.toFixed(4)}  retries ${task.retries}`);
      if (task.error) lines.push(`error   ${task.error}`);
      lines.push('--- timeline ---');
      for (const e of loadEvents(id)) lines.push(formatEvent(e as any));
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    },
  );

  server.tool(
    'walle_logs',
    'Print raw events for a task',
    {
      id: z.string().describe('Task ID'),
    },
    async ({ id }) => {
      const task = loadTask(id);
      if (!task) return { content: [{ type: 'text', text: `no such task: ${id}` }], isError: true };
      const events = loadEvents(id);
      if (events.length === 0) return { content: [{ type: 'text', text: 'no events yet' }] };
      const lines = events.map((e) => formatEvent(e as any));
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    },
  );

  server.tool(
    'walle_diff',
    'Show the diff produced by a task',
    {
      id: z.string().describe('Task ID'),
    },
    async ({ id }) => {
      const task = loadTask(id);
      if (!task) return { content: [{ type: 'text', text: `no such task: ${id}` }], isError: true };
      if (!task.branch) return { content: [{ type: 'text', text: `task ${id} has no branch yet` }], isError: true };
      try {
        const diff = await diffWorktree(task.repo, task.branch);
        return { content: [{ type: 'text', text: diff || '(no diff — no changes made)' }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `failed to get diff: ${err}` }], isError: true };
      }
    },
  );

  server.tool(
    'walle_merge',
    'Merge a finished task into the current branch',
    {
      id: z.string().describe('Task ID'),
    },
    async ({ id }) => {
      const task = loadTask(id);
      if (!task) return { content: [{ type: 'text', text: `no such task: ${id}` }], isError: true };
      if (task.status !== 'done') {
        return { content: [{ type: 'text', text: `task ${id} is ${task.status}, not done` }], isError: true };
      }
      try {
        await mergeBranch(task.repo, task.branch);
        await removeWorktree(task.repo, task.worktree, task.branch);
        task.status = 'merged';
        saveTask(task);
        return { content: [{ type: 'text', text: `merged ${task.branch} and cleaned up worktree` }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `merge failed: ${err}` }], isError: true };
      }
    },
  );

  server.tool(
    'walle_cancel',
    'Cancel a task and clean up its worktree',
    {
      id: z.string().describe('Task ID'),
    },
    async ({ id }) => {
      const task = loadTask(id);
      if (!task) return { content: [{ type: 'text', text: `no such task: ${id}` }], isError: true };
      if (task.pid) {
        try {
          process.kill(task.pid);
        } catch {}
      }
      if (task.worktree) {
        try {
          await removeWorktree(task.repo, task.worktree, task.branch);
        } catch {}
      }
      task.status = 'cancelled';
      saveTask(task);
      return { content: [{ type: 'text', text: `cancelled ${task.id}` }] };
    },
  );

  // --- Message bus tools ---

  server.tool(
    'walle_send',
    'Send a message to another task (agent-to-agent communication)',
    {
      fromTask: z.string().describe('Your task ID (who is sending this)'),
      toTask: z.string().describe('Target task ID'),
      toRole: z.string().optional().describe('Target role name (optional)'),
      subject: z.string().describe('Message subject'),
      body: z.string().describe('Message body'),
      threadId: z.string().optional().describe('Existing thread ID to reply in (omit for new thread)'),
    },
    async ({ fromTask, toTask, toRole, subject, body, threadId }) => {
      const msg = sendMessage({
        fromTask,
        fromRole: undefined,
        toTask,
        toRole,
        subject,
        body,
        threadId,
      });
      emit('message.sent', msg);
      return { content: [{ type: 'text', text: `sent to ${toTask} (thread: ${msg.threadId})` }] };
    },
  );

  server.tool(
    'walle_inbox',
    'Read messages for a task',
    {
      taskId: z.string().describe('Task ID to check inbox for'),
      unreadOnly: z.boolean().optional().describe('Only show unread messages'),
    },
    async ({ taskId, unreadOnly }) => {
      const msgs = getInbox(taskId);
      const filtered = unreadOnly ? msgs.filter((m) => !m.read) : msgs;
      if (filtered.length === 0) {
        return { content: [{ type: 'text', text: 'no messages' }] };
      }
      const lines = filtered.map((m) => {
        const tag = m.read ? ' ' : '●';
        const from = m.fromRole ? `${m.fromRole} (${m.fromTask})` : m.fromTask;
        return `${tag} [${m.threadId.slice(0, 8)}] ${from}: ${m.subject}\n   ${m.body.slice(0, 200)}`;
      });
      // Mark as read
      for (const m of filtered) markRead(m.id);
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    },
  );

  server.tool(
    'walle_conversation',
    'View a full message thread',
    {
      threadId: z.string().describe('Thread ID to view'),
    },
    async ({ threadId }) => {
      const msgs = getThread(threadId);
      if (msgs.length === 0) {
        return { content: [{ type: 'text', text: 'no messages in this thread' }] };
      }
      const lines = msgs.map((m) => {
        const from = m.fromRole ? `${m.fromRole} (${m.fromTask})` : m.fromTask;
        const to = m.toRole ? `${m.toRole} (${m.toTask})` : m.toTask;
        return `[${new Date(m.createdAt).toLocaleTimeString()}] ${from} → ${to}\n   ${m.body}`;
      });
      return { content: [{ type: 'text', text: lines.join('\n\n') }] };
    },
  );

  server.tool(
    'walle_conversations',
    'List all conversation threads for a task',
    {
      taskId: z.string().describe('Task ID'),
    },
    async ({ taskId }) => {
      const threads = getAllConversations(taskId);
      if (threads.length === 0) {
        return { content: [{ type: 'text', text: 'no conversations' }] };
      }
      const lines = threads.map((t) => {
        const unreadTag = t.unread > 0 ? ` (${t.unread} unread)` : '';
        return `${t.threadId.slice(0, 8)}  ${t.subject}${unreadTag}`;
      });
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    },
  );

  server.tool(
    'walle_sent',
    'View messages sent by a task',
    {
      taskId: z.string().describe('Task ID'),
    },
    async ({ taskId }) => {
      const msgs = getSent(taskId);
      if (msgs.length === 0) {
        return { content: [{ type: 'text', text: 'no sent messages' }] };
      }
      const lines = msgs.map((m) => {
        const to = m.toRole ? `${m.toRole} (${m.toTask})` : m.toTask;
        return `→ ${to}: ${m.subject}\n   ${m.body.slice(0, 200)}`;
      });
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    },
  );

  server.tool(
    'walle_unread',
    'Check unread message count for a task',
    {
      taskId: z.string().describe('Task ID'),
    },
    async ({ taskId }) => {
      const count = getUnreadCount(taskId);
      return { content: [{ type: 'text', text: count > 0 ? `${count} unread` : 'no unread messages' }] };
    },
  );

  // --- Memory tools ---

  server.tool(
    'walle_memory_set',
    'Store a memory entry (key-value) for sharing context between agents. If key+scope exists, updates it.',
    {
      key: z.string().describe('Unique key within scope'),
      value: z.string().describe('Content to store'),
      scope: z.string().optional().describe('Scope: global | group:<id> | task:<id> (default: global)'),
      tags: z.string().optional().describe('Comma-separated tags for search'),
      createdBy: z.string().optional().describe('Who is writing this (task ID or role)'),
    },
    async ({ key, value, scope, tags, createdBy }) => {
      const entry = memorySet({
        key,
        value,
        scope,
        tags: tags ? tags.split(',').map((t) => t.trim()) : undefined,
        createdBy,
      });
      return { content: [{ type: 'text', text: `stored ${entry.key} (${entry.id}) in scope: ${entry.scope}` }] };
    },
  );

  server.tool(
    'walle_memory_get',
    'Read a memory entry by key and optional scope',
    {
      key: z.string().describe('Key to look up'),
      scope: z.string().optional().describe('Scope (default: global)'),
    },
    async ({ key, scope }) => {
      const entry = memoryGet({ key, scope });
      if (!entry) return { content: [{ type: 'text', text: `no entry found for "${key}"` }], isError: true };
      return {
        content: [
          { type: 'text', text: `[${entry.scope}] ${entry.key} (tags: ${entry.tags.join(', ') || 'none'})\n---\n${entry.value}` },
        ],
      };
    },
  );

  server.tool(
    'walle_memory_search',
    'Search memory entries by keyword. Returns matching entries sorted by relevance.',
    {
      query: z.string().describe('Search keywords'),
      scope: z.string().optional().describe('Filter by scope'),
      tags: z.string().optional().describe('Filter by comma-separated tags'),
    },
    async ({ query, scope, tags }) => {
      const results = memorySearch({
        query,
        scope,
        tags: tags ? tags.split(',').map((t) => t.trim()) : undefined,
      });
      if (results.length === 0) return { content: [{ type: 'text', text: 'no results' }] };
      const lines = results.map((e, i) => {
        const preview = e.value.slice(0, 120).replace(/\n/g, ' ');
        return `${i + 1}. [${e.scope}] ${e.key} (tags: ${e.tags.join(', ') || 'none'})\n   ${preview}...`;
      });
      return { content: [{ type: 'text', text: `found ${results.length} results:\n\n` + lines.join('\n\n') }] };
    },
  );

  server.tool(
    'walle_memory_list',
    'List memory entries, optionally filtered by scope or tags',
    {
      scope: z.string().optional().describe('Filter by scope'),
      tags: z.string().optional().describe('Filter by comma-separated tags'),
    },
    async ({ scope, tags }) => {
      const entries = memoryList({
        scope,
        tags: tags ? tags.split(',').map((t) => t.trim()) : undefined,
      });
      if (entries.length === 0) return { content: [{ type: 'text', text: 'no entries' }] };
      const lines = entries.map((e) => {
        const preview = e.value.slice(0, 80).replace(/\n/g, ' ');
        return `${e.key.padEnd(20)} [${e.scope}]  ${preview}...`;
      });
      return { content: [{ type: 'text', text: `${entries.length} entries:\n` + lines.join('\n') }] };
    },
  );

  server.tool(
    'walle_memory_delete',
    'Delete a memory entry by key and optional scope',
    {
      key: z.string().describe('Key to delete'),
      scope: z.string().optional().describe('Scope (default: global)'),
    },
    async ({ key, scope }) => {
      const ok = memoryDelete({ key, scope });
      return { content: [{ type: 'text', text: ok ? `deleted "${key}"` : `not found: "${key}"` }] };
    },
  );

  server.tool(
    'walle_subscribe',
    'Get the SSE URL for real-time notifications of new messages for your task',
    {
      taskId: z.string().describe('Your task ID to subscribe for notifications'),
      baseUrl: z.string().optional().describe('Server base URL (default: http://localhost:4711)'),
    },
    async ({ taskId, baseUrl }) => {
      const url = `${baseUrl || 'http://localhost:4711'}/api/agent-stream/${taskId}`;
      return {
        content: [
          { type: 'text', text: `Subscribe at:\n${url}\n\nEvents: message.sent, task.update\n\nClient example:\nconst es = new EventSource("${url}");\nes.addEventListener("message", (e) => console.log(e.data));` },
        ],
      };
    },
  );

  // --- MACP (Multi-Agent Cognition Protocol) tools ---

  server.tool(
    'walle_agent_register',
    'Register this agent in the MACP bus for multi-agent collaboration',
    {
      name: z.string().describe('Human-readable agent name'),
      agentId: z.string().optional().describe('Optional agent ID (defaults to auto-generated short ID)'),
    },
    async ({ name, agentId }) => {
      const a = registerAgent(name, agentId);
      return {
        content: [{ type: 'text', text: `registered as "${a.name}" with agentId: ${a.agentId}, sessionId: ${a.sessionId}` }],
      };
    },
  );

  server.tool(
    'walle_channel_join',
    'Join a MACP channel to broadcast/receive messages to all channel members',
    {
      agentId: z.string().describe('Your registered agent ID'),
      sessionId: z.string().describe('Your session ID (from walle_agent_register)'),
      channelId: z.string().describe('Channel ID (e.g. group:xxxx)'),
    },
    async ({ agentId, sessionId, channelId }) => {
      const peers = joinChannel(agentId, sessionId, channelId);
      return {
        content: [{ type: 'text', text: `joined channel "${channelId}". Peers in channel: ${peers.length > 0 ? peers.join(', ') : 'none yet'}` }],
      };
    },
  );

  server.tool(
    'walle_agent_list',
    'List all agents currently registered in the MACP bus',
    {},
    async () => {
      const agents = listAgents();
      if (agents.length === 0) return { content: [{ type: 'text', text: 'no agents registered' }] };
      const lines = agents.map((a) => `${a.agentId.padEnd(8)} ${a.name.padEnd(20)} ${a.status.padEnd(10)} channels: [${a.channels.join(', ')}]`);
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    },
  );

  server.tool(
    'walle_send_channel',
    'Broadcast a message to all members of a MACP channel',
    {
      agentId: z.string().describe('Your registered agent ID'),
      sessionId: z.string().describe('Your session ID'),
      channelId: z.string().describe('Channel to broadcast to'),
      subject: z.string().describe('Message subject'),
      body: z.string().describe('Message body'),
      priority: z.number().min(0).max(3).optional().describe('Priority (0=low, 1=normal, 2=high, 3=critical)'),
    },
    async ({ agentId, sessionId, channelId, subject, body, priority }) => {
      const agent = { agentId, sessionId, name: agentId };
      const result = sendToChannel(agent, channelId, subject, body, { priority: priority as any });
      return {
        content: [{ type: 'text', text: `broadcast to channel "${channelId}": ${result.deliveryIds.length} deliveries (messageId: ${result.messageId})` }],
      };
    },
  );

  server.tool(
    'walle_poll',
    'Poll your inbox for new messages (returns pending deliveries)',
    {
      agentId: z.string().describe('Your agent ID'),
      maxMessages: z.number().optional().describe('Max messages to poll (default: 20)'),
    },
    async ({ agentId, maxMessages }) => {
      const msgs = pollInbox(agentId, maxMessages);
      if (msgs.length === 0) return { content: [{ type: 'text', text: 'no messages' }] };
      const lines = msgs.map((m) => {
        const tag = m.state === 'pending' ? '●' : ' ';
        return `${tag} [${m.deliveryId.slice(0, 8)}] ${m.fromName} (${m.fromAgentId}) pri=${m.priority}: ${m.subject}\n   ${m.body.slice(0, 200)}`;
      });
      return { content: [{ type: 'text', text: `${msgs.length} message(s):\n\n` + lines.join('\n\n') }] };
    },
  );

  server.tool(
    'walle_ack',
    'Acknowledge (consume) a delivery so it is removed from your inbox',
    {
      deliveryId: z.string().describe('Delivery ID to acknowledge (from walle_poll)'),
    },
    async ({ deliveryId }) => {
      ackDelivery(deliveryId);
      return { content: [{ type: 'text', text: `acknowledged ${deliveryId}` }] };
    },
  );

  server.tool(
    'walle_session_context',
    'Get your full MACP session context (agent info, pending deliveries, claims, memories)',
    {
      agentId: z.string().describe('Your agent ID'),
      sessionId: z.string().describe('Your session ID'),
      channelId: z.string().optional().describe('Optional channel to scope context to'),
    },
    async ({ agentId, sessionId, channelId }) => {
      const ctx = getSessionContext(agentId, sessionId, channelId);
      const lines: string[] = [
        `agent:    ${ctx.agent.agentId} (${ctx.agent.name})`,
        `status:   ${ctx.agent.status}`,
        `channels: ${ctx.agent.channels.join(', ')}`,
        `pending:  ${ctx.pending.total} (interrupt:${ctx.pending.interrupt} steering:${ctx.pending.steering} advisory:${ctx.pending.advisory} info:${ctx.pending.info})`,
        `claims:   ${ctx.claims.own.length} own, ${ctx.claims.peers.length} peer`,
        `memories: agent:${ctx.memories.agent} channel:${ctx.memories.channel} workspace:${ctx.memories.workspace}`,
      ];
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    },
  );

  server.tool(
    'walle_file_claims',
    'List active file claims in the workspace',
    {
      agentId: z.string().optional().describe('Filter by agent ID'),
      files: z.string().optional().describe('Filter by comma-separated file paths'),
    },
    async ({ agentId, files }) => {
      const fileList = files ? files.split(',').map((f) => f.trim()) : undefined;
      const claims = listFileClaims(agentId, fileList);
      if (claims.length === 0) return { content: [{ type: 'text', text: 'no active file claims' }] };
      const lines = claims.map((c) => `${c.agentId}: ${c.filePath} (expires: ${c.expiresAt})`);
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    },
  );

  server.tool(
    'walle_macp_set',
    'Store a memory entry via MACP (durable, SQLite-backed)',
    {
      agentId: z.string().describe('Your agent ID'),
      sessionId: z.string().describe('Your session ID'),
      key: z.string().describe('Memory key'),
      value: z.string().describe('Memory value'),
      scope: z.enum(['workspace', 'channel', 'agent']).optional().describe('Memory scope (default: workspace)'),
      channelId: z.string().optional().describe('Channel ID (required if scope=channel)'),
      tags: z.string().optional().describe('Comma-separated tags'),
    },
    async ({ agentId, sessionId, key, value, scope, channelId, tags }) => {
      const entry = macpSetMemory({
        agentId, sessionId, key, value,
        scope: scope as any,
        channelId,
        tags: tags ? tags.split(',').map((t) => t.trim()) : undefined,
      });
      return { content: [{ type: 'text', text: `stored "${entry.key}" (memoryId: ${entry.memoryId}) scope: ${entry.scope}` }] };
    },
  );

  server.tool(
    'walle_macp_get',
    'Read a memory entry via MACP by key',
    {
      agentId: z.string().describe('Your agent ID'),
      sessionId: z.string().describe('Your session ID'),
      key: z.string().describe('Memory key'),
      scope: z.enum(['workspace', 'channel', 'agent']).optional().describe('Scope'),
      channelId: z.string().optional().describe('Channel ID (required if scope=channel)'),
    },
    async ({ agentId, sessionId, key, scope, channelId }) => {
      const entry = macpGetMemory({ agentId, sessionId, key, scope: scope as any, channelId });
      if (!entry) return { content: [{ type: 'text', text: `no entry for "${key}"` }], isError: true };
      return { content: [{ type: 'text', text: `[${entry.scope}] ${entry.key}\n---\n${entry.value}` }] };
    },
  );

  server.tool(
    'walle_macp_search',
    'Search memory entries via MACP by query text',
    {
      agentId: z.string().describe('Your agent ID'),
      sessionId: z.string().describe('Your session ID'),
      query: z.string().describe('Search query'),
      scope: z.enum(['workspace', 'channel', 'agent']).optional().describe('Scope filter'),
      channelId: z.string().optional().describe('Channel filter'),
      tags: z.string().optional().describe('Comma-separated tag filter'),
    },
    async ({ agentId, sessionId, query, scope, channelId, tags }) => {
      const results = macpSearchMemory({
        agentId, sessionId, query,
        scope: scope as any,
        channelId,
        tags: tags ? tags.split(',').map((t) => t.trim()) : undefined,
      });
      if (results.length === 0) return { content: [{ type: 'text', text: 'no results' }] };
      const lines = results.map((e, i) => {
        const preview = e.value.slice(0, 120).replace(/\n/g, ' ');
        return `${i + 1}. [${e.scope}] ${e.key}\n   ${preview}...`;
      });
      return { content: [{ type: 'text', text: `found ${results.length}:\n\n` + lines.join('\n\n') }] };
    },
  );

  server.tool(
    'walle_macp_delete',
    'Delete a memory entry via MACP',
    {
      agentId: z.string().describe('Your agent ID'),
      sessionId: z.string().describe('Your session ID'),
      key: z.string().describe('Memory key'),
      scope: z.enum(['workspace', 'channel', 'agent']).describe('Scope'),
      channelId: z.string().optional().describe('Channel ID (required if scope=channel)'),
    },
    async ({ agentId, sessionId, key, scope, channelId }) => {
      const count = macpDeleteMemory({ agentId, sessionId, key, scope: scope as any, channelId });
      return { content: [{ type: 'text', text: count > 0 ? `deleted "${key}"` : `not found: "${key}"` }] };
    },
  );

  return server;
}

export async function startMcpServer(cwd?: string): Promise<void> {
  const server = createMcpServer(cwd);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

export function mountMcpOnExpress(
  app: import('express').Application,
  cwd?: string,
): McpServer {
  const server = createMcpServer(cwd);
  const transport = new StreamableHTTPServerTransport();
  void server.connect(transport);

  app.post('/mcp', (req, res) => {
    void transport.handleRequest(req as any, res as any, req.body);
  });
  app.get('/mcp', (req, res) => {
    void transport.handleRequest(req as any, res as any);
  });

  return server;
}
