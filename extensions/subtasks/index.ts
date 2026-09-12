/**
 * Subtasks — 用 session tree 实现"伪 subagent"
 *
 * 机制：
 *   1. agent 调 `push_task` 排队任务（不执行）
 *   2. `/start-task [model]` → 跳到分支起点（fresh context）→ 自动发送 prompt
 *   3. 任务在分支里执行
 *   4. `/finish-task` → 回主分支 → 最后一条 assistant 消息作为结果注入
 */

import {
  defineTool,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type SessionEntry,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";

const TASK_ENTRY_TYPE = "task-branch-pending";
const TASK_START_ENTRY_TYPE = "task-branch-start";
const TASK_DONE_ENTRY_TYPE = "task-branch-done";
const TASK_CLAIM_ENTRY_TYPE = "task-branch-claim";
const TASK_BASE_ENTRY_TYPE = "task-branch-base";
const TASK_HIDE_ENTRY_TYPE = "task-branch-hide";
const STATUS_KEY = "subtasks";

/** /auto 循环是否在跑：auto 自己负责收尾，不再让任务 agent 自行 finish，避免竞态。 */
let autoDriving = false;

/** auto 循环进度（widget/状态栏显示用），仅在 auto 运行期间非空。 */
let autoProgress: { done: number; total: number } | null = null;

/** 主分支队列快照：任务分支里读不到主分支的 pending，靠它显示剩余列表。 */
let queueSnapshot: { n: number; title: string }[] = [];

interface TaskData {
  title: string;
  prompt: string;
}

interface TaskStartData {
  title: string;
  returnTo: string;
  previousModel?: { provider: string; modelId: string };
}

type TaskEntry = SessionEntry & { customType: typeof TASK_ENTRY_TYPE; data: TaskData };
type TaskStartEntry = SessionEntry & {
  customType: typeof TASK_START_ENTRY_TYPE;
  data: TaskStartData;
};

// ── 工具：push_task ───────────────────────────────────────────────

const pushTaskParameters = Type.Object({
  title: Type.String({ description: "任务的简短标题。" }),
  prompt: Type.String({ description: "完整任务提示词（自包含）。" }),
});

/**
 * 把任务写入队列并刷新界面（工具与 /push-task 命令共用）。
 *
 * 任务分支运行中拒绝入队：appendEntry 只能写当前叶子，这时排的任务会挂在
 * 任务分支上，收尾回主分支后主分支链就看不到它了（等于丢任务）。
 */
function enqueueTask(pi: ExtensionAPI, ctx: ExtensionCommandContext, title: string, prompt: string): boolean {
  if (currentTask(ctx.sessionManager)) {
    if (ctx.hasUI) ctx.ui.notify("任务分支正在运行：这时排的任务会挂在分支上收不回。等收尾后再排。", "warning");
    return false;
  }
  const startNewBatch = queuedTasks(ctx.sessionManager).length === 0;
  pi.appendEntry(TASK_ENTRY_TYPE, { title, prompt });
  if (startNewBatch) {
    // 队列从空开始 → 新批次，编号基准挪到本任务之前（widget 从 1 起）
    pi.appendEntry(TASK_BASE_ENTRY_TYPE, { base: pendingNumbers(ctx.sessionManager).size - 1 });
  }
  if (ctx.hasUI) {
    refreshStatus(ctx);
    ctx.ui.notify(`任务已排队：${title}\n用 /start-task 启动。`, "info");
  }
  return true;
}

/** 解析 /push-task 的参数：`标题 | 提示词`，无 `|` 时首行作标题。 */
function parseTaskInput(raw: string): TaskData | null {
  const text = raw.trim();
  if (!text) return null;
  const sep = text.indexOf("|");
  if (sep >= 0) {
    const title = text.slice(0, sep).trim();
    const prompt = text.slice(sep + 1).trim();
    return title && prompt ? { title, prompt } : null;
  }
  const title = text.split("\n")[0].trim();
  return title ? { title, prompt: text } : null;
}

function toolPushTask(pi: ExtensionAPI): ToolDefinition {
  return defineTool({
    name: "push_task",
    label: "Push Task",
    description: "把任务存入队列，等待用户用 /start-task 在独立分支中启动。",
    promptSnippet: "把自包含的任务排队，供用户在独立分支中执行。",
    promptGuidelines: [
      "用 push_task 交付需要独立上下文的任务（审查、探索、批量实现）；一轮可以排多个。",
      "push_task 只入队。需要执行时接着调 task_control(action: \"start\") 启动队首、或 task_control(action: \"auto\") 跑完队列；否则排完就停下汇报。",
    ],
    parameters: pushTaskParameters,
    renderCall(args, theme, context) {
      const header = `${theme.fg("success", "＋")} ${theme.fg("toolTitle", theme.bold(`push_task: ${args.title.trim()}`))}`;
      const lines = args.prompt.split("\n");
      const max = context.expanded ? lines.length : 5;
      const shown = lines.slice(0, max).map((l) => theme.fg("dim", l.trimEnd() || " "));
      if (!context.expanded && lines.length > max) {
        shown.push(theme.fg("muted", `... (还有 ${lines.length - max} 行，ctrl+o 展开)`));
      }
      return new Text([header, ...shown].join("\n"), 0, 0);
    },
    renderResult() {
      return new Text("", 0, 0);
    },
    async execute(_id, params, signal, _upd, ctx) {
      if (signal?.aborted) throw new Error("任务存储被中断。");
      const title = params.title.trim();
      if (!enqueueTask(pi, ctx, title, params.prompt)) {
        return {
          content: [{ type: "text", text: "当前在任务分支内，拒绝入队：等任务收尾回到主分支后再排。" }],
          isError: true,
        };
      }
      const queued = queuedTasks(ctx.sessionManager).length;
      return { content: [{ type: "text", text: `已排队：${title}（队列共 ${queued} 个）` }], details: { title, queued } };
    },
  });
}

// ── 工具：task（斜杠命令的模型入口）────────────────────────────
//
// navigateTree / waitForIdle 只存在于 ExtensionCommandContext（命令专用）。
// 工具里直接派发命令会死锁：命令 handler 要等 agent 空闲，而 agent 正在等工具返回。
// 所以工具只登记请求并结束本轮，等 agent 真正 settle 后再派发对应的斜杠命令。

const TASK_ACTIONS = ["start", "finish", "abort", "discard", "auto"] as const;
type TaskAction = (typeof TASK_ACTIONS)[number];

const COMMAND_OF: Record<TaskAction, string> = {
  start: "start-task",
  finish: "finish-task",
  abort: "abort-task",
  discard: "discard-task",
  auto: "auto",
};

/** 动作前置条件检查；返回错误文案，null 表示可执行。 */
function checkAction(sm: { getBranch(): SessionEntry[] }, action: TaskAction): string | null {
  const active = currentTask(sm);
  const hasPending = pendingTask(sm) !== null;
  switch (action) {
    case "start":
      if (active) return "已在任务分支内：先 finish（带回结果）或 abort（丢弃结果）。";
      return hasPending ? null : "没有排队任务，先用 push_task 排队。";
    case "finish":
    case "abort":
      return active ? null : "当前不在任务分支内。";
    case "discard":
      if (active) return "任务分支内不能丢弃，先 finish 或 abort。";
      return hasPending ? null : "没有排队任务可丢弃。";
    case "auto":
      return active || hasPending ? null : "队列为空，没有任务可跑。";
  }
}

function registerTaskTool(pi: ExtensionAPI): void {
  let pending: { action: TaskAction; model?: string } | null = null;

  pi.registerTool(
    defineTool({
      name: "task_control",
      label: "Task Control",
      description: "控制任务分支：启动/结束/中止/丢弃排队任务，或自动跑完队列（等同 /start-task 等斜杠命令）。",
      promptSnippet: "驱动任务队列（start/finish/abort/discard/auto），效果等同对应斜杠命令。",
      promptGuidelines: [
        "用 push_task 排队后用 task_control(action: \"start\") 在独立分支执行；任务分支里完成工作后用 task_control(action: \"finish\") 把结果带回主分支。",
        "task_control(action: \"auto\") 会依次跑完整个队列（start → finish 循环），适合批量任务。",
        "动作在本轮回复结束后才生效，不要在调用后用工具去确认它的效果。",
      ],
      parameters: Type.Object({
        action: Type.Union(
          TASK_ACTIONS.map((a) => Type.Literal(a)),
          {
            description:
              "start=在独立分支启动排队任务；finish=结束并带回结果；abort=结束不带结果；discard=丢弃排队任务；auto=自动跑完队列。",
          },
        ),
        model: Type.Optional(Type.String({ description: "仅 start 有效：临时切换模型（provider/id 或 id）。" })),
      }),
      renderCall(args, theme) {
        const icon =
          args.action === "finish"
            ? theme.fg("success", "✓")
            : args.action === "abort" || args.action === "discard"
              ? theme.fg("warning", "✗")
              : theme.fg("mdLink", "▶");
        const label = `${args.action}${args.model ? ` (${args.model})` : ""}`;
        return new Text(`${icon} ${theme.fg("toolTitle", theme.bold(`task: ${label}`))}`, 0, 0);
      },
      renderResult() {
        return new Text("", 0, 0);
      },
      async execute(_id, params, signal, _upd, ctx) {
        if (signal?.aborted) throw new Error("任务控制被中断。");
        const action = params.action as TaskAction;
        if (pending) {
          return { content: [{ type: "text", text: "本轮已登记一个任务控制请求，等它执行完再调用。" }], isError: true };
        }
        const blocked = checkAction(ctx.sessionManager, action);
        if (blocked) return { content: [{ type: "text", text: blocked }], isError: true };

        const model = params.model?.trim() || undefined;
        if (model) {
          const matched = ctx.modelRegistry.getAll().filter((m) => `${m.provider}/${m.id}` === model || m.id === model);
          if (matched.length !== 1) {
            const text =
              matched.length === 0
                ? `没找到模型 "${model}"。`
                : `"${model}" 匹配多个模型：${matched.map((m) => `${m.provider}/${m.id}`).join(", ")}`;
            return { content: [{ type: "text", text }], isError: true };
          }
        }

        pending = model ? { action, model } : { action };
        return {
          content: [{ type: "text", text: `已登记 /${COMMAND_OF[action]}，本轮结束后自动执行。` }],
          details: { action, model },
          terminate: true,
        };
      },
    }),
  );

  pi.on("agent_settled", async () => {
    const req = pending;
    if (!req) return;
    pending = null;
    const suffix = req.action === "start" && req.model ? ` ${req.model}` : "";
    pi.sendUserMessage(`/${COMMAND_OF[req.action]}${suffix}`, { expandPromptTemplates: true });
  });
}

// ── 队列状态 ──────────────────────────────────────────────────────

function isTaskEntry(e: SessionEntry): e is TaskEntry {
  return e.type === "custom" && (e as { customType?: string }).customType === TASK_ENTRY_TYPE;
}

function isStartEntry(e: SessionEntry): e is TaskStartEntry {
  return e.type === "custom" && (e as { customType?: string }).customType === TASK_START_ENTRY_TYPE;
}

function isDoneEntry(e: SessionEntry): boolean {
  return e.type === "custom" && (e as { customType?: string }).customType === TASK_DONE_ENTRY_TYPE;
}

/** 已领走的排队条目收据：start / discard 时写，记下 pendingId。 */
function isClaimEntry(e: SessionEntry): boolean {
  return e.type === "custom" && (e as { customType?: string }).customType === TASK_CLAIM_ENTRY_TYPE;
}

function claimedIds(branch: SessionEntry[]): Set<string> {
  const ids = new Set<string>();
  for (const e of branch) {
    if (!isClaimEntry(e)) continue;
    const { pendingId, undo } = (e as { data?: { pendingId?: string; undo?: boolean } }).data ?? {};
    if (!pendingId) continue;
    if (undo) ids.delete(pendingId);
    else ids.add(pendingId);
  }
  return ids;
}

/** 已从面板隐藏的任务（session 条目删不掉，只能记一条隐藏标记）。 */
function hiddenIds(branch: SessionEntry[]): Set<string> {
  const ids = new Set<string>();
  for (const e of branch) {
    if (e.type !== "custom" || (e as { customType?: string }).customType !== TASK_HIDE_ENTRY_TYPE) continue;
    const id = (e as { data?: { pendingId?: string } }).data?.pendingId;
    if (id) ids.add(id);
  }
  return ids;
}

function queuedTasks(sm: { getBranch(): SessionEntry[] }): TaskEntry[] {
  const branch = sm.getBranch();
  const claimed = claimedIds(branch);
  return branch.filter((e) => isTaskEntry(e) && !claimed.has(e.id)) as TaskEntry[];
}

function pendingTask(sm: { getBranch(): SessionEntry[] }): TaskEntry | null {
  return queuedTasks(sm)[0] ?? null;
}

/** 长标题截断：footer 会换行、widget 会溢出，两者都按最多 max 字符显示。 */
function shorten(text: string, max = 25): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** 批次编号基准条目：入队时若队列为空就写一条，使 widget 编号从 1 起。 */
function isBaseEntry(e: SessionEntry): boolean {
  return e.type === "custom" && (e as { customType?: string }).customType === TASK_BASE_ENTRY_TYPE;
}

/** pending 条目的固定编号（批次内按入队顺序，跨轮次稳定，不随消费重排）。 */
function pendingNumbers(sm: { getBranch(): SessionEntry[] }): Map<string, number> {
  const branch = sm.getBranch();
  let base = 0;
  for (const e of branch) {
    if (isBaseEntry(e)) base = (e as { data?: { base?: number } }).data?.base ?? 0;
  }
  const numbers = new Map<string, number>();
  let n = 0;
  for (const e of branch) {
    if (!isTaskEntry(e)) continue;
    n += 1;
    numbers.set(e.id, n - base);
  }
  return numbers;
}

function currentTask(sm: { getBranch(): SessionEntry[] }): TaskStartEntry | null {
  const branch = sm.getBranch();
  let start = -1;
  let done = -1;
  branch.forEach((e, i) => {
    if (isStartEntry(e)) start = i;
    if (isDoneEntry(e)) done = i;
  });
  if (start < 0 || start < done) return null;
  return branch[start] as TaskStartEntry;
}

/** 分支起点（构造 fresh context 的锚）。 */
function findFreshTargetId(sm: { getBranch(): SessionEntry[]; getEntries(): SessionEntry[] }): string | null {
  const branch = sm.getBranch();
  const anchor = branch.length > 0 ? branch[0] : sm.getEntries()[0];
  return anchor ? anchor.id : null;
}

// ── 状态栏 + Widget ─────────────────────────────────────────────

const WIDGET_KEY = "subtasks";

function refreshStatus(ctx: ExtensionCommandContext): void {
  if (!ctx.hasUI) return;

  const active = currentTask(ctx.sessionManager);
  const queued = queuedTasks(ctx.sessionManager);
  const numbers = pendingNumbers(ctx.sessionManager);
  // 在主分支时才刷新快照；任务分支里 queued 为空（队列条目挂主分支上）
  if (!active) {
    queueSnapshot = queued.map((t) => ({ n: numbers.get(t.id) ?? 0, title: t.data.title }));
  }

  // 状态栏：紧凑提示（auto 在后台循环时尤其要看得见，否则看着像会话停了）
  const auto = autoDriving ? "🔄 Auto · " : "";
  const prog = autoDriving && autoProgress ? ` · ${autoProgress.done}/${autoProgress.total}` : "";
  // 待跑数也放进状态栏（footer 扩展状态行可见，widget 可能被自定义编辑器区域遮住）
  const remainCount = active ? queueSnapshot.length : queued.length;
  const rest = remainCount > 0 ? ` · 剩 ${remainCount}` : "";
  const status = active
    ? `${auto}▶️ ${shorten(active.data.title)}${rest}${prog}`
    : queued.length > 0
      ? `${auto}⏳ ${queued.length} 个任务待启动${prog}`
      : autoDriving
        ? `🔄 Auto 运行中${prog}`
        : undefined;
  ctx.ui.setStatus(STATUS_KEY, status);

  // Widget：只列「进行中 + 待跑」，不列已完成（任务多时不占屏）
  if (!active && queued.length === 0 && !autoDriving) {
    ctx.ui.setWidget(WIDGET_KEY, undefined);
    return;
  }

  const lines: string[] = [];
  if (autoDriving) {
    const p = autoProgress ? ` · ${autoProgress.done}/${autoProgress.total} 已完成` : "";
    lines.push(`🔄 Auto 运行中${p}${remainCount > 0 ? ` · 剩 ${remainCount}` : ""}`);
  }
  if (active) {
    lines.push(`▶️ ${shorten(active.data.title)}`);
  }
  const remain = active ? queueSnapshot : queued.map((t) => ({ n: numbers.get(t.id) ?? 0, title: t.data.title }));
  remain.forEach((r) => {
    lines.push(`⏳ ${r.n}. ${shorten(r.title)}`);
  });
  // 用工厂形式拿到 theme，按行首图标上色（不做边框：占屏且非 tool-display 风格本体）
  ctx.ui.setWidget(
    WIDGET_KEY,
    (_tui, theme) => ({
      render: () =>
        lines.map((l) => {
          if (l.startsWith("🔄")) return theme.fg("toolTitle", l);
          if (l.startsWith("▶️")) return theme.fg("success", l);
          if (l.startsWith("⏳")) return theme.fg("muted", l);
          return theme.fg("dim", l);
        }),
      dispose: () => {},
    }),
    { placement: "aboveEditor" },
  );
}

// ── 命令 ──────────────────────────────────────────────────────────

/**
 * 任务收尾提示。auto 会自己循环收尾，此时若任务 agent 也调 finish，
 * 两者会抢同一个动作：auto 醒来时分支已切回主分支，finishTask 会取到
 * 主分支的 assistant 消息当结果回注（实测踩过这个坑）。
 */
function taskHints(): string {
  const env = "\n\n【环境】看不到主分支对话；不查环境变量；不执行 git 操作";
  const flow = autoDriving
    ? "\n\n【收尾】直接输出完整报告，别调 task"
    : "\n\n【收尾】先输出完整报告，再调 task_control(action: \"finish\")";
  return env + flow;
}

async function startTask(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  modelArg?: string,
  waitForAgentStart?: (taskStartId: string) => Promise<boolean>,
): Promise<string | null> {
  const task = pendingTask(ctx.sessionManager);
  if (!task) {
    ctx.ui.notify("没有待执行的任务。先用 push_task 排队。", "warning");
    return null;
  }

  // 可选：切换模型
  let previousModel: TaskStartData["previousModel"];
  if (modelArg) {
    const matched = ctx.modelRegistry.getAll().filter((m) => `${m.provider}/${m.id}` === modelArg || m.id === modelArg);
    if (matched.length !== 1) {
      ctx.ui.notify(
        matched.length === 0 ? `没找到模型 "${modelArg}"。` : `"${modelArg}" 匹配多个：${matched.map((m) => `${m.provider}/${m.id}`).join(", ")}`,
        "warning",
      );
      return null;
    }
    const cur = ctx.model;
    if (cur) previousModel = { provider: cur.provider, modelId: cur.id };
    if (!(await pi.setModel(matched[0]))) {
      ctx.ui.notify(`模型 ${modelArg} 没有配置 API key。`, "warning");
      return null;
    }
  }

  const target = findFreshTargetId(ctx.sessionManager);
  if (!target) {
    ctx.ui.notify("找不到可用的分支起点。", "warning");
    return null;
  }

  // 在主分支写消费收据（returnTo 也定在这条收据上，finish 回来才看得见）
  pi.appendEntry(TASK_CLAIM_ENTRY_TYPE, { pendingId: task.id });
  refreshStatus(ctx); // 此刻仍在主分支：刷新队列快照，把刚领走的这个从待跑列表里去掉
  const departureLeafId = ctx.sessionManager.getLeafId();

  const nav = await ctx.navigateTree(target, { summarize: false });
  if (nav.cancelled) {
    // 收据作废，任务退回队列
    pi.appendEntry(TASK_CLAIM_ENTRY_TYPE, { pendingId: task.id, undo: true });
    return null;
  }

  const startData: TaskStartData = { title: task.data.title, returnTo: departureLeafId ?? "" };
  if (previousModel) startData.previousModel = previousModel;
  pi.appendEntry(TASK_START_ENTRY_TYPE, startData);

  // 先建立「等 agent 启动」的屏障，再发 prompt（否则 /auto 可能误判空闲）
  const taskStartId = ctx.sessionManager.getLeafId() ?? "";
  const started = waitForAgentStart?.(taskStartId);
  pi.sendUserMessage(`${task.data.prompt}${taskHints()}`);
  refreshStatus(ctx);

  if (started && !(await started)) {
    ctx.ui.notify("Auto 停止：任务 agent 未在 60 秒内启动，任务已保留。", "error");
    return null;
  }
  return taskStartId;
}

async function finishTask(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<void> {
  const started = currentTask(ctx.sessionManager);
  if (!started) {
    ctx.ui.notify("当前不在任务分支内。", "warning");
    return;
  }

  // 取最后一条 assistant 的文本
  // 取分支内最后一条「有文本」的 assistant 消息：任务 agent 常在调 finish 前
  // 只发工具调用，最后一条可能是无文本的（实测踩过，报告直接丢了）
  const branch = ctx.sessionManager.getBranch();
  let lastText: string | undefined;
  for (let i = branch.length - 1; i >= 0 && !lastText; i--) {
    const e = branch[i] as { type?: string; message?: { role?: string; content?: unknown } };
    if (e.type !== "message" || e.message?.role !== "assistant") continue;
    const blocks = Array.isArray(e.message.content) ? e.message.content : [];
    const text = blocks
      .filter((b): b is { type: string; text: string } => typeof b === "object" && b !== null && (b as any).type === "text" && typeof (b as any).text === "string")
      .map((b) => b.text)
      .join("\n");
    if (text) lastText = text;
  }

  const title = started.data.title;
  const nav = await ctx.navigateTree(started.data.returnTo, { summarize: false });
  if (nav.cancelled) return;

  if (started.data.previousModel) {
    const m = started.data.previousModel;
    const target = ctx.modelRegistry.getAll().find((x) => x.provider === m.provider && x.id === m.modelId);
    if (target) await pi.setModel(target);
  }

  if (lastText) {
    pi.sendMessage(
      { customType: "task-result", content: lastText, display: true, details: { title } },
      { triggerTurn: true },
    );
  }
  pi.appendEntry(TASK_DONE_ENTRY_TYPE, {});
  refreshStatus(ctx);
}

async function abortTask(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<void> {
  const started = currentTask(ctx.sessionManager);
  if (!started) {
    ctx.ui.notify("当前不在任务分支内。", "warning");
    return;
  }
  const nav = await ctx.navigateTree(started.data.returnTo, { summarize: false });
  if (nav.cancelled) return;
  if (started.data.previousModel) {
    const m = started.data.previousModel;
    const target = ctx.modelRegistry.getAll().find((x) => x.provider === m.provider && x.id === m.modelId);
    if (target) await pi.setModel(target);
  }
  pi.appendEntry(TASK_DONE_ENTRY_TYPE, {});
  ctx.ui.notify("任务已中止（结果未带回）。", "info");
  refreshStatus(ctx);
}

function discardTask(pi: ExtensionAPI, ctx: ExtensionCommandContext, pendingId?: string): void {
  const branch = ctx.sessionManager.getBranch();
  const target = pendingId
    ? (branch.filter(isTaskEntry).find((t) => t.id === pendingId) as TaskEntry | undefined)
    : pendingTask(ctx.sessionManager);
  if (!target) {
    ctx.ui.notify("没有待丢弃的任务。", "warning");
    return;
  }
  pi.appendEntry(TASK_CLAIM_ENTRY_TYPE, { pendingId: target.id });
  ctx.ui.notify(`任务已丢弃：${target.data.title}`, "info");
  refreshStatus(ctx);
}

// ── /auto：自动跑完队列 ──────────────────────────────────────────

const AUTO_AGENT_START_TIMEOUT_MS = 60_000;
const AUTO_STALL_NOTIFY_MS = 30_000;

/** 某条 assistant 消息是否失败（中断/报错）。 */
function isFailedAssistant(e: SessionEntry): boolean {
  const msg = (e as { message?: { stopReason?: string } }).message;
  return msg?.stopReason === "aborted" || msg?.stopReason === "error";
}

/** 找任务开始之后最后一条 assistant 消息。 */
function lastAssistantAfter(sm: { getBranch(): SessionEntry[] }, taskStartId: string): SessionEntry | null {
  let after = false;
  let last: SessionEntry | null = null;
  for (const e of sm.getBranch()) {
    if (e.id === taskStartId) {
      after = true;
      continue;
    }
    const msg = (e as { type?: string; message?: { role?: string } }).message;
    if (after && e.type === "message" && msg?.role === "assistant") last = e;
  }
  return last;
}

/** 当前分支最后一条 assistant 消息。 */
function lastAssistant(sm: { getBranch(): SessionEntry[] }): SessionEntry | null {
  const branch = sm.getBranch();
  for (let i = branch.length - 1; i >= 0; i--) {
    const e = branch[i] as { type?: string; message?: { role?: string } };
    if (e.type === "message" && e.message?.role === "assistant") return branch[i];
  }
  return null;
}

let autoRunning = false;
let autoStopRequested = false;
let agentStartWaiter: { taskStartId: string; resolve: (v: boolean) => void; timeout: NodeJS.Timeout } | null = null;

function settleWaiter(started: boolean): void {
  const w = agentStartWaiter;
  if (!w) return;
  agentStartWaiter = null;
  clearTimeout(w.timeout);
  w.resolve(started);
}

/** 等 agent 真正启动（防止误判空闲） */
function waitForAgentStart(taskStartId: string): Promise<boolean> {
  if (agentStartWaiter) settleWaiter(false);
  return new Promise((resolve) => {
    agentStartWaiter = {
      taskStartId,
      resolve,
      timeout: setTimeout(() => settleWaiter(false), AUTO_AGENT_START_TIMEOUT_MS),
    };
  });
}

/** auto 循环：依次 start → finish 跑完队列（/auto 命令与 /subtasks 面板共用）。 */
async function runAuto(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<void> {
  if (autoRunning) {
    ctx.ui.notify("Auto 已在运行。", "warning");
    return;
  }

  autoRunning = true;
  autoDriving = true;
  autoStopRequested = false;
  let sawActivity = false;
  const queuedNow = queuedTasks(ctx.sessionManager).length;
  autoProgress = { done: 0, total: queuedNow + (currentTask(ctx.sessionManager) ? 1 : 0) };
  refreshStatus(ctx);
  // 状态栏/widget 可能被自定义 footer 或布局遮住，再补一条通知兜底
  if (ctx.hasUI) {
    ctx.ui.notify(`⟳ Auto 已启动：${queuedNow} 个任务待跑`, "info");
  }

  try {
    while (!autoStopRequested) {
      // 停滞检测：等空闲超过 30 秒就提示（用户以为卡死是最常见的困扰）
      const stallTimer = ctx.hasUI
        ? setTimeout(
            () => ctx.ui.notify("⟳ Auto 正在等会话空闲（没卡，是等你这边结束当前对话）", "info"),
            AUTO_STALL_NOTIFY_MS,
          )
        : null;
      try {
        await ctx.waitForIdle();
      } finally {
        if (stallTimer) clearTimeout(stallTimer);
      }
      refreshStatus(ctx);
      if (autoStopRequested) break;

      const active = currentTask(ctx.sessionManager);
      const pending = pendingTask(ctx.sessionManager);

      // 失败保护：任务响应报错/中断则停
      const lastMsg = active ? lastAssistantAfter(ctx.sessionManager, active.id) : lastAssistant(ctx.sessionManager);
      if ((active || pending) && lastMsg && isFailedAssistant(lastMsg)) {
        ctx.ui.notify("Auto 已停止：任务响应失败，任务已保留可重试。", "error");
        break;
      }

      // 有排队任务 → 启动
      if (pending) {
        const taskStartId = await startTask(pi, ctx, undefined, waitForAgentStart);
        if (taskStartId === null) break; // 取消或启动超时
        sawActivity = true;
        continue;
      }

      // 在任务分支内 → 结束
      if (active) {
        if (!lastAssistantAfter(ctx.sessionManager, active.id)) break; // 还没产出响应
        await finishTask(pi, ctx);
        if (autoProgress) autoProgress.done += 1;
        refreshStatus(ctx);
        sawActivity = true;
        continue;
      }

      // 无任务
      if (!sawActivity) {
        ctx.ui.notify("没有待执行的任务。", "info");
        break;
      }
      if (!ctx.hasPendingMessages()) break;
    }
  } finally {
    settleWaiter(false);
    // 先清标志再刷新，否则状态栏会残留 ⟳ Auto（沙箱实测踩到）
    autoRunning = false;
    autoDriving = false;
    autoProgress = null;
    refreshStatus(ctx);
    if (autoStopRequested) ctx.ui.notify("Auto 已停止。", "info");
  }
}

function registerAuto(pi: ExtensionAPI): void {
  pi.on("agent_start", (_e, ctx) => {
    if (agentStartWaiter && currentTask(ctx.sessionManager)?.id === agentStartWaiter.taskStartId) {
      settleWaiter(true);
    }
  });

  pi.on("session_shutdown", async () => {
    autoStopRequested = true;
    settleWaiter(false);
  });

  pi.registerCommand("auto", {
    description: "自动跑完所有排队任务（start → finish 循环）",
    handler: async (_args, ctx) => {
      await runAuto(pi, ctx);
    },
  });
}

// ── /subtasks：交互式任务面板 ────────────────────────────────────

const PANEL_NEW = "➕ 新建任务";
const PANEL_AUTO = "🔄 跑完队列 (auto)";
const PANEL_CLOSE = "✖️ 关闭";

/** 交互式任务面板：查看状态 / 新建 / 执行 / 丢弃任意任务。 */
async function showTaskPanel(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<void> {
  while (true) {
    const branch = ctx.sessionManager.getBranch();
    const claimed = claimedIds(branch);
    const numbers = pendingNumbers(ctx.sessionManager);
    const active = currentTask(ctx.sessionManager);
    const hidden = hiddenIds(branch);
    const tasks = branch
      .filter(isTaskEntry)
      .filter((t) => (numbers.get(t.id) ?? 0) > 0)
      .filter((t) => !hidden.has(t.id));
    const currentId = active ? ([...tasks].reverse().find((t) => claimed.has(t.id))?.id ?? null) : null;

    const rows = tasks.map((t) => {
      const mark = t.id === currentId ? "▶️" : claimed.has(t.id) ? "✅" : "⏳";
      const state = t.id === currentId ? "running" : claimed.has(t.id) ? "done" : "queued";
      return { id: t.id, state, title: t.data.title, label: `${mark} ${numbers.get(t.id) ?? 0}. ${shorten(t.data.title)}` };
    });

    const doneCount = rows.filter((r) => r.state === "done").length;
    const queuedCount = rows.filter((r) => r.state === "queued").length;
    const runningCount = rows.filter((r) => r.state === "running").length;
    const summary = [
      runningCount ? `进行 ${runningCount}` : "",
      queuedCount ? `待跑 ${queuedCount}` : "",
      doneCount ? `完成 ${doneCount}` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    const clearLabel = doneCount ? `🗑️ 清空已完成（${doneCount}）` : null;
    // 面板标题沿用 footer 的状态串（含图标），两处保持一致
    const activeNow = currentTask(ctx.sessionManager);
    const queuedNow = queuedTasks(ctx.sessionManager);
    const statusPart = activeNow
      ? `▶️ ${shorten(activeNow.data.title)} · 剩 ${queuedNow.length}`
      : queuedNow.length > 0
        ? `⏳ ${queuedNow.length} 个任务待启动`
        : null;
    const picked = await ctx.ui.select(
      `${statusPart ? `${statusPart} · ` : ""}任务面板${summary ? ` · ${summary}` : "（空）"}`,
      [PANEL_NEW, PANEL_AUTO, ...(clearLabel ? [clearLabel] : []), ...rows.map((r) => r.label), PANEL_CLOSE],
    );
    if (!picked || picked === PANEL_CLOSE) return;

    if (clearLabel && picked === clearLabel) {
      for (const r of rows.filter((x) => x.state === "done")) {
        pi.appendEntry(TASK_HIDE_ENTRY_TYPE, { pendingId: r.id });
      }
      ctx.ui.notify(`已从面板移除 ${doneCount} 个已完成任务（记录仍在对话里）。`, "info");
      continue;
    }

    if (picked === PANEL_NEW) {
      const title = (await ctx.ui.input("任务标题"))?.trim();
      if (!title) continue;
      const prompt = (await ctx.ui.editor("任务提示词（必须自包含：分支看不到主分支上下文）"))?.trim();
      if (!prompt) continue;
      enqueueTask(pi, ctx, title, prompt);
      continue;
    }

    if (picked === PANEL_AUTO) {
      await runAuto(pi, ctx);
      continue;
    }

    const row = rows.find((r) => r.label === picked);
    if (!row) continue;
    if (row.state === "done") {
      const pick = await ctx.ui.select(row.label, ["查看报告", "从列表移除"]);
      if (pick === "从列表移除") {
        pi.appendEntry(TASK_HIDE_ENTRY_TYPE, { pendingId: row.id });
        ctx.ui.notify(`${row.title}：已从面板移除（记录仍在对话里）。`, "info");
        continue;
      }
      if (pick !== "查看报告") continue;
      // 展示该任务的报告（task-result 回注时带了 title）
      const result = [...ctx.sessionManager.getBranch()]
        .reverse()
        .find((e) => (e as { customType?: string }).customType === "task-result" && (e as { details?: { title?: string } }).details?.title === row.title);
      const content = (result as { content?: unknown } | undefined)?.content;
      if (typeof content === "string" && content.trim()) {
        await ctx.ui.editor(`报告：${row.title}`, content);
      } else {
        ctx.ui.notify("找不到该任务的报告（可能被中止或还没回注）。", "warning");
      }
      continue;
    }

    const isHead = pendingTask(ctx.sessionManager)?.id === row.id;
    const actions =
      row.state === "running"
        ? ["finish（结束并带回结果）", "abort（结束不带结果）"]
        : isHead
          ? ["start（立即执行）", "discard（丢弃）"]
          : ["discard（丢弃）"];

    const action = await ctx.ui.select(row.label, actions);
    if (!action) continue;

    if (action.startsWith("discard")) {
      discardTask(pi, ctx, row.id);
      continue;
    }
    // start / finish / abort 都会切换分支并触发新一轮，做完就退出面板
    if (action.startsWith("start")) await startTask(pi, ctx);
    else if (action.startsWith("finish")) await finishTask(pi, ctx);
    else if (action.startsWith("abort")) await abortTask(pi, ctx);
    return;
  }
}

// ── 入口 ──────────────────────────────────────────────────────────

export default function taskBranch(pi: ExtensionAPI): void {
  pi.registerTool(toolPushTask(pi));
  registerTaskTool(pi);

  pi.registerCommand("push-task", {
    description: "手动排队任务：/push-task <标题> | <提示词>",
    handler: async (args, ctx) => {
      const task = parseTaskInput(args);
      if (!task) {
        ctx.ui.notify("用法：/push-task <标题> | <提示词>", "warning");
        return;
      }
      enqueueTask(pi, ctx, task.title, task.prompt);
    },
  });

  pi.registerCommand("subtasks", {
    description: "任务面板：查看状态 / 新建任务 / 执行或丢弃",
    handler: async (_args, ctx) => {
      await ctx.waitForIdle();
      if (!ctx.hasUI) {
        ctx.ui.notify("需要交互式界面（TUI）。", "warning");
        return;
      }
      await showTaskPanel(pi, ctx);
    },
  });

  pi.registerCommand("start-task", {
    description: "跳到分支起点执行排队任务（可带模型名）",
    handler: async (args, ctx) => {
      await ctx.waitForIdle();
      await startTask(pi, ctx, args.trim() || undefined);
    },
  });

  pi.registerCommand("finish-task", {
    description: "结束任务：回主分支并带回最后一条 assistant 消息",
    handler: async (_a, ctx) => {
      await ctx.waitForIdle();
      await finishTask(pi, ctx);
    },
  });

  pi.registerCommand("abort-task", {
    description: "中止任务：回主分支但不带回结果",
    handler: async (_a, ctx) => {
      await ctx.waitForIdle();
      await abortTask(pi, ctx);
    },
  });

  pi.registerCommand("discard-task", {
    description: "丢弃排队中的任务（不执行）",
    handler: async (_a, ctx) => {
      await ctx.waitForIdle();
      discardTask(pi, ctx);
    },
  });

  registerAuto(pi);

  // 会话结束时清理 widget
  pi.on("session_shutdown", async (_e, ctx) => {
    const c = ctx as ExtensionCommandContext;
    if (c.hasUI) c.ui.setWidget(WIDGET_KEY, undefined);
  });

  pi.on("session_start", async (_e, ctx) => refreshStatus(ctx as ExtensionCommandContext));
  pi.on("turn_end", async (_e, ctx) => refreshStatus(ctx as ExtensionCommandContext));
  pi.on("session_tree", async (_e, ctx) => refreshStatus(ctx as ExtensionCommandContext));
}
