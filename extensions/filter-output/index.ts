/* filter-output —— 工具输出回传给 LLM 之前的凭据脱敏。
 *
 * 背景：`path` 规则（pi-permission-system）是**事前**按命令里的路径 token
 * 拦截，只覆盖它认得的写法。已知边界：可静态解析的 shell 变量是闭集
 * {HOME, PWD}（src/access-intent/bash/shell-variable-expansion.ts，ADR 0003
 * 排除宿主环境状态），于是 PowerShell 的 `$env:NAME` 拼敏感路径不展开 →
 * 归一化成 cwd 相对路径 → 不匹配任何 deny 规则 → 落到 `"*": "allow"`。
 * 实测（2026-09-13）：
 *
 *   Test-Path 'C:\Users\Administrator\.pi\agent\auth.json'   → deny
 *   Test-Path "$env:USERPROFILE\.pi\agent\auth.json"         → allow（绕过）
 *
 * 本扩展补的是**事后**一层：不看命令长什么样，只看读出来什么。用 pi 原生的
 * `tool_result` 钩子（docs/extensions.md:842 —— 工具执行完、结果发回 LLM 之前
 * 触发，可返回 patch 改 content），把凭据形态的文本替换成 `*`。
 *
 * 两条防线互补，替换掉任何一条都会退化成死循环：
 *   path 规则  = 事前，判据是路径 token    → 能挡误触，挡不住刻意换写法
 *   输出脱敏    = 事后，判据是内容模式      → 不关心写法，但内容已离开进程
 *
 * 安全边界（自查结论）：
 *   能读：所有工具的文本输出（bash / powershell / read / grep 都会经过这里）
 *   发往：无。不引用 fetch / http / net / child_process，仅纯文本替换
 *   副作用：脱敏发生在最终 toolResult 消息之前，所以 session 的 jsonl 里留存
 *           的也是脱敏后的版本 —— 原文不再落盘，这是有意为之
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** 命中后保留的前缀长度：够认出「这是一把钥匙」，不够还原。 */
const KEEP = 3;
const STARS = "********";

function mask(secret: string): string {
  return secret.length <= KEEP ? STARS : secret.slice(0, KEEP) + STARS;
}

/**
 * 敏感键名。刻意收窄：不纳入 `pwd`(目录)、`key`(泛指) —— 它们在技术文本里太
 * 常见，误伤代价高于漏网代价。
 */
const SECRET_KEYS =
  "api[_-]?key|apikey|access[_-]?key|secret[_-]?key|client[_-]?secret|" +
  "auth[_-]?token|access[_-]?token|refresh[_-]?token|bearer[_-]?token|" +
  "private[_-]?key|secret|password|passwd|passphrase|token";

/** PEM 私钥块：整体吞掉，边界用有界量词防止病态回溯。 */
const PRIVATE_KEY_BLOCK =
  /-----BEGIN (?:[A-Z0-9]+ )?PRIVATE KEY-----[\s\S]{0,8000}?-----END (?:[A-Z0-9]+ )?PRIVATE KEY-----/g;

/**
 * 键值对形态（JSON / yaml / ini / dotenv）。
 *
 * 值**必须以引号包裹**，这是刻意的：不加引号限定的话 `const token = getAuthToken()`
 * 会连函数名一起打掉 —— 回溯还会让它只打掉后半截。无引号的凭据交给 BARE_TOKEN
 * 按前缀识别，两条规则合起来覆盖 dotenv 的常见写法。
 * 保留键名与引号，只吃值；`\2` 要求首尾同种引号。
 */
const KEY_VALUE = new RegExp(
  `(["']?\\b(?:${SECRET_KEYS})\\b["']?\\s*[:=]\\s*)(["'])([^"'\\r\\n]{8,})\\2`,
  "gi",
);

/** 无键名的裸凭据：按各家的固定前缀识别。 */
const BARE_TOKEN =
  /\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{30,})\b/g;

/** `Bearer <token>` 头。 */
const BEARER = /\b(Bearer\s+)([A-Za-z0-9_\-./=]{16,})/gi;

/** JWT：三段 base64url。 */
const JWT = /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{4,}/g;

/** URL 内嵌凭据：`scheme://user:pass@host`。 */
const URL_CRED = /\b([a-z][a-z0-9+.-]*:\/\/[^\s/?#@]+:)([^\s/?#@]{3,})(@)/gi;

/** 对一段文本做全量脱敏，返回替换次数以便调用方决定要不要回写。 */
export function redact(input: string): { text: string; count: number } {
  let out = input;
  let count = 0;

  const sub = (re: RegExp, fn: (match: string, ...groups: string[]) => string): void => {
    out = out.replace(re, (...args: unknown[]) => {
      count += 1;
      const match = args[0] as string;
      // 尾部两个是 offset 与整串输入，中间可选还有 groups 对象
      const groups = args.slice(1, typeof args[args.length - 1] === "object" ? -3 : -2) as string[];
      return fn(match, ...groups);
    });
  };

  sub(PRIVATE_KEY_BLOCK, () => `-----BEGIN PRIVATE KEY-----${STARS}-----END PRIVATE KEY-----`);
  sub(KEY_VALUE, (_m, head, quote, value) => `${head}${quote}${mask(value)}${quote}`);
  sub(BARE_TOKEN, (m) => mask(m));
  sub(BEARER, (_m, head, value) => `${head}${mask(value)}`);
  sub(JWT, () => STARS);
  sub(URL_CRED, (_m, head, _pass, at) => `${head}${STARS}${at}`);

  return { text: out, count };
}

export default function (pi: ExtensionAPI) {
  // 覆盖全部工具，不只 cat / git log：read 与 grep 同样会把凭据原文带进上下文。
  pi.on("tool_result", async (event) => {
    const blocks = event.content;
    if (!Array.isArray(blocks)) return undefined;

    let hits = 0;
    const next = blocks.map((block) => {
      const part = block as { type?: string; text?: unknown };
      if (part.type !== "text" || typeof part.text !== "string") return block;

      const { text, count } = redact(part.text);
      if (count === 0) return block;

      hits += count;
      return { ...block, text };
    });

    // 无命中就不返回 patch，避免无谓地改写结果。
    return hits === 0 ? undefined : { content: next };
  });
}
