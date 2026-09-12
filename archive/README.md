# archive

**已从 `~/.pi/agent/` 移除、但保留备查的自制资产。**

这些不是当前生效的配置——放在这里是为了「删了还能找回」。恢复时把对应内容拷回 `~/.pi/agent/` 即可，但注意下面标注的冲突。

> 原本归档于此的 3 个 GitHub 工作流 skill（`github-issue-creator`、`pr-creator`、`pr-address-comments`）已恢复到 `skills/`，并加上 `disable-model-invocation: true`——它们**不占系统提示词**，只能用 `/skill:<name>` 手动触发。

---

## `i-have-adhd/`

ADHD 模式扩展 + skill。说「ADHD MODE ACTIVE」时生效，调整回复形态：先给下一步动作、步骤编号、每轮重述进度、给具体时间估计。

| 文件 | 作用 |
|------|------|
| `i-have-adhd.ts` | 扩展主体（注入输出规则 + `.i-have-adhd-always` 开关） |
| `context-compat.ts` | 上下文兼容层 |
| `index.ts` | 入口 |
| `agents/gemini.toml` | Gemini 侧规则 |
| `agents/openai.yaml` | OpenAI 侧规则 |
| `SKILL.md` | skill 定义 |
| `.i-have-adhd-always` | 空标记文件，存在即默认开启 |

**移除原因**：输出规则已直接写进 `AGENTS.md`（「首句即行动」「多步编号」「每轮重述状态」「给具体时间估计」），无需扩展。

**恢复方式**：
- `.ts` 文件 → `~/.pi/agent/extensions/i-have-adhd/`
- `SKILL.md` + `agents/` → `~/.pi/agent/skills/i-have-adhd/`

**⚠️ 冲突**：与 `AGENTS.md` 现有输出规则**重复**，同时启用会造成风格冲突。

---

## `footer/`

自绘 TUI 底部状态栏扩展，展示 cwd、计时、context 进度、token 统计、git 状态等。图标支持 Nerd Font / ASCII 双模式。

| 文件 | 作用 |
|------|------|
| `index.ts` | 生命周期装配 |
| `footer.ts` | 渲染逻辑（13 KB，主体） |
| `icons.ts` | 图标定义与终端检测 |
| `git.ts` | git 状态读取 |
| `utils.ts` | 格式化工具 |

**移除原因**：已由 npm 包 `pi-open-tui` 提供同等功能（配置见 `open-tui.json` 的 `footerSegments` / `telemetry`）。

**恢复方式**：整个目录 → `~/.pi/agent/extensions/footer/`

**⚠️ 冲突**：会与 `pi-open-tui` 的 footer **抢占同一底部行**。要么卸掉 `pi-open-tui`，要么别恢复这个。

---

## `web-search.json`

原 `~/.pi/web-search.json.bak`。web-search 扩展的小配置：

```json
{ "tools": { "sourceCheck": { "enabled": false } } }
```

**恢复方式**：重命名为 `~/.pi/agent/web-search.json`

---

## 未归档（已确认无价值，直接丢弃）

| 文件 | 原因 |
|------|------|
| `~/.pi/auth.json.lock.guard.bak` | 0 字节空文件 |
| `~/.pi/mcp-npx-cache.json.bak` | npx 缓存路径，机器特定，会自动重建 |
| `~/.pi/agent/models.json.bak` | 模型配置的旧快照，内容已被 `models.json` 取代 |
