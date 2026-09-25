import { classify } from "../lib/classifier.js?version=2";
import { getRuntime, recordDecision } from "../lib/runtime.js";

function errorCode(error) {
  const value = error?.message;
  return ["classification_timeout", "invalid_output", "invalid_json", "invalid_level", "invalid_reason", "invalid_confidence", "empty_prompt"].includes(value)
    ? value : "classification_unavailable";
}

async function currentSession(host, piCtx) {
  const sessionPath = piCtx?.sessionManager?.getSessionFile?.();
  if (!sessionPath) return null;
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 60 * attempt));
    try {
      const response = await host.bus.request("session:get", { sessionPath });
      const session = response?.session;
      if (session?.sessionId && session.agentId) return { ...session, sessionPath };
      lastError = new Error("session_unavailable");
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function errorType(error) {
  return String(error?.code ?? error?.name ?? "unknown").replace(/[^A-Za-z0-9_]/g, "").slice(0, 32) || "unknown";
}

function eligible(session) {
  if (session.ownerPluginId || (session.visibility && session.visibility !== "public")) return false;
  const kind = session.sessionKind ?? session.kind;
  return !kind || kind === "chat";
}

export default function adaptiveThinking(pi) {
  let expectedAutoChange = null;
  let manualRevision = 0;

  pi.on("thinking_level_select", async (event, piCtx) => {
    if (expectedAutoChange && Date.now() < expectedAutoChange.expiresAt &&
        (!expectedAutoChange.level || expectedAutoChange.level === event.level)) {
      expectedAutoChange = null;
      return;
    }
    expectedAutoChange = null;
    manualRevision += 1;
    const host = getRuntime();
    if (!host) return;
    try {
      const session = await currentSession(host, piCtx);
      if (!session || !eligible(session)) return;
      const agentScope = { scope: "per-agent", agentId: session.agentId };
      if (await host.config.get("enabled", agentScope) !== true) return;
      await host.config.set("sessionAuto", false, { scope: "per-session", sessionId: session.sessionId });
      recordDecision(session.sessionId, { status: "manual_paused", level: event.level });
    } catch {
      host.log.warn("manual pause could not be saved");
    }
  });

  pi.on("model_select", () => {
    manualRevision += 1;
  });

  pi.on("before_agent_start", async (event, piCtx) => {
    const host = getRuntime();
    if (!host || !event?.prompt || !piCtx?.model?.reasoning) return;
    let session;
    let stage = "resolve_session";
    try {
      session = await currentSession(host, piCtx);
      if (!session || !eligible(session)) return;
      stage = "check_settings";
      const agentScope = { scope: "per-agent", agentId: session.agentId };
      const sessionScope = { scope: "per-session", sessionId: session.sessionId };
      if (await host.config.get("enabled", agentScope) !== true ||
          await host.config.get("sessionAuto", sessionScope) === false) return;

      const initialLevel = pi.getThinkingLevel();
      const revision = manualRevision;
      const started = Date.now();
      stage = "classify";
      const result = await classify({
        sample: (input) => host.bus.request("model:sample-text", {
          ...input,
          pluginId: host.pluginId,
          sessionPath: session.sessionPath,
        }),
        prompt: event.prompt,
        entries: piCtx.sessionManager.getBranch?.() ?? [],
        agentId: session.agentId,
        sessionId: session.sessionId,
      });
      stage = "confirm_settings";
      if (manualRevision !== revision || pi.getThinkingLevel() !== initialLevel ||
          await host.config.get("enabled", agentScope) !== true ||
          await host.config.get("sessionAuto", sessionScope) === false) {
        recordDecision(session.sessionId, { status: "manual_won", level: pi.getThinkingLevel() });
        return;
      }

      const requested = result.level === "max" ? "max" : result.level;
      let confirmedLevel = null;
      let changed = false;
      if (requested !== initialLevel && !(requested === "max" && initialLevel === "xhigh")) {
        changed = true;
        const change = { level: null, expiresAt: Date.now() + 3000 };
        expectedAutoChange = change;
        try {
          stage = "update_session";
          const updated = await host.bus.request("session:update", {
            sessionId: session.sessionId,
            thinkingLevel: requested,
          });
          if (updated?.ok !== true) throw new Error("session_update_failed");
          confirmedLevel = updated.session?.thinkingLevel ?? updated.thinkingLevel ?? null;
          if (!confirmedLevel) {
            try {
              const fresh = await host.bus.request("session:get", { sessionPath: session.sessionPath });
              confirmedLevel = fresh?.session?.thinkingLevel ?? null;
            } catch {
              // The update succeeded; an unavailable readback must not block the answer.
            }
          }
          const effectiveLevel = confirmedLevel ?? pi.getThinkingLevel();
          if (expectedAutoChange === change) {
            if (effectiveLevel !== initialLevel) change.level = effectiveLevel;
            else if (confirmedLevel) expectedAutoChange = null;
          }
        } catch (error) {
          if (expectedAutoChange === change) expectedAutoChange = null;
          throw error;
        }
      }
      const observedLevel = pi.getThinkingLevel();
      const mismatch = confirmedLevel && observedLevel !== confirmedLevel;
      const unverified = changed && !confirmedLevel && observedLevel === initialLevel;
      const effective = confirmedLevel ?? (unverified ? null : observedLevel);
      stage = "record_decision";
      if (result.mode === "manual_until_resumed") await host.config.set("sessionAuto", false, sessionScope);
      recordDecision(session.sessionId, {
        status: mismatch ? "level_mismatch" : unverified ? "level_unverified" :
          result.mode === "manual_until_resumed" ? "manual_paused" : "applied",
        level: effective,
        observedLevel: mismatch || unverified ? observedLevel : undefined,
        requested: result.level,
        reason: result.reason,
        durationMs: Date.now() - started,
      });
      host.log.info(`thinking decision: ${result.level} -> ${effective ?? "unverified"} (Pi: ${observedLevel}, ${Date.now() - started}ms)`);
    } catch (error) {
      const code = errorCode(error);
      if (session?.sessionId) recordDecision(session.sessionId, { status: "fallback", code });
      host.log.warn(`thinking decision fallback: ${code} (stage=${stage}, error=${errorType(error)})`);
    }
  });
}
