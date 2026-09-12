/* tty7 pi bridge 补齐 —— 补上 tty7 生成器漏发的两个事件。
 *
 * 背景：
 *   tty7 的事件词汇表有 8 个：
 *     session-start / prompt-submit / permission-request / question-asked
 *     tool-complete / notifications / stop / session-end
 *   但 tty7 为 pi 生成的桥接（extensions/tty7/index.ts）只发了 4 个：
 *     session-start / prompt-submit / stop / session-end
 *   → 结果：pi 弹选择框时 tty7 不提示，只在结束时提示。
 *
 * 做法：
 *   不改 tty7 的生成文件（标了 do not edit，且 agent-hooks-install 会覆盖），
 *   改用独立扩展监听 pi 的 ui_prompt_start / ui_prompt_end 事件补发。
 *
 * 如果 tty7 上游修了这个漏洞，删掉本目录即可。
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { spawnSync } from "node:child_process";

const EXE =
  process.env["TTY7_EXE"] ?? "D:\\program\\ai\\tty7\\app\\tty7-app.exe";

/** 与 tty7 生成桥接保持一致的最小上下文切片 */
type SessionCtx = { sessionManager?: { getSessionId?(): string | undefined } };

/** 与 tty7 生成桥接相同的发送协议：`tty7 agent-hook pi <event>`，session_id 走 stdin */
function emit(event: string, ctx?: SessionCtx): void {
  try {
    let payload = "";
    try {
      const id = ctx?.sessionManager?.getSessionId?.();
      if (id) payload = JSON.stringify({ session_id: id });
    } catch {}
    const args = ["agent-hook", "pi", event];
    if (payload) {
      spawnSync(EXE, args, { input: payload, stdio: ["pipe", "ignore", "ignore"] });
    } else {
      spawnSync(EXE, args, { stdio: ["ignore", "ignore", "ignore"] });
    }
  } catch {}
}

/** pi 的 ui_prompt_start 事件载荷（结构式声明，避免依赖未导出的类型） */
type UiPromptStartEvent = {
  reason?: string;
  kind?: "select" | "confirm" | "input" | "editor" | "custom";
  title?: string;
};

export default function (pi: ExtensionAPI) {
  // 只在 tty7 托管的 pane 里生效；tty7 自己也是这么判的
  if (!process.env["TTY7"]) return;

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
