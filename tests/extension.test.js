import test from "node:test";
import assert from "node:assert/strict";
import extension from "../extensions/adaptive-thinking.js";
import { getDecision, setRuntime } from "../lib/runtime.js";
import { execute as control } from "../tools/adaptive-thinking-control.js";
import { execute as status } from "../tools/adaptive-thinking-status.js";

const reply = (level, mode = "auto") => ({ text: JSON.stringify({ level, mode, reason: "task_complexity" }) });

function harness({ enabled = true, model = { reasoning: true, xhigh: true }, delayedSelection = false, staleReadback = false, updateWithoutSession = false, noSessionLevelRead = false, sessionLookupFailures = 0, emptySessionLookups = 0 } = {}) {
  const configValues = new Map([["per-agent:a1:enabled", enabled]]);
  const hooks = new Map();
  const samples = [];
  const warnings = [];
  let sessionLookups = 0;
  const updates = [];
  const responses = [];
  let level = "medium";
  let sampling = null;
  const session = { sessionId: "s1", agentId: "a1", visibility: "public", kind: "chat" };
  const ctx = {
    model,
    sessionManager: { getSessionFile: () => "session.jsonl", getBranch: () => [] },
  };
  const host = {
    pluginId: "adaptive-thinking-plugin",
    log: { info() {}, warn(message) { warnings.push(message); } },
    config: {
      async get(key, scope) {
        return configValues.get(`${scope.scope}:${scope.agentId ?? scope.sessionId}:${key}`);
      },
      async set(key, value, scope) {
        configValues.set(`${scope.scope}:${scope.agentId ?? scope.sessionId}:${key}`, value);
      },
    },
    bus: {
      async request(type, input) {
        if (type === "session:get") {
          assert.deepEqual(input, { sessionPath: "session.jsonl" });
          sessionLookups += 1;
          if (sessionLookups <= sessionLookupFailures) throw new Error("private failure detail");
          if (sessionLookups <= sessionLookupFailures + emptySessionLookups) return null;
          return { session: noSessionLevelRead ? session : { ...session, thinkingLevel: level } };
        }
        if (type === "model:sample-text") {
          samples.push(input);
          return sampling ? sampling(input) : responses.shift();
        }
        if (type === "session:update") {
          updates.push(input);
          const previousLevel = level;
          level = input.thinkingLevel === "max" ? (model.xhigh ? "xhigh" : "high") : input.thinkingLevel;
          if (level !== previousLevel) {
            if (delayedSelection) setImmediate(() => void hooks.get("thinking_level_select")({ level, previousLevel }, ctx));
            else await hooks.get("thinking_level_select")({ level, previousLevel }, ctx);
          }
          return updateWithoutSession ? { ok: true } : { ok: true, session: { ...session, thinkingLevel: level } };
        }
        throw new Error(`unexpected request: ${type}`);
      },
    },
  };
  const pi = {
    on: (name, fn) => hooks.set(name, fn),
    getThinkingLevel: () => staleReadback && updates.length > 0 ? "off" : level,
  };
  setRuntime(host);
  extension(pi);
  return {
    hooks, ctx, host, responses, samples, updates, warnings, session, configValues,
    getSessionLookups() { return sessionLookups; },
    setLevel(value) { level = value; },
    setSampler(fn) { sampling = fn; },
    async prompt(text = "User request") { await hooks.get("before_agent_start")({ prompt: text }, ctx); },
    cleanup() { setRuntime(null); },
  };
}

test("opt-in: a disabled agent makes no classification call", async () => {
  const h = harness({ enabled: false });
  try {
    await h.prompt();
    assert.equal(h.samples.length, 0);
    assert.equal(h.updates.length, 0);
  } finally { h.cleanup(); }
});

test("background sessions are excluded even with an enabled Agent", async () => {
  const h = harness();
  try {
    h.session.sessionKind = "activity";
    await h.prompt();
    assert.equal(h.samples.length, 0);
    assert.equal(h.updates.length, 0);
  } finally { h.cleanup(); }
});

test("one user turn selects a level before requests; later turns may rise and fall", async () => {
  const h = harness();
  try {
    h.responses.push(reply("low"), reply("max"), reply("off"));
    await h.prompt("hello");
    assert.equal(h.updates.at(-1).thinkingLevel, "low");
    assert.equal(h.samples.length, 1);
    assert.equal(h.hooks.has("before_provider_request"), false);
    await h.prompt("cross-file verification");
    assert.equal(h.updates.at(-1).thinkingLevel, "max");
    assert.equal(getDecision("s1").level, "xhigh");
    await h.prompt("back to simple");
    assert.equal(h.updates.at(-1).thinkingLevel, "off");
    assert.equal(h.samples.length, 3);
    assert.equal(h.configValues.get("per-session:s1:sessionAuto"), undefined);
  } finally { h.cleanup(); }
});

test("session lookup recovers before the first model request without extra classification calls", async () => {
  const h = harness({ sessionLookupFailures: 1, emptySessionLookups: 1 });
  try {
    h.responses.push(reply("off"));
    await h.prompt("1");
    assert.equal(h.getSessionLookups(), 3);
    assert.equal(h.samples.length, 1);
    assert.equal(h.updates.at(-1).thinkingLevel, "off");
    assert.equal(getDecision("s1").status, "applied");
  } finally { h.cleanup(); }
});

