# MCP 操作要求与坑

默认用 MCP。MCP 没有的三个能力（取全量 SQL 为 JSON、批量搬文档、按指定位置建文档）用 `scripts/sy_api.py`（第五节）。

## 一、MCP 工具

- 调用：`POST /mcp`，需 `Authorization` + 管理员角色，`initialize` 后带 `Mcp-Session-Id`（不 initialize 直接 `GET /mcp` 返回 400）
- 工具都是 `{action, …}` 形态；动作清单用 `describeTool("mcp__siyuan_mcp_server__<工具>")` 查
- `sql {action:"query", stmt}`：只读 SELECT；**返回的是查询结果的 markdown 渲染，不是块内容**（读取块内容只能用 `block {action:"get_kramdown"}` 或直接读 `.sy`）；默认最多 100 行，要更多显式 `LIMIT/OFFSET`
- `sql` 索引有秒级延迟 → 写完不要立即断言，隔几秒复查或读 `.sy` 核对
- 建文档：`document.create` **会忽略 `path`**（实测给了 `/a/b/名` 仍落在**根级** `/名`，用 `title` 命名）→ 要按位置建一律用 `sy_api.py create --path "/a/b/名"`（内核 `createDocWithMd` 的 path 是完整路径且自动建中间父级）
- 改标题层级：`block {action:"update", data:"## x"}`（块 ID 不变）
- 补摘要：`block {action:"prepend", parentID: 文档id, data:"> **摘要**：…", dataType:"markdown"}` → 置顶为首块，不产生多余空段落
- 批量读块：`block {action:"batch_kramdown"/"batch_get", ids:"a,b,c"}`（无批量写，写要逐块）
- 块属性（含图标）：`attr {action:"get"/"set"/"batch-get"}`；值给 `null`/空串即删除该属性
- 搜索：`search.asset` 只搜附件内部（PDF/Word/Excel/txt）；`search.getasset(path)` 取单附件全文；`search.semantic` 会外发查询且可能计费 → 默认不用
- 快照与找回：`repo {action:"create", memo}`、`file_rollback`（单文件）、`history {action:"list"/"search"/"rollback"}`；`repo checkout` 整体回滚，慎用
- 数据库：`database {action:"item_add", blockID}` 把已有文档绑定成行；`unused`/`clean` 清理未引用库

## 二、文档树与删除

判子文档只能用 `hpath` 前缀（`blocks.parent_id` 对「文档」无效，用它会恒返回空）：

1. 直接子级 `hpath LIKE '<目录>/%' AND hpath NOT LIKE '<目录>/%/%'`；整条子树 `hpath LIKE '<目录>/%'`
2. **绝不自动删目录**：删父文档会连子树一起删；删目录必须是独立的人工确认步骤，删前打印 `hpath LIKE '<目录>/%'` 计数并核对
3. 搬移只移不删，源目录留原地最后统一清理

**误删恢复**：`history list op=delete` 分页不可靠 → 直接读工作区 `history/<批次>-delete/**/*.sy`；回滚 `history {action:"rollback", path:"/history/<批次>-delete/…"}`（路径必须完整，少一段日期前缀就 404）；回滚后若原父目录不存在，文档落到根级 → 从历史路径倒数第二段反推原父级 id 再搬回。`history search` 按标题匹配（不是 id）。

## 三、读 `.sy` 与块级写

- 段落/标题的 `Data` 是空串，正文在子节点 `NodeText.Data` 与 `NodeTextMark.TextMarkTextContent`
- 代码块正文在 `NodeCodeBlockCode.Data`，语言在 `NodeCodeBlockFenceInfoMarker.CodeBlockInfo`（base64）
- 抽取文本必须同时收 4 类：`NodeText.Data`、`NodeBackslashContent.Data`、`NodeKramdownSpanIAL.Data`（与 `NodeTableCell` 平级）、任意节点的 `TextMarkTextContent`
- `.sy` 是扁平兄弟结构：移动标题不带内容块 → 「标题 + 内容块逐个搬」
- `block {action:"move"}` 必须给 `parentID` + `previousID`（`previousID` = 目标位置前一个仍存在的块）；**不要用 `nextID`**
- 跨文档移动保留块 ID（`refs` 不受影响）
- 改标题层级用 `block {action:"update"}`；改成普通文本则原地变段落（可留互见句）
- 恢复被删标题：从 `backup/*.sy` 按 ID 反推「前一个仍存在的块」，`block {action:"insert", previousID}` 重建（ID 会变）
- 只做块级定向更新，不整篇覆盖（整篇更新会重建所有块 ID）
- 每步回读，不要只看返回 `ok`
- `.sy` 深层嵌套会爆栈（`RecursionError`）→ 用显式栈迭代

## 四、写入与字段的坑

