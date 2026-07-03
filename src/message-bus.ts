import { randomUUID } from 'node:crypto';
import type { Message } from './types.js';
import {
  saveMessageMeta, getInboxMessages, getSentMessages, getThreadMessages,
  markMessageRead, getUnreadMessageCount, getAllConversations as getMacpConversations,
} from './macp-bus.js';

export function sendMessage(msg: {
  fromTask: string;
  fromRole?: string;
  toTask: string;
  toRole?: string;
  subject: string;
  body: string;
  threadId?: string;
}): Message {
  const message: Message = {
    id: randomUUID().slice(0, 8),
    threadId: msg.threadId ?? randomUUID().slice(0, 8),
    fromTask: msg.fromTask,
    fromRole: msg.fromRole,
    toTask: msg.toTask,
    toRole: msg.toRole,
    subject: msg.subject,
    body: msg.body,
    createdAt: new Date().toISOString(),
    read: false,
  };
  saveMessageMeta(message);
  return message;
}

export function getInbox(taskId: string): Message[] {
  return getInboxMessages(taskId).map(m => ({
    ...m,
    threadId: m.threadId,
  }));
}

export function getSent(taskId: string): Message[] {
  return getSentMessages(taskId).map(m => ({
    ...m,
    threadId: m.threadId,
  }));
}

export function getThread(threadId: string): Message[] {
  return getThreadMessages(threadId).map(m => ({
    ...m,
    threadId: m.threadId,
  }));
}

export function markRead(messageId: string): void {
  markMessageRead(messageId);
}

export function getUnreadCount(taskId: string): number {
  return getUnreadMessageCount(taskId);
}

export function getAllConversations(taskId: string): { threadId: string; subject: string; lastMessage: string; unread: number }[] {
  return getMacpConversations(taskId);
}
