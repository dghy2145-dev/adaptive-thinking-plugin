# 任务自适应思考深度

Hana v2 App，用当前任务复杂度自动选择本会话的思考档位：`off`、`low`、`medium`、`high` 或 `max`。

## 功能

- 按 Agent 独立启用或停用，不使用一个全局开关替代各 Agent 设置。
- 每条新用户消息调用 utility 模型进行轻量分类，再按结果调整当前会话档位。
- 手动选择思考档位时，当前会话自动暂停，避免自动逻辑覆盖手动操作。
- 插件自身发起的改档不会误触发手动暂停；事件缺失或插件重启时，下一条消息会按上次生效档位复核。
- 聊天输入栏显示当前会话状态：`自动选档中`、`已暂停` 或 `未启用`。
- 点击输入栏状态可以在 `自动选档中` 与 `已暂停` 之间切换；只影响当前会话，不改变 Agent 总开关和当前档位。
- 设置页显示每个 Agent 的最近一次选档摘要，并提供按活跃会话暂停或恢复的控制。
- 分类失败时保留当前档位，不阻塞正常对话。

## 安装与授权

这是 `manifestVersion: 2` 的 Hana App，安装时请在 App Manager 中导入本 ZIP 并完成审核。

需要批准的能力包括：

- `app/hooks.session-input`：在新用户消息进入会话时执行自动选档。
- `app/session.thinking-level`：读取和更新会话思考档位。
- `app/sessions.read`、`app/sessions.manage`：读取活跃会话并控制会话级自动模式。
- `app/agents.read`：读取可配置的 Agent 列表。
- `app/models.infer`：调用 utility 模型完成任务分类。
- `app/input.status`：在聊天输入栏显示状态并响应点击切换。
- `app/tools.expose-to-model`：向已启用该 App 的 Agent 暴露状态与控制工具。

安装后还需在目标 Agent 下启用此 App。每条分类请求可能产生额外的 utility 模型调用费用。

## 设置

打开 Hana 的 App 设置，进入「自适应思考」。页面中的 Agent 开关彼此独立：

1. 开启目标 Agent 的开关。
2. 在聊天输入栏查看当前会话的自动选档状态。
3. 点击「自动选档中」可暂停；点击「已暂停」可恢复。
4. 也可以展开设置页的「会话控制」，搜索并选择活跃会话后切换本会话自动模式。

输入栏操作只写当前会话的 `sessionAuto` 配置。Agent 总开关关闭时，输入栏显示「未启用」，不会通过点击偷偷开启 Agent。

## 工具

- `adaptive_thinking_toggle`：切换当前会话的自动选档。
- `adaptive_thinking_resume`：恢复当前会话的自动选档。
- `adaptive_thinking_control`：按明确指令执行 Agent 级启用、会话暂停或 Agent 停用。
- `adaptive_thinking_status`：查询当前会话状态与最近选档记录。

## 兼容性

要求 Hana `0.1050.9` 或更高版本。App 使用包内 SDK 和相对资源路径，不需要额外安装 npm 依赖。
