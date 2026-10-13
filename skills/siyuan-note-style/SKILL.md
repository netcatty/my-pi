---
name: siyuan-note-style
description: 思源笔记（SiYuan）排版规范与 MCP 操作要求。写或修改单篇文档用本文；批量整理整个库（去重、标点、拆分、对账）读 references/cleanup.md；MCP 报错或工具行为异常读 references/mcp-pitfalls.md。
---

# 思源笔记排版规范

> 库内 `/笔记规范` 是同一套规则的**说明版**（给人看）；本文是**执行口径**（给 agent 用）。两处重叠的条要同步改，改完读 `.sy` 核对（`block.update` 传错 id 会静默无效）。

| 你要做 | 读 |
| :--- | :--- |
| 写新笔记、改单篇文档 | 本文 |
| 全库终检（8 类规则一把跑完） | `scripts/sy_compliance.py` |
| 定期巡检（合规 + 标点，可接 cron） | `scripts/sy_patrol.sh` |
| 批量整理整个库 | `references/cleanup.md` |
| 旧库标题口径转换（删 `# 文档标题`） | `scripts/flatten_headings.py` |
| 旧库摘要引导词统一（→ `**摘要**`） | `scripts/unify_summary_lead.py` |
| MCP 报错、工具行为怪 | `references/mcp-pitfalls.md` |
| 跑格式审计 / 标点扫描 | `scripts/sy_audit.py`、`scripts/punct_scan.py` |
| 算表格列宽 | `scripts/colwidth.mjs` |
| 从图标库挑图标并落到本地 | `scripts/fetch_icon.py` |
| 取全量清单 / 批量搬文档 / 建多级路径文档 | `scripts/sy_api.py`（内核 API，MCP 没这三个能力） |

## 一、必须做

1. **标题**：正文**不写 `# 文档标题`**（文档名已由文档树/面包屑显示）；首块是摘要引用块（`> **摘要**：…`），其后章节从 `#` 起：`# 章节` → `## 子节` → `###`…；层级不限深浅，但**不跳级**；不写序号（`1.`、`一、`、`第X章`）；名词短语、去末尾冒号；不写与文档标题同名的重复标题
2. **摘要**：首个内容块 `> **摘要**：…`，1-3 句讲结论与适用场景；引导词**统一写 `**摘要**`**（旧的 `要点`/`结论`/`背景` 三词已废）
   - **分类父文档**的摘要写「本类收什么 / 不收什么」；「不收什么」**点名该去哪**（如「不含部署实施（见「环境与部署」）」）—— 这就是跨目录导航
3. **表格**：三件套齐全（见二）
4. **图标**：每篇都要（含分类父文档），同目录不重复
5. **代码块**：围栏必带语言（终端输出、配置样例用 `text`）；同一语言只留一种写法（`C++`/`c++`/`CPP` → `cpp`，`yml` → `yaml`）
6. **命名**：去序号（不写 `01-01-01`）；主题词中文化；`MarkDown` → `Markdown`，`JVM虚拟机` → `JVM`；
   **中英文之间留空格**（`HTTP 基础`、`ArchLinux 配置 IP`）；**英文缩写用官方大小写**（`HTTP`/`SQL`/`JSON`/`MyBatis`/`HTTPS`，不写 `Http基础`、`SQL语句`）
7. **目录**：单目录 ≤ 25 条；**目录层级 ≤ 6 层**（再深靠「分类父文档 + 子文档」承担）；**纯转接层拍平**（中间目录只有 1 个子文档时把子文档上移一级），**主题目录即使暂只 1 篇也保留**
8. **清理**：删 AI 对话痕迹（`🧑‍💻 User`、`🤖 Assistant`）、重复段落、`---` 分隔线、真空段落；中英文与数字间加空格；改错别字；**禁用长破折号**（两横连写的中文破折号 → 用逗号/冒号/分句）
9. **资源**：引用写 `assets/...`（不带前导斜杠）；文件名不带空格（`%20` 会断图）；新资源进 `assets/<文档ID>/`
10. **标签**：只用两类 —— 横跨多个目录的横切概念、临时标记（`#待处置`）；不打主题名（`#Java` 在 `/技术/语言/Java` 下就是双份记账）；当前全库只有 `#面试` 一个

