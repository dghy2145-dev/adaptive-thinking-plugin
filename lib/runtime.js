let runtime = null;
const recent = new Map();

export function setRuntime(ctx) {
  runtime = ctx;
  if (!ctx) recent.clear();
}

export function getRuntime() {
  return runtime;
}

export function recordDecision(sessionId, record) {
  if (!sessionId) return;
  recent.delete(sessionId);
  recent.set(sessionId, { ...record, at: new Date().toISOString() });
  if (recent.size > 200) recent.delete(recent.keys().next().value);
}

export function getDecision(sessionId) {
  return recent.get(sessionId) ?? null;
}