| 坑 | 要求 |
| :--- | :--- |
| **删到 0 块会被补回** | 删掉文档最后一个块后，内核立刻用**新 id** 补一个空段落 → 想清空首块空段落，**先 prepend 摘要、再删空段落**（否则白删一次） |
| `blocks.content` 是纯文本 | 不能当改写源（压平行内代码、吞 `<jsp:...>`）→ 改内容用 `blocks.markdown` 或 `block {action:"get_kramdown"}` |
| **`block.update` 传文档 id 会整篇覆盖** | `id` 必须是**块 id**。传文档 id 会把整篇文档替换成那一块的内容（实测 140 块 → 1 块）→ 改摘要/首块前先取**首块的块 id**（读 `.sy` 或 `block {action:"get_children"}`）；取错后立即用 `history {action:"rollback", path:"/history/<批次>/…/<docid>.sy"}` 回滚整篇 |
| 表格对齐改不了 | `TableAligns` 无法通过 MCP 设置。普通表用单元格行内 IAL（**IAL 在内容之前**：`\|{: style="text-align: center;"}内容\|`）；**含合并单元格的表用 `dataType:"dom"` 往返**（`block {action:"dom"}` → 给 `<td>/<th>` 加 style → `update` 时 `dataType:"dom"` + `lockType:true`）；改对齐时必须逐格与改写前比对 |
| 用 markdown 写回 HTML 表格 | 会被解析成**段落**，表格消失 → 表格类内容写回一律带 `lockType:true`（块类型不一致就拒绝） |
| `blocks.sort` 不代表块顺序 | 判「首块」只能读 `.sy`；`blocks.attributes` 常为 NULL 或被掩码 → 属性用 `attr.get` 或读 `.sy` |
| 代码块语言只存在 `.sy` | `ial LIKE '%language-%'` 恒为 0 → 用 `block {action:"update", dataType:"markdown", data:"```lang\n<原代码>\n```"}` 改；安全判据「块 markdown 里以 ``` 开头的行数 == 2」（含自带围栏时不可重写；4 反引号会被降回 3 并给内层插 `U+200D`）；`~~~` 围栏同样存在 |
| `$...$` 会被当行内公式 | `.sy` 出现 `TextMarkType=inline-math` 即 `$` 已丢 → 含 `$` 的内容放进围栏代码块写，写完回读 `.sy` |
| 列表项不能直改 | 改列表项报 `invalid block structure: NodeList [...] cannot contain NodeParagraph [...]`；**更坑的是 `get_children` 返回的是列表项 id（`[i]`），直接 `block.update` 它不报错但静默无效**（实测规范改了两次都没落地，回读 `.sy` 才发现）→ 必须取它内部的**段落块 id** 再改，改完读 `.sy` 核对 |
| 含数据库块（`NodeAttributeView`）的文档 | 不整篇覆盖（会删掉数据库）→ 块级定向改动 + 回读 |
| 文档至少保留一个块 | 删到最后一个空段落会被内核用新 id 补回 → 判定靠「删后复查」 |
| `---` 分隔线 | 按 `type='tb'` 查（`content='---'` 恒为 0） |
| 空段落 | 按 `type='p' AND (content='' OR content IS NULL)` 查，但 `content=''` ≠ 真空（可能含图片/公式/零宽文本）→ 删前必须看 `.sy` 子节点类型 |
| 判「已有摘要」 | 只能读 `.sy` 首块类型；首段 `**摘要**` 落在 `TextMarkTextContent` 而非 `NodeText.Data` |
| 删文档 | `document {action:"delete", id}`；**不要用 `block {action:"delete"}`**（那是删块，对文档无效且不报错，实测删了 6 个空目录全部 "成功" 但目录仍在）；文档带 `custom-avs` 时会连数据库行一起删 → 删前抄录字段值 |
| 改名与建文档 | 改名用官方 `document {action:"rename", id, title}`（内核 `filetree/renameDoc` 必给 `notebook`，少会报 `Field [notebook] is required`）；改名会剔除半角 `/`（改用 `vs`/`／`/`·`）、`~` 需写 `\~`，先做「同父同名」预检；建文档名含半角 `/` 会建出嵌套文档 |
| 拍平目录时要连带换图标 | 子文档上移一级后，新父目录里往往已有同 codepoint 的兄弟（实测连撞 5 次）→ 移动后立即跑一次 `sy_compliance.py` 查同目录重复 |
| 双链 | `[[标题]]` 是纯文本；真双链写 `((id "锚文本"))`，用 `refs` 表验证 |
| 筛「无中文标题」 | 用 `content NOT GLOB '*[一-龥]*'`（ASCII 白名单会漏 `C++11`、`&Future`） |
| 大批量 id | 不用 `put_file` 转存（只允许上传白名单目录，且可能 ENOENT）→ 脚本内用 SQL/`.sy` 自推导清单，写成幂等（每轮重新推导 + 跳过已完成） |
| 备份脚本 | 必须纯只读（会写文件的辅助函数会把备份覆盖成当前内容）；校验脚本不落盘 |
| 陈旧副本 | `<workspace>/data/data/` 下有陈旧嵌套副本，`find` 会误报「已删文档还在」；活树是 `<workspace>/data/<notebook>` |
| `tools.bash` 输出 | 超过 50 KB 会截断 → 大清单拆成 < 20 KB 分片或加 `--out` 落盘 |

## 五、内核 API 脚本（MCP 没有的能力）

`scripts/sy_api.py`：直连 `http://127.0.0.1:6806`，本机免 token（不要带 `Authorization` 头，带错反而 401）；设了访问授权码时用 `--token`/`SIYUAN_TOKEN`，不落盘。

| 子命令 | 用途 | 要点 |
| :--- | :--- | :--- |
| `sql "<SELECT>" [--out f.json]` | 取全量清单（JSON） | 内核 `/api/query/sql` 单次 32 行（`limit` 参数无效）→ 脚本按 LIMIT/OFFSET 自动翻页；语句自带 `LIMIT` 时不再分页 |
| `docs <boxID> [--out f.json]` | 列文档（id + hpath） | 同上 |
| `move --from id1,id2 --to <父文档id> [--yes]` | 批量搬文档 | 官方 `document.move` 只能单个 |
| `create --notebook <boxID> --path "/a/b/文档名" [--yes]` | 按完整路径建文档 | `path` 是完整路径且自动创建中间父级；**不要拿不存在的路径做测试**，会真建出父级 |
| `call <端点> '<json>' [--yes]` | 调任意内核端点 | 写操作默认 dry-run，确认后加 `--yes` |