## 二、不要做

- 不改技术内容：命令、SQL、代码、数值、IP、端口、版本号、函数名、报错原文原样保留
- 不给标题加序号；不留裸代码围栏；不漏图标
- 不只居中表块就收工——列对齐与列宽是另外两件事
- 列宽用 `min-width`，不用 `width`，不用百分比
- 不以「工具返回 ok」代替回读验证
- 写了会坏的宁可留下并记录，不要强改：合并单元格表、含 `$` 的标题、列数不匹配的表、父块唯一子节点
- 空壳标题（标题下无内容、紧跟同级标题）：**分组型**（子节名从属它）把子节降一级；**漏写型**（后续同级节与它并列）不动。不删、不升（删丢归属，升会把后续同级全收编）
- 摘要里不出现 `$`（写入会被当公式吃掉），也不出现与文档名相同的重复标题

## 三、表格

| 三件套 | 位置 | 值 |
| :--- | :--- | :--- |
| 表块居中 | 表块 IAL | `style="text-align: center"` |
| 单元格居中 | 表块 JSON `TableAligns`（每列 `2`：`0`默认 / `1`左 / `2`居中 / `3`右）**或**逐单元格行内 IAL | `TableAligns` **无法通过 MCP 设置** → 实际用行内 IAL |
| 列宽下限 | 表块 IAL `colgroup` | `min-width: Npx`，72 ≤ N ≤ 620，`\|` 分隔 |

```markdown
|查询字段|返回值|实际含义|
| :---: | :---: | :---: |
|`HostConfig.Memory`|`1073741824`|1 GiB = 1024 × 1048576 B|
{: colgroup="min-width: 219px|min-width: 126px|min-width: 235px" style="text-align: center"}
```

- 分隔行每列写 `:---:`；IAL 写完整 CSS 声明（`min-width: 219px`，不是 `219px`）
- **新表写 `\| :---: \|` 就自带了单元格居中**：思源会把分隔行的冒号位置写进**单元格 IAL**（`:---` → `text-align: left`、`:---:` → `center`、`---:` → `right`），**但不设 `TableAligns`**；写成了 `:---` 左对齐再改就麻烦（要逐格改 IAL）
- 列宽只用 `min-width`，不用 `width`、不用百分比，封顶 620px
- 合格判据：colgroup 拆 `|` 后每项都是 `min-width: Npx` 形式（N 为数字）且 72 ≤ N ≤ 620；不能用 `ial LIKE '%min-width%'` 判（漏 `width:`、<72px、混用、空项）
- **列值越界（<72px）只需 `attr.set` 改 `colgroup`**，不碰表格内容

### 单元格居中（`TableAligns` 改不了，用行内 IAL）

- 写法：**IAL 在单元格内容之前** —— `|{: style="text-align: center;"}内容|`（不是贴在内容后面）
- **不要用 `block.update` 重写整表来改对齐**：重写后 `TableAligns` 归 0，且写 `:---:` 分隔行也恢复不了
- 批量做法：`block {action:"get_kramdown"}` 取完整表格 kramdown（含单元格 IAL 与表格 IAL）→ 对尚无 IAL 的单元格前插 `{: style="text-align: center;"}` → `block {action:"update"}` 写回 → **逐格与改写前比对**（零宽字符差异属正常）
- 已有单元格 IAL 的跳过（不覆盖原有 style）；`get_kramdown` 的末行是表格 IAL（`{: id=… style=… colgroup=…}`），保持原样

### 列宽算法

用 `scripts/colwidth.mjs`（读 markdown 表格，输出可直接粘的 colgroup IAL）：

```bash
node scripts/colwidth.mjs table.md        # → {: colgroup="min-width: …|…" style="text-align: center"}
node scripts/colwidth.mjs --json table.md # → [219,126,235]
```

