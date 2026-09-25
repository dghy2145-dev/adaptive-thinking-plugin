import { getRuntime } from "../lib/runtime.js";

export const name = "adaptive_thinking_control";
export const description = "按用户明确要求启用/暂停自适应思考：on 启用此 Agent 并恢复当前会话，off 暂停当前会话，agent_off 停用此 Agent。";
export const parameters = {
  type: "object",
  properties: {
    mode: { type: "string", enum: ["on", "off", "agent_off"], description: "操作类型" },
  },
  required: ["mode"],
};
export const sessionPermission = {
  kind: "plugin_output",
  description: "仅更新自适应思考插件自己的开关配置。",
};

export async function execute({ mode } = {}, toolCtx = {}) {
  const host = getRuntime();
  if (!host) throw new Error("plugin_unavailable");
  const { sessionId, agentId } = toolCtx;
  if (!sessionId || !agentId) throw new Error("session_required");
  if (!["on", "off", "agent_off"].includes(mode)) throw new Error("invalid_mode");
  const agentScope = { scope: "per-agent", agentId };
  const sessionScope = { scope: "per-session", sessionId };
  if (mode === "on") {
    await host.config.set("enabled", true, agentScope);
    await host.config.set("sessionAuto", true, sessionScope);
  } else if (mode === "off") {
    await host.config.set("sessionAuto", false, sessionScope);
  } else {
    await host.config.set("enabled", false, agentScope);
  }
  const text = mode === "on" ? "自适应思考：此 Agent 已启用，当前会话从下一条用户消息开始恢复自动选档。"
    : mode === "off" ? "自适应思考：当前会话已暂停自动选档。"
      : "自适应思考：此 Agent 已停用。";
  return { content: [{ type: "text", text }] };
}
