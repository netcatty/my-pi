---
name: skill-monitor
description: 用 GitHub URL 监控远程文件变更并生成摘要。
disable-model-invocation: true
---

# Skill Monitor

监控 GitHub 仓库中某个目录下的所有文件，定期检查更新，生成变更摘要，由用户决定是否更新。

解决的核心问题：不使用 `npx skills`（可能因系统环境问题安装/更新失败），改为维护一份 URL 监控清单，自动跟踪上游文件的变更。

## 数据目录结构（~/.skill-monitor/）

```
~/.skill-monitor/
├── monitor.json          # 监控清单（唯一事实来源）
├── reports/              # 变更摘要报告（按日期分目录）
│   └── 2026-02-10/
│       └── <watch-id>.md
└── backups/              # 更新前的旧版本备份
    └── <watch-id>/
        └── 20260210-1430/
```

`monitor.json` 结构：

```json
{
  "watches": [
    {
      "id": "unique-id",
      "repo": "owner/repo",
      "path": "skills/some-skill",
      "ref": "main",
      "local_dir": "~/.pi/agent/skills/some-skill",
      "files": {
        "SKILL.md": "<blob sha>",
        "references/schema.md": "<blob sha>"
      }
    }
  ]
}
```

- `path` 为空表示仓库根目录
- `files` 记录目录下每个文件相对路径对应的 **blob sha**（GitHub contents API 返回），这是判断更新的依据
- 本地目标目录 `local_dir` 与远端目录一一对应，文件布局保持一致

## 核心操作

### 1. 添加监控（用户提供 URL 时）

用户给一个 GitHub 目录 URL（如 `https://github.com/owner/repo/tree/main/skills/foo`）或文件 URL，按以下步骤：

1. **解析 URL** → 得到 `repo`（owner/repo）、`path`（目录路径）、`ref`（分支/标签，默认 main）
2. **询问用户本地保存位置**（如果意图是安装 skill，默认建议 `~/.agents/skills/<目录名>`）
3. **用 GitHub API 递归列出目录下所有文件及 blob sha**：
   ```bash
   gh api "repos/{owner}/{repo}/contents/{path}?ref={ref}" --paginate
   ```
   （contents API 单层返回，子目录需递归；优先用 `gh api`，未登录时回退 `curl -s https://api.github.com/...`）
4. **下载所有文件**到 `local_dir`（raw 地址：`https://raw.githubusercontent.com/{repo}/{ref}/{path}/{file}`）
5. **写入 monitor.json**：追加 watch 条目，`files` 记录每个文件的 sha
6. 汇报：已监控 N 个文件，来源 URL，本地路径

### 2. 检查更新（用户说"检查更新"或运行脚本）

1. 读取 `monitor.json`，对每条 watch：
   - 用 GitHub API 重新列出目录文件，获取最新 sha
   - 与 `files` 中记录的 sha 对比 → 找出 **修改 / 新增 / 删除** 的文件
2. 对每个变化的文件，下载新版本到临时目录
3. **生成变更摘要**（不保存原始 diff，只生成人类可读摘要）到 `reports/<日期>/<watch-id>.md`：
   ```markdown
   # 更新摘要：<watch-id>（<日期>）
   来源: https://github.com/<repo>/tree/<ref>/<path>
   本地: <local_dir>

   ## 变更列表
   - [修改] SKILL.md（+12 −5 行）
   - [新增] references/schema.md
   - [删除] scripts/legacy.md

   ## 变更详情
   ### SKILL.md
   - 关键改动点：...（用 git diff --no-index 对比本地与新版，节选要点）
   - 变更行示例：<少量关键行>
   ```
4. **暂不更新** `files` 的 sha 记录（等用户决定更新后一并更新），但把"待更新文件"标记记录在报告里，避免重复生成相同报告
5. 向用户汇报摘要，询问是否更新

> 注：手动检查时直接运行脚本最省事（见下），脚本输出报告后由 agent 读取并向用户汇报。

### 3. 执行更新（用户确认后）

用户说"更新" / "应用更新" 后：

1. **备份**：把 `local_dir` 下待更新的旧文件复制到 `~/.skill-monitor/backups/<watch-id>/<时间戳>/`
2. **下载新版本**覆盖到 `local_dir`（删除的远端文件：先询问用户再删除本地对应文件）
3. **更新 monitor.json** 中该 watch 的 `files` sha 为最新值
4. 汇报更新结果；如需回滚，指出备份位置即可

## 计划任务自动检查

`scripts/check-updates.sh` 实现自动检查（读取清单 → 网络就绪探测 → API 对比 → 生成摘要报告 → 更新 sha 记录）。注意：**脚本每次运行后直接更新 sha 记录**（它无人值守，无法等用户决策），因此同一文件的更新只报告一次；用户看到报告后如需更新，走上面的"执行更新"流程。

脚本依赖 `jq`、`curl`、`git`；设置了 `GITHUB_TOKEN` 时 API 限速更高（未设置则匿名调用，60 次/小时）。

**配置文件（可手动修改）**：`~/.skill-monitor/monitor.json`

### 注册 systemd 用户定时器（Linux）

```ini
# ~/.config/systemd/user/skill-monitor-check.service
[Unit]
Description=skill-monitor 检查上游更新

[Service]
Type=oneshot
ExecStart=%h/.pi/agent/skills/skill-monitor/scripts/check-updates.sh
```

```ini
# ~/.config/systemd/user/skill-monitor-check.timer
[Unit]
Description=每日检查 skill 更新

[Timer]
OnCalendar=*-*-* 09:00:00
Persistent=true
RandomizedDelaySec=30m

[Install]
WantedBy=timers.target
```

启用与验证：

```bash
systemctl --user daemon-reload
systemctl --user enable --now skill-monitor-check.timer
systemctl --user list-timers skill-monitor-check.timer
journalctl --user -u skill-monitor-check.service -n 20
```

说明：

- **OnCalendar 09:00 + Persistent=true**：每日 09:00 检查；当天机器没开机，则下次启动后补跑一次
- **RandomizedDelaySec 30m**：错开启动时刻，避免与其他定时器同时抢网络
- **脚本内部重试最多 5 分钟**：开机后网络未就绪时自行等待，不必额外加 OnBootSec
- **无需管理员权限**：用户级 timer 即可；若习惯 cron，等价写法是 `0 9 * * * ~/.pi/agent/skills/skill-monitor/scripts/check-updates.sh >>~/.skill-monitor/logs/cron.log 2>&1`

**手动触发**（随时检查一次）：

```bash
~/.pi/agent/skills/skill-monitor/scripts/check-updates.sh
```

或直接在对话中说"检查更新"，agent 代为执行并汇报结果。

## 注意事项

- GitHub API 匿名限速 60 次/小时，每天检查一次足够；监控目录文件较多时注意调用次数（contents API 每层一次调用）
- 优先用 `gh api`（已认证，限速高）；gh 未登录时用 curl 匿名
- `git diff --no-index` 可用于本地与新版文件的差异提取（对比结束记得删除临时文件）
- 所有路径使用 Linux 风格（`~/...` 或 `/home/<user>/...`），脚本与 agent 操作保持一致
- 生成的摘要和汇报一律使用简体中文
- 保持 monitor.json 为唯一事实来源：所有 sha 更新必须同步写回该文件
