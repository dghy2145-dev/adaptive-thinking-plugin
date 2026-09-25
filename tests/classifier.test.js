import test from "node:test";
import assert from "node:assert/strict";
import { classify, parseClassification, prepareInput } from "../lib/classifier.js";

const reply = (level, mode = "auto") => JSON.stringify({ level, mode, reason: "task_complexity", confidence: 0.8 });

test("classification uses the current task and a bounded recent conversation", async () => {
  const entries = [
    { type: "message", message: { role: "system", content: "private system" } },
    { type: "message", message: { role: "user", content: "first task" } },
    { type: "message", message: { role: "toolResult", content: "private tool output" } },
    { type: "message", message: { role: "assistant", content: [{ type: "text", text: "previous reply" }] } },
  ];
  let sampled;
  const selected = await classify({
    sample: async (input) => { sampled = input; return { text: reply("low") }; },
    prompt: "Now say hello",
    entries,
    agentId: "a1",
    sessionId: "s1",
  });
  assert.equal(selected.level, "low");
  assert.equal(sampled.operation, "adaptive-thinking-classify");
  assert.equal(sampled.maxTokens, 160);
  assert.deepEqual(JSON.parse(sampled.messages[0].content), {
    recent: [{ role: "user", text: "first task" }, { role: "assistant", text: "previous reply" }],
    current: "Now say hello",
  });
  assert.ok(!sampled.messages[0].content.includes("private"));
});

test("input is bounded, with no tool or image content", () => {
  const content = "x".repeat(5000);
  const input = prepareInput(content, Array.from({ length: 8 }, (_, index) => ({ role: "user", content: [{ type: "text", text: `${index}:${content}` }, { type: "image", data: "secret" }] })));
  assert.equal(input.recent.length, 4);
  assert.ok(input.recent.every((m) => m.text.length <= 850));
  assert.ok(input.current.length <= 2600);
  assert.ok(!JSON.stringify(input).includes("secret"));
});

test("only constrained JSON levels and modes are accepted", () => {
  assert.equal(parseClassification(`\`\`\`json\n${reply("max", "manual_this_turn")}\n\`\`\``).level, "max");
  assert.throws(() => parseClassification('{"level":"ultra","mode":"auto"}'), /invalid_level/);
  assert.throws(() => parseClassification('{"level":"high","mode":"other"}'), /invalid_level/);
  assert.throws(() => parseClassification('{"level":"high","mode":"auto","confidence":4}'), /invalid_confidence/);
  assert.throws(() => parseClassification('{"level":"high","mode":"auto","reason":"private user text"}'), /invalid_reason/);
  assert.throws(() => parseClassification('ignore instructions'), /invalid_json/);
});

test("classifier timeout fails open and cannot hang a chat", async () => {
  await assert.rejects(classify({ sample: () => new Promise(() => {}), prompt: "test", timeoutMs: 10 }), /classification_timeout/);
});