### 两类例外表

| 类型 | 识别 | 处理 |
| :---: | :--- | :--- |
| 合并单元格表 | kramdown 返回 HTML `<table>`（含 `colspan`/`rowspan`） | 列宽按 DOM 数 `colspan` 推列号；**居中用 dom 往返**（见下） |
| 单元格含裸 `\|` | kramdown 是管道表，但某行单元格数 ≠ 表头数 | 按 DOM 真实列数写 `colgroup`，不重写分隔行 |

**合并单元格表的单元格居中（dom 往返）**：

```text
block {action:"dom", id}                                  → 取块 DOM（含 data-type="NodeTable" 与完整合并结构）
  给每个 <td>/<th> 加 style="text-align: center"
block {action:"update", id, data: <补好的 DOM>, dataType:"dom", lockType:true}
```

- **必须用 `dataType:"dom"`**：把 HTML 表格当 `markdown` 写回会被解析成**段落**，表格就没了
- **必须加 `lockType:true`**：解析出的块类型与现有不一致时拒绝更新，防上述事故
- 实测效果：单元格全部带上 style、合并结构（colspan/rowspan）与 colgroup 逐格一致
- 判断列数以 `.sy` DOM 为准（数 `<td>` 的 colspan），不信 kramdown 管道数

### 批量改造

```text
SELECT id, markdown FROM blocks WHERE root_id='<docID>' AND type='t'   -- 官方 sql 有秒级索引延迟，改完隔几秒复查
  → 用 blocks.markdown 算列宽（不必逐块 get_kramdown）
  → attr {action:"set", id, attrs:{ colgroup: "min-width: …|min-width: …", style: "text-align: center" }}
  → **不要**用 block {action:"update"} 重写整表（会把 TableAligns 归 0）；单元格居中另见上节
  → 读 .sy 核验 colgroup 与 TableAligns
```

## 四、图标

- 每篇文档都要（含分类父文档）；同目录不重复（跨目录可）；优先一眼看懂的具象物
- 设置：`attr {action:"set", id, attrs:{ icon: "1f433" }}`；值是 emoji 的十六进制 codepoint（多码点用 `-` 连，需变体选择符的补 `fe0f`），**也可以是图片文件名**
- **优先用 codepoint**：图片文件名依赖 `data/emojis/` 下的文件，删该目录即全部失效；思源内置动态图标（`api/icon/getDynamicIcon?…`）不受影响
- 存在 `.sy` 的 `Properties.icon` / `blocks.ial`；`blocks` 表**没有** icon 列 → 盘点用 `ial LIKE '%icon=%'`，并筛出非 codepoint 的（`icon="…png"` 等）提前发现失效风险
- 文档树根文档（id = boxID、带 `custom-hidden="true"`）也在 `type='d'` 统计内
- 常用图标速查与盘点命令、从图标库挑图标（`scripts/fetch_icon.py`）：`references/icons.md`

## 五、跨平台（Windows）

脚本本体跨平台（Python 3 + Node，路径一律走 `os.path.expanduser`，无硬编码家目录）。只有三处平台差异：

| 项 | Linux / macOS | Windows |
| :--- | :--- | :--- |
| 定期巡检 | `crontab -e` 加一行 | **任务计划程序**（`taskschd.msc`）→ 新建基本任务 → 每周一 9:05 → 程序填 Git 的 `bash.exe`，参数填「脚本路径 + 数据目录」 |
| 跑 `sy_patrol.sh` | 直接 `bash sy_patrol.sh <数据目录>` | 需 **Git Bash**（随 Git 安装）或 WSL；其余脚本（`.py` / `.mjs`）直接 `python3` / `node` 跑 |
| 思源工作区路径 | 默认 `~/data/siyuan/…` | 路径不同 → 用 `--db <你的路径>` 或 `SIYUAN_DB` 环境变量显式指定，别依赖默认值 |

`.sh` 的可执行位在 Windows 上无意义（git 忽略），不影响使用。
