import { getDecision, getRuntime } from "../lib/runtime.js";

export const name = "adaptive_thinking_status";
export const description = "查询当前会话的自适应思考开关、最近一次选档与失败状态，不调用模型。";
export const parameters = { type: "object", properties: {} };
export const sessionPermission = { readOnly: true, kind: "read" };

export async function execute(_input = {}, toolCtx = {}) {
  const host = getRuntime();
  if (!host) return { content: [{ type: "text", text: "自适应思考：插件尚未初始化。" }] };
  const { sessionId, agentId } = toolCtx;
  if (!sessionId || !agentId) {
    return { content: [{ type: "text", text: "自适应思考：请在聊天会话中查询状态。" }] };
  }
  const enabled = await host.config.get("enabled", { scope: "per-agent", agentId });
  const sessionAuto = await host.config.get("sessionAuto", { scope: "per-session", sessionId });
  const last = getDecision(sessionId);
  let detail = "尚无分类记录";
  if (last?.status === "level_mismatch") {
    detail = `最近：档位回读不一致，目标 ${last.requested}，会话 ${last.level}，Pi 回读 ${last.observedLevel}，本轮模型请求档位未核实，时间 ${last.at}${last.reason ? `，依据 ${last.reason}` : ""}`;
  } else if (last?.status === "level_unverified") {
    detail = `最近：目标 ${last.requested}，会话写入结果未核实，Pi 回读 ${last.observedLevel}，本轮模型请求档位未核实，时间 ${last.at}${last.reason ? `，依据 ${last.reason}` : ""}`;
  } else if (last) {
    detail = `最近：${last.status}，档位 ${last.level ?? "保持原样"}，时间 ${last.at}${last.reason ? `，依据 ${last.reason}` : ""}${last.code ? `，原因 ${last.code}` : ""}`;
  }
  return { content: [{ type: "text", text: `自适应思考：Agent ${enabled === true ? "已启用" : "未启用"}，本会话 ${sessionAuto === false ? "已暂停" : "可自动选档"}。${detail}` }] };
}
