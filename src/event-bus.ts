type Handler = (data: unknown) => void;

const handlers = new Map<string, Set<Handler>>();

export function on(event: string, handler: Handler): () => void {
  if (!handlers.has(event)) handlers.set(event, new Set());
  handlers.get(event)!.add(handler);
  return () => {
    handlers.get(event)?.delete(handler);
    if (handlers.get(event)?.size === 0) handlers.delete(event);
  };
}

export function emit(event: string, data: unknown): void {
  for (const h of handlers.get(event) ?? []) {
    try { h(data); } catch {}
  }
}
