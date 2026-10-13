# 图标速查与盘点

速查参考，非白名单。换图标不必改 `SKILL.md`；选图标前跑一次盘点或直接搜图标库。

## 一、怎么设

`attr {action:"set", id, attrs:{ icon: "1f433" }}`

- 值用 emoji 十六进制 codepoint（`1f433`），多码点用 `-` 连（`1f578-fe0f`），需变体选择符的补 `fe0f`
- 或用**图片文件名**（该文件必须在 `data/emojis/` 下）
- 存放位置：`.sy` 的 `Properties.icon` / `blocks.ial` 的 `icon="…"`（`blocks` 表没有 icon 列）

## 二、盘点（列出实际用量）

```bash
python3 scripts/sy_api.py sql "SELECT hpath, ial FROM blocks WHERE type='d' AND ial LIKE '%icon=%'" --out /tmp/icons.json
python3 - <<'PY'
import json, re, collections
rows = json.load(open('/tmp/icons.json'))
cnt, example = collections.Counter(), {}
for r in rows:
    m = re.search(r'icon="([^"]+)"', r['ial'] or '')
    if m:
        cnt[m.group(1)] += 1
        example.setdefault(m.group(1), r['hpath'])
for icon, n in cnt.most_common():
    print(f"{n:>4}  {icon:<18} {example[icon]}")
PY
```

## 三、从图标库搜图标

```bash
python3 scripts/fetch_icon.py search iconfont "数据库" --limit 8   # 阿里图标库
python3 scripts/fetch_icon.py search cainiao "数据库" --limit 8     # 菜鸟
python3 scripts/fetch_icon.py use iconfont 1305114 --name 数据库 --doc <文档id>
#   → 落盘 data/emojis/iconfont/数据库-1305114-orig.svg 并把该文档 icon 设为文件名
#   --color orig|RRGGBB（默认 orig 保留原色）；不给 --doc 则只下载
```

- 搜索结果缓存在 `/tmp/siyuan-icons/`；缓存丢失时用 `--keyword` 重搜
- 只发查询关键词（匿名请求，不带 cookie/token）；图标版权/许可自行确认
- cainiao 走 HTML 抓取，站点改版即失效；iconfont 走 JSON 接口更稳

## 四、常用图标速查

**挑图标前先查目标目录的已占用**（否则会撞同目录重复，实测连撞 5 次）：

```bash
python3 scripts/sy_api.py sql "SELECT hpath, ial FROM blocks WHERE type='d' AND box='<boxID>' AND hpath LIKE '<目录>/%' AND ial LIKE '%icon=%'"
```

| 主题 | codepoint | 主题 | codepoint | 主题 | codepoint |
| :---: | :--- | :---: | :--- | :---: | :--- |
| 容器 / Docker | `1f433` | 告警 | `1f6a8` | Linux | `1f427` |
| 编排 / Swarm | `1f578-fe0f` | 超时 | `23f3` | 数据库 | `1f5c4-fe0f` |
| 故障 / 崩坏 | `1f4a5` | 排查 / 检索 | `1f50d` | PostgreSQL | `1f418` |
| 复盘 / 时间线 | `23f0` | 网络 / 地球 | `1f310` | 硬件 / 主机 | `1f5a5-fe0f` |
| 孤儿资源 | `1f47b` | CPU / 算法 | `1f9e0` | 统计 / 图表 | `1f4ca` |
| 容量 / 包 / 迁移 | `1f4e6` | 磁盘 IO | `1f4bd` | 并发 / 抢占 | `2694-fe0f` |
| 配额 / 规格 / 列宽 | `1f4cf` | 带宽 / 信号 | `1f4f6` | Git / 变更 | `1f500` |
| 内存 / 计算 / 分析 | `1f9ee` | 指南 / 规范 / 基础 | `1f4d8` | 正则 / 类型 / 拼图 | `1f9e9` |
| 文档 / 书堆 | `1f4da` | 实验 / 测试 / 验证 | `1f9ea` | 表单 / 备忘 / 记录 | `1f4dd` |
| 步骤 / 流程 / 关联 | `1f517` | 循环 / 刷新 / 生命周期 | `1f504` | 配置 / 工具 / 调优 | `1f527` |
| 归档 / 盒子 / 队列 | `1f5c2-fe0f` | 构建 / 打包 | `1f4e6` | 安全 / 锁 / 签名 | `1f512` |
| 网络请求 / 天线的 | `1f4e1` | 完成 / 小结 | `2705` | 目录 / 清单 / 总结 | `1f4c7` |
| 线程 / 切面 | `1f9f5` | 切入点 / 目标 | `1f3af` | 云 | `2601` |
| Kubernetes / 编排 | `2638` | 红书 / 绿书（Redis 系） | `1f4d5` `1f4d7` | 听诊 / 诊断 | `1fa7a` |
| 齿轮 / 引擎 / 底层 | `2699-fe0f` | 盾牌 / 防护 / 哨兵 | `1f6e1-fe0f` | 思维 / 分析 | `1f9e0` |