test("persistent session lookup failure keeps the level and logs a safe stage", async () => {
  const h = harness({ sessionLookupFailures: 10 });
  try {
    await h.prompt("1");
    assert.equal(h.getSessionLookups(), 3);
    assert.equal(h.samples.length, 0);
    assert.equal(h.updates.length, 0);
    assert.match(h.warnings.at(-1), /stage=resolve_session/);
    assert.doesNotMatch(h.warnings.at(-1), /private failure detail/);
  } finally { h.cleanup(); }
});

test("a delayed selection event from our own update does not pause automation", async () => {
  const h = harness({ delayedSelection: true });
  try {
    h.responses.push(reply("high"));
    await h.prompt();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(h.configValues.get("per-session:s1:sessionAuto"), undefined);
    assert.equal(getDecision("s1").status, "applied");
  } finally { h.cleanup(); }
});

test("session update result wins over a stale Pi readback and late selection", async () => {
  const h = harness({ staleReadback: true, delayedSelection: true });
  try {
    h.setLevel("off");
    h.responses.push(reply("max"));
    await h.prompt("Use max for this turn");
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(h.updates.at(-1).thinkingLevel, "max");
    assert.equal(getDecision("s1").level, "xhigh");
    assert.equal(getDecision("s1").observedLevel, "off");
    assert.equal(getDecision("s1").status, "level_mismatch");
    const view = await status({}, { sessionId: "s1", agentId: "a1" });
    assert.match(view.content[0].text, /会话 xhigh.*Pi 回读 off.*请求档位未核实/);
    assert.equal(h.configValues.get("per-session:s1:sessionAuto"), undefined);
  } finally { h.cleanup(); }
});

test("a session get confirms the update when the update response omits its session", async () => {
  const h = harness({ staleReadback: true, updateWithoutSession: true });
  try {
    h.setLevel("off");
    h.responses.push(reply("max"));
    await h.prompt();
    assert.equal(getDecision("s1").status, "level_mismatch");
    assert.equal(getDecision("s1").level, "xhigh");
  } finally { h.cleanup(); }
});

test("unknown update level is reported as unverified instead of off", async () => {
  const h = harness({ staleReadback: true, updateWithoutSession: true, noSessionLevelRead: true });
  try {
    h.setLevel("off");
    h.responses.push(reply("max"));
    await h.prompt();
    assert.equal(getDecision("s1").status, "level_unverified");
    assert.equal(getDecision("s1").level, null);
    const view = await status({}, { sessionId: "s1", agentId: "a1" });
    assert.match(view.content[0].text, /会话写入结果未核实.*本轮模型请求档位未核实/);
  } finally { h.cleanup(); }
});

test("unsupported max safely clamps through the host", async () => {
  const h = harness({ model: { reasoning: true, xhigh: false } });
  try {
    h.responses.push(reply("max"));
    await h.prompt();
    assert.equal(getDecision("s1").level, "high");
    assert.equal(h.configValues.get("per-session:s1:sessionAuto"), undefined);
  } finally { h.cleanup(); }
});

test("manual selection pauses auto, and control restores on the next user message", async () => {
  const h = harness();
  try {
    await h.hooks.get("thinking_level_select")({ level: "high", previousLevel: "medium" }, h.ctx);
    h.responses.push(reply("off"));
    await h.prompt();
    assert.equal(h.samples.length, 0);
    assert.equal(h.configValues.get("per-session:s1:sessionAuto"), false);
    await control({ mode: "on" }, { agentId: "a1", sessionId: "s1" });
    await h.prompt();
    assert.equal(h.samples.length, 1);
    assert.equal(h.updates[0].thinkingLevel, "off");
  } finally { h.cleanup(); }
});

test("manual change while classifier is pending wins the race", async () => {
  const h = harness();
  try {
    let release;
    h.setSampler(() => new Promise((resolve) => { release = resolve; }));
    const running = h.prompt();
    await new Promise((resolve) => setImmediate(resolve));
    h.setLevel("high");
    await h.hooks.get("thinking_level_select")({ level: "high", previousLevel: "medium" }, h.ctx);
    release(reply("off"));
    await running;
    assert.equal(h.updates.length, 0);
    assert.equal(getDecision("s1").status, "manual_won");
  } finally { h.cleanup(); }
});

test("classifier errors leave the current level unchanged", async () => {
  const h = harness();
  try {
    h.setSampler(async () => ({ text: "bad" }));
    await h.prompt();
    assert.equal(h.updates.length, 0);
    assert.equal(getDecision("s1").code, "invalid_json");
  } finally { h.cleanup(); }
});

test("persistent explicit preference pauses after applying until resumed", async () => {
  const h = harness();
  try {
    h.responses.push(reply("high", "manual_until_resumed"), reply("off"));
    await h.prompt("Use high from now on");
    assert.equal(h.updates.length, 1);
    assert.equal(h.configValues.get("per-session:s1:sessionAuto"), false);
    await h.prompt("hello");
    assert.equal(h.samples.length, 1);
  } finally { h.cleanup(); }
});
