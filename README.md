# my-pi

个人 [pi](https://pi.dev) 编码智能体配置仓库。

集中管理 pi Agent 的**行为准则、模型提供商、MCP 服务、扩展与 skills**，用于跨机器同步与版本回溯。

---

## 🗂️ 目录结构

本仓库**直接位于 `~/.pi/agent/`**（就地纳管）——改配置就是改仓库，无需拷贝同步。

```
~/.pi/agent/
│
│  ── 纳入版本控制 ──
├── AGENTS.md              # 全局行为准则（输出风格、工作准则、工作流、工具与约束）
├── settings.json          # pi 核心设置（模型、工具、包、主题、压缩、重试）
├── open-tui.json          # pi-open-tui 界面配置（footer 段、telemetry、光标）
├── models.example.json    # 模型配置模板（真实 models.json 不入库）
├── mcp.example.json       # MCP 配置模板（真实 mcp.json 不入库）
├── pi-usage/
│   └── config.json        # pi-usage 用量面板配置
├── extensions/            # 本地扩展与第三方扩展的配置
│   ├── models-sync/           # models.json 热同步（/reload 不重读模型，靠它）
│   ├── subtasks/              # 伪 subagent：push-task / task 任务分支
│   ├── tools/                 # /tools 命令，交互式启停工具
│   ├── pi-permission-system/
│   │   └── config.json        # 权限规则（敏感路径 deny、shell 命令 ask）
│   └── pi-tool-display/
│       └── config.json        # 工具输出展示（diff 视图、预览行数、MCP 摘要）
├── skills/                # 16 个自定义 skill（7 个自动注入，9 个仅 /skill: 调用）
├── archive/               # 已移除的自制资产（备查，不生效）
│   ├── README.md              # 每项的作用 / 移除原因 / 恢复方式 / 冲突风险
│   ├── i-have-adhd/           # ADHD 模式扩展与 skill
│   ├── footer/                # 自绘 TUI 状态栏（已被 pi-open-tui 取代）
│   └── web-search.json
├── .githooks/pre-commit   # 提交前密钥审计
├── .gitignore
├── .gitattributes
└── README.md

│  ── 本地文件（.gitignore 排除）──
├── auth.json              # 🔒 API 凭据
├── models.json            # 🔒 含内部中转站地址
├── mcp.json               # 🔒 含本地服务令牌
├── models-store.json      # 运行时状态
├── trust.json             # 信任状态
├── sessions/              # 会话记录
├── npm/  bin/  git/  state/
├── extensions/tty7/       # 机器生成的扩展
└── pi-usage/skill-usage.jsonl
```

---

## 🧩 扩展说明

### models-sync — 模型热同步

把 `~/.pi/agent/models.json` 同步进当前会话。

**解决的问题**：

1. `/reload` 不会重读 `models.json`
2. 已打开的会话不监听该文件
3. 内置 provider（如 `deepseek`）会把 `models-store.json` 里的远程模型叠加到自定义列表上，导致自定义 `thinkingLevelMap`、`cost` 被覆盖

**文件**：`index.ts`（入口）、`models-sync.ts`（watch + 合并逻辑）

### subtasks — 伪 subagent

用 session tree 实现任务分支：`push-task` 入队、`task` 在独立分支执行并带回结果。

| 工具 | 作用 |
|------|------|
| `push-task` | 把自包含任务入队（不执行） |
| `task` | `start` / `finish` / `abort` / `discard` / `auto` |

**文件**：`index.ts`

### tools — 工具启停

提供 `/tools` 命令，交互式启用/禁用工具。选择跨会话持久化，并遵循分支导航。

**文件**：`index.ts`、`tools.ts`

### pi-permission-system（配置）

权限规则，四层组合、最严格者胜：`path` → `external_directory` → 按工具 → 默认。

关键规则：

| 规则 | 动作 |
|------|------|
| `~/.pi/agent/auth.json` | `deny` |
| `~/.pi/agent/models.json` | `deny` |
| `~/.pi/agent/mcp.json` | `deny` |
| `~/.pi/agent/models-store.json` | `deny` |
| `~/.ssh/*` | `deny` |
| `*.env` / `*.env.*` | `deny` |
| `~/.pi/agent/settings.json` | `ask` |
| `external_directory` | `ask` |

> ⚠️ **已知缺口**：`powershell` 不属于 `PATH_BEARING_TOOLS`，被归类为 extension，**不受 `path` 规则约束**。已在 `AGENTS.md` 加自律约束。

### pi-tool-display（配置）

工具输出展示：diff 视图模式、预览行数、MCP 输出摘要、截断提示等。

---

## 🎯 Skills（16 个）

> pi 自动读取 `~/.pi/agent/skills/` 与 `~/.agents/skills/`
>
> `disable-model-invocation: true` 的 skill **不注入系统提示词**（不占上下文），只能用 `/skill:<name>` 手动触发。

### 自动注入（7 个，约 680 tokens）

| Skill | 功能 |
|-------|------|
| `gencom` | 根据 git diff 生成提交信息 |
| `code-review-expert` | 审查 git 改动（SOLID、安全、可执行建议） |
| `planning-with-files` | 复杂任务文件化规划，支持 `/clear` 后恢复 |
| `todo-list` | 多级嵌套待办、进度汇总、软删除回收站（`ta#` 触发） |
| `naming` | 中文描述 → 英文标识符（PascalCase） |
| `add-anchor` | 为 Markdown 标题加英文锚点 `{#id}` |
| `init-agents-md` | 扫描项目结构并初始化项目级 AGENTS.md |

### 仅命令触发（9 个，零上下文开销）

| Skill | 功能 | 触发 |
|-------|------|------|
| `grill-with-docs` | 反复追问澄清设计，生成 CONTEXT.md 与 ADR | `/skill:grill-with-docs` |
| `humanizer-zh` | 去除中文文本的 AI 写作痕迹 | `/skill:humanizer-zh` |
| `add-frontmatter` | 为 Markdown 加 frontmatter | `/skill:add-frontmatter` |
| `skill-creator` | 创建/优化 skill（含评估与描述优化） | `/skill:skill-creator` |
| `skill-monitor` | 用 GitHub URL 监控远程文件变更 | `/skill:skill-monitor` |
| `find-skills` | 查找并安装可用 agent skill | `/skill:find-skills` |
| `github-issue-creator` | 按仓库模板创建带标签的 Issue | `/skill:github-issue-creator` |
| `pr-creator` | 按仓库模板创建 Pull Request | `/skill:pr-creator` |
| `pr-address-comments` | 处理当前分支的 PR 评论（需 `gh` CLI） | `/skill:pr-address-comments` |

---

## ⚙️ 配置说明

### settings.json

| 配置项 | 值 | 说明 |
|--------|-----|------|
| `theme` | `dark` | 界面主题 |
| `tuiMode` | `fullscreen` | 全屏 TUI |
| `defaultProvider` / `defaultModel` | `deepseek` / `deepseek-flash` | 默认模型 |
| `defaultThinkingLevel` | `medium` | 默认思考等级 |
| `defaultTools` | `read, write, edit, ls, grep, find, powershell` | 内置工具（Windows 用 powershell 而非 bash） |
| `compaction` | `enabled` | 上下文压缩（保留 65536 / 近期 40960 tokens） |
| `retry` | 最多 10 次，基础延迟 10 s，provider 上限 120 s | 自动重试 |
| `hideThinkingBlock` | `true` | 隐藏思考块 |
| `showCacheMissNotices` | `false` | 不提示缓存未命中 |
| `quietStartup` | `true` | 静默启动 |
| `treeFilterMode` | `no-tools` | 会话树过滤 |
| `markdown.mermaid` | `final` | Mermaid 仅在最终输出渲染 |
| `fullscreenExitOutput` | `transcript` | 退出全屏时输出记录 |

### packages（需单独安装）

```powershell
pi install npm:pi-open-tui
pi install npm:pi-tool-display
pi install npm:pi-mcp-adapter
pi install npm:@gotgenes/pi-permission-system
pi install npm:@juicesharp/rpiv-ask-user-question
pi install npm:@wayner6/pi-usage
```

| 包 | 作用 |
|----|------|
| `pi-open-tui` | 自定义 TUI 与 footer |
| `pi-tool-display` | 工具输出渲染 |
| `pi-mcp-adapter` | MCP 适配器（`mcp` / `mcpScript` 工具） |
| `@gotgenes/pi-permission-system` | 权限系统 |
| `@juicesharp/rpiv-ask-user-question` | 结构化提问 `ask_user_question` |
| `@wayner6/pi-usage` | 用量/余额面板 |

### mcp.json（⚠️ 不纳入仓库）

**本文件含本地服务令牌（OxideTerm、思源）与机器绝对路径，已在 `.gitignore` 中排除。**
仓库内提供 **`mcp.example.json`** 作为模板。

4 个 MCP 服务器：

| 服务器 | 传输 | 说明 |
|--------|------|------|
| `chrome-devtools` | stdio | Chrome DevTools 协议（需指定 Chrome/CentBrowser 可执行文件） |
| `dbx-mcp-server` | stdio | DBX 数据库桌面端集成 |
| `oxideterm-mcp-server` | stdio | OxideTerm 终端桥接（**需 token**） |
| `siyuan-mcp-server` | stdio | 思源笔记（**需 token**） |

> 🔒 **模板相比实际配置做了两类可移植化：**
>
> | 实际 | 模板 | 原因 |
> |------|------|------|
> | `D:\program\...\node.exe` | `npx` | 避免硬编码 node 安装路径 |
> | `D:\program\...\chrome-devtools-mcp.js` | `-y chrome-devtools-mcp@latest` | 走 npm 解析 |
> | 令牌明文 | `${OXIDETERM_MCP_TOKEN}` / `${SIYUAN_TOKEN}` | 占位符 |
> | `D:\program\mybrowser\...\chrome.exe` | `${CHROME_EXECUTABLE}` | 机器特定 |
>
> 若你的环境依赖特定 node 版本或非 npx 安装方式，把模板里的 `npx` 改回绝对路径即可。

### models.json（⚠️ 不纳入仓库）

**本文件因含内部中转站地址（企业代理与折扣站的 baseUrl），已在 `.gitignore` 中排除。**

仓库内提供 **`models.example.json`** 作为模板：结构完整、地址全部占位，复制为 `~/.pi/agent/models.json` 并替换 3 处即可使用。

| 占位 | 替换为 |
|------|--------|
| `https://your-relay-a.example.com/v1` | 折扣中转站地址 |
| `https://your-enterprise-proxy.example.com/...` | 企业代理地址（两个 provider 共用） |
| `$DEEPSEEK_API_KEY` / `$RELAY_A_API_KEY` | 也可直接写明文，或改用 `auth.json` |

共 4 个 provider（1 个官方 + 3 个中转）：

| Provider | API | 模型 | 说明 |
|----------|-----|------|------|
| 官方 DeepSeek | openai-completions | `deepseek-flash`、`deepseek-v4-pro` | 1M 上下文 / 384K 输出 |
| 中转 A | openai-completions | 4 个（DeepSeek / GLM） | 折扣站 |
| 中转 B / C | openai-completions | `claude-fable-5`、`claude-opus-5` | 企业代理 |

**官方 DeepSeek 的关键配置**（易踩坑）：

```json
{
  "compat": {
    "supportsStore": false,
    "supportsDeveloperRole": false,
    "maxTokensField": "max_tokens",
    "requiresReasoningContentOnAssistantMessages": true,
    "thinkingFormat": "deepseek",
    "sendSessionAffinityHeaders": false
  },
  "models": [
    {
      "id": "deepseek-flash",
      "contextWindow": 1000000,
      "maxTokens": 384000,
      "reasoning": true,
      "thinkingLevelMap": { "minimal": null, "low": "low", "medium": null, "high": "high", "max": "max" },
      "cost": { "input": 1, "output": 4, "cacheRead": 0.02, "cacheWrite": 0 }
    }
  ]
}
```

> ⚠️ **不要在 provider 上写 `headers.Authorization`**。显式的 `Authorization` 头会**覆盖** pi 生成的鉴权头，导致 key 失效。
> `cost` 单位为**每百万 tokens**，本仓库用**人民币空闲时段价**（与 DeepSeek 官网中文页一致）。

---

## 🚀 快速开始

### 日常更新（就地模式）

仓库就在 `~/.pi/agent/`，改配置后直接提交：

```bash
cd ~/.pi/agent
git status                    # 看改了什么
git add -A
git commit -m "🔄 调整 XXX"     # 钩子自动审计
git push
```

拉取其它机器的改动：

```bash
git pull                      # 已跟踪文件会被覆盖，本地文件（.gitignore）不受影响
```

> `/reload` 不会重读 `models.json`；若刚 `git pull` 拉到了新的模型配置，用 `models-sync` 扩展热同步（它监控该文件）。

### 新机器部署

```bash
# 1) 克隆到 pi 配置目录（该目录尚不存在时）
git clone git@github.com:netcatty/my-pi.git ~/.pi/agent
cd ~/.pi/agent

# 2) 启用提交前密钥审计钩子
#    core.hooksPath 是本地配置，不会随克隆附带，必须手动跑一次
git config core.hooksPath .githooks

# 3) 安装依赖包
pi install npm:pi-open-tui
pi install npm:pi-tool-display
pi install npm:pi-mcp-adapter
pi install npm:@gotgenes/pi-permission-system
pi install npm:@juicesharp/rpiv-ask-user-question
pi install npm:@wayner6/pi-usage

# 4) 建本地配置（两者都不入库，从模板改）
cp models.example.json models.json
cp mcp.example.json    mcp.json

# 5) 登录 provider（写入 auth.json）
pi
/login
```

### 需手动替换的占位符

| 文件 | 占位 | 替换为 |
|------|--------|--------|
| `models.json` | `https://your-relay-a.example.com/v1` | 折扣中转站地址 |
| | `https://your-enterprise-proxy.example.com/...` | 企业代理地址（两个 provider 共用） |
| | `$DEEPSEEK_API_KEY` / `$RELAY_A_API_KEY` | 明文 key，或改走 `auth.json` |
| `mcp.json` | `${CHROME_EXECUTABLE}` | Chrome/CentBrowser 可执行文件路径 |
| | `${DBX_DATA_DIR}` | DBX 数据目录 |
| | `${OXIDETERM_MCP_TOKEN}` | OxideTerm 桥接令牌 |
| | `${SIYUAN_TOKEN}` | 思源笔记 API 令牌 |

> 若服务器路径与模板不同（如自建 node、非 npx 安装），参照旧的 `mcp.json` 改回去即可。

### 新增扩展 / skill

直接建在 `extensions/` 或 `skills/` 下即可——它们已在跟踪范围，`git add` 后就会被纳管。

例外（已在 `.gitignore`）：

- `extensions/tty7/` —— 由 tty7 工具自动生成（头行写着 `generated by tty7, do not edit`）
- 含密钥的扩展配置 —— 请改用 `*.example.json` + 占位符的模式

---## 🔒 安全约定

**本仓库绝不跟踪**：

| 路径 | 原因 | 替代 |
|------|------|------|
| `auth.json` | API 凭据，泄露即被盗用 | `/login` 重新生成 |
| `models.json` | 含内部中转站地址 | `models.example.json` |
| `mcp.json` | 含本地服务令牌 | `mcp.example.json` |
| `sessions/` | 会话记录，含隐私且体积大 | —— |
| `npm/` `bin/` | 依赖与二进制，可重建 / 平台特定 | 重新安装 |
| `models-store.json` | 运行时状态，会覆盖自定义模型配置 | 自动生成 |
| `trust.json` | 信任状态，机器本地 | 自动生成 |
| `extensions/tty7/` | 由 tty7 工具自动生成 | 工具重建 |
| `pi-usage/skill-usage.jsonl` | 使用统计 | —— |
| `mcp-cache.json` 等缓存 | 可重建 | 自动生成 |
| `*.bak` | 备份冗余 | —— |

详见 `.gitignore`。

### 自动审计钩子

`.githooks/pre-commit` 在每次提交时拦截 5 类问题：

| 检查 | 说明 |
|------|------|
| 敏感文件名 | `auth.json` / `models.json` / `mcp.json` / `*.env` / `*.pem` / `*.bak` |
| API key 特征 | `sk-` / `ghp_` / `AKIA` |
| 长十六进制串 | 32+ 位（排除 `${VAR}`、schema、字体色值等） |
| 私钥块 | `-----BEGIN ... PRIVATE KEY-----` |
| 非白名单域名 | 白名单外的一切 `http(s)://` |

**每个新克隆必须手动启用一次**（`core.hooksPath` 是本地配置，不会随克隆附带）：

```bash
git config core.hooksPath .githooks
```

**临时绕过**（仅限确认无害时）：`git commit --no-verify`

### 手动复检

钩子只看暂存内容；怀疑历史时用这两条：

```powershell
# 密钥与长十六进制串
git log -p --all | Select-String -Pattern "sk-[A-Za-z0-9]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|[a-f0-9]{32,}"

# 非公开域名：把白名单换成自己的内部域名
git grep -hnE "https?://" -- '*.json' | Select-String -NotMatch "github|deepseek|127\.0\.0\.1|localhost|example\.com"
```

> 钩子已自动做这些检查。手动复检只在「怀疑历史」或「想查钩子白名单外的内容」时需要——
> **且不要把真实内部域名写进命令**，否则审计命令自己就成了泄露源。

---

## 📜 AGENTS.md 要点

`AGENTS.md` 是 agent 的行为准则，核心：

- **输出**：简体中文；首句即行动；超过一步就编号；结尾给一个可执行的下一步
- **工作准则**：先核实再动手、外科手术式修改、简洁优先、目标驱动
- **工作流**：普通功能 → 编码 → `/skill:code-review-expert` → `/skill:gencom`；复杂功能先 `/skill:planning-with-files`
- **工具分工**：读文件用 `read`、搜内容用 `grep`、找文件用 `find`、列目录用 `ls`；`powershell` 只用于真 shell
- **约束**：不碰 `auth.json` / `models.json` / `mcp.json` / `~/.ssh/*` / `*.env`
