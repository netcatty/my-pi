/* tty7 pi bridge 补齐 —— 补上 tty7 生成器漏发的事件。
 *
 * 背景（源码依据：github.com/l0ng-ai/tty7 的 crates/tty7-core/src/core/agent_hooks.rs）：
 *   tty7 的事件词汇表有 8 个：
 *     session-start / prompt-submit / permission-request / question-asked
 *     tool-complete / notification / stop / session-end
 *   但 tty7 为 pi 生成的桥接（extensions/tty7/index.ts）只发了 4 个：
 *     session-start / prompt-submit / stop / session-end
 *   → 结果：pi 弹选择框时不提示、pi 发的通知传不到 tty7。
 *
 * tty7 的 payload 只读这 4 个字段（agent_hooks.rs 的 build_hook_sequence）：
 *   session_id（或 sessionId） / message / cwd（或 working_dir）
 *   / prompt（或 userPrompt、user_prompt）
 *
 * 做法：不改 tty7 的生成文件（标了 do not edit，且 agent-hooks-install 会覆盖），
 *       改用独立扩展补齐。已补：
 *         ui_prompt_start → permission-request（confirm）/ question-asked（其余）
 *         ui_prompt_end   → prompt-submit（回到 working）
 *         ui.notify()     → notification（monkey-patch）
 *
 * 如果 tty7 上游修了这些漏洞，删掉本目录即可。
 */

import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionUIContext,
} from "@earendil-works/pi-coding-agent";
import { spawnSync } from "node:child_process";

const EXE =
  process.env["TTY7_EXE"] ?? "D:\\program\\ai\\tty7\\app\\tty7-app.exe";

/** 与 tty7 生成桥接保持一致的最小上下文切片 */
type SessionCtx = { sessionManager?: { getSessionId?(): string | undefined } };

type NotifyType = "info" | "warning" | "error";

/** 与 tty7 生成桥接相同的发送协议：`tty7 agent-hook pi <event>`，JSON 走 stdin */
function emit(event: string, ctx?: SessionCtx, extra?: Record<string, string>): void {
  try {
    const payload: Record<string, string> = {};
    try {
      const id = ctx?.sessionManager?.getSessionId?.();
      if (id) payload["session_id"] = id;
    } catch {}
    if (extra) Object.assign(payload, extra);

    const args = ["agent-hook", "pi", event];
    if (Object.keys(payload).length > 0) {
      spawnSync(EXE, args, { input: JSON.stringify(payload), stdio: ["pipe", "ignore", "ignore"] });
    } else {
      spawnSync(EXE, args, { stdio: ["ignore", "ignore", "ignore"] });
    }
  } catch {}
}

/** pi 的 ui_prompt_start 载荷（结构式声明，避免依赖未导出的类型） */
type UiPromptStartEvent = {
  reason?: string;
  kind?: "select" | "confirm" | "input" | "editor" | "custom";
  title?: string;
};

/** 已打过补丁的 ui 对象——避免重复包装导致递归 */
const patched = new WeakSet<object>();

/**
 * 包装 ctx.ui.notify：转发给 tty7 后照常调用原实现。
 *
 * ui 上下文在 bindCurrentSessionExtensions 时只创建一次并挂在 session 上，
 * 所以这里的改动对本会话内后续所有 ctx.ui.notify 调用生效。
 */
function patchNotify(ctx: ExtensionContext): void {
  const ui = ctx.ui as ExtensionUIContext;
  if (!ui || typeof ui.notify !== "function") return;
  if (patched.has(ui)) return;
  patched.add(ui);

  const original = ui.notify.bind(ui);
  ui.notify = (message: string, type?: NotifyType) => {
    emit("notification", ctx as SessionCtx, { message: String(message ?? "") });
    return original(message, type);
  };
}

export default function (pi: ExtensionAPI) {
  // 只在 tty7 托管的 pane 里生效；tty7 自己也是这么判的
  if (!process.env["TTY7"]) return;

  // 用 session_start 装通知钩子——此时 ui 上下文已绑定
  pi.on("session_start", (_event, ctx) => patchNotify(ctx));

  // pi 弹阻塞式 UI 时（select / confirm / input / editor / custom），
  // 通知 tty7「正在等用户」——这正是原来缺失的提示。
  pi.on("ui_prompt_start", (event, ctx) => {
    const e = event as UiPromptStartEvent;
    // confirm 多为权限/危险操作确认，其余为问答
    emit(e.kind === "confirm" ? "permission-request" : "question-asked", ctx);
  });

  // 提示关闭 → 回到「忙碌」，否则 pane 会一直停在「等用户」直到 stop
  pi.on("ui_prompt_end", (_event, ctx) => emit("prompt-submit", ctx));
}
