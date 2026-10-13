#!/usr/bin/env python3
"""中文标点规范化扫描：只报告待改块，不落盘（改写由你确认后再执行）。

用法：
    python3 punct_scan.py <docs.paths> --db <工作区>/temp/siyuan.db [--limit 12] [--with-adj]

<docs.paths> 每行一个 .sy 路径（取 basename 作为文档 id）。
数据源用 blocks.markdown（**不能用 blocks.content**，它是纯文本，会丢反引号与 HTML 标签）。

防护规则（改坏风险高于收益，一律跳过）：
  · 行内代码 `...`、块引用 ((...))、行内公式 $...$、参数展开 ${...}、HTML 实体 &amp; / &#39;、HTML 实体 &amp; / &#39;
  · ASCII 省略号 ...
  · 半角括号仅在**前面紧跟汉字**时转全角（保住 shell 数组、C 的 (void)）
  · `:` 后不接 `:` 或 `/`（保住 std::vector、路径）
  · `。` 规则排除后跟汉字（保住 对象.属性）
"""
import argparse
import json
import os
import re
import sqlite3
import sys
from collections import Counter

CJK = r"\u4e00-\u9fa5"
PROTECT = re.compile(r"(`+[^`]*`+)|(\(\([^()]*\)\))|(\$\{[^}]*\})|(\$[^$]*\$)|(\.{2,})|(&[a-zA-Z]+;)|(&#\d+;)")

PUNCT = [
    (re.compile(rf"([{CJK}]),"), r"\1，"),
    (re.compile(rf"([{CJK}]);"), r"\1；"),
    (re.compile(rf"([{CJK}]):(?![0-9/:])"), r"\1："),
    (re.compile(rf"([{CJK}])\.(?![0-9A-Za-z一-龥])"), r"\1。"),
    (re.compile(rf",\s*(?=[{CJK}（])"), "，"),
    (re.compile(rf";\s*(?=[{CJK}])"), "；"),
    (re.compile(rf"(?<!:):\s*(?=[{CJK}])"), "："),
    (re.compile(r"\.(?=（)"), "。"),
    (re.compile(r"([）】」』])\s*([,;:.])"),
     lambda m: m.group(1) + {",": "，", ";": "；", ":": "：", ".": "。"}[m.group(2)]),
]
PAREN = re.compile(rf"(?<=[{CJK}])\(([^()]*[{CJK}][^()]*)\)")


def _apply(seg, do_adj):
    for pat, rep in PUNCT:
        seg = pat.sub(rep, seg)
    seg = PAREN.sub(lambda m: "（" + m.group(1) + "）", seg)
    if do_adj:
        seg = re.sub(rf"([{CJK}])([A-Za-z0-9])", r"\1 \2", seg)
        seg = re.sub(rf"([A-Za-z0-9])([{CJK}])", r"\1 \2", seg)
    return seg


def transform(md, do_adj=False):
    out, last = [], 0
    for m in PROTECT.finditer(md):
        out.append(_apply(md[last:m.start()], do_adj))
        out.append(m.group(0))
        last = m.end()
    out.append(_apply(md[last:], do_adj))
    return "".join(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("paths_file", help="每行一个 .sy 路径")
    ap.add_argument("--db", default=os.path.expanduser("~/data/siyuan/temp/siyuan.db"))
    ap.add_argument("--limit", type=int, default=12, help="打印前 N 条样例")
    ap.add_argument("--with-adj", action="store_true", help="同时做中英文间补空格")
    ap.add_argument("--plan-out", help="把改写计划写到该 JSON 文件")
    ap.add_argument("--ignore", help="忽略清单：每行一个块 id（# 后可写理由），命中的块不报也不进计划")
    args = ap.parse_args()

    with open(args.paths_file, encoding="utf-8") as fh:
        ids = [os.path.basename(x.strip())[:-3] for x in fh if x.strip()]
    ignore = set()
    if args.ignore and os.path.exists(args.ignore):
        for line in open(args.ignore, encoding="utf-8"):
            line = line.split("#")[0].strip()
            if line:
                ignore.add(line)
    conn = sqlite3.connect(f"file:{args.db}?mode=ro", uri=True)
    sql = ("SELECT id,root_id,type,markdown FROM blocks WHERE root_id IN (%s) "
           "AND markdown IS NOT NULL" % ",".join("?" * len(ids)))
    changed = []
    for bid, rid, btype, md in conn.execute(sql, ids):
        if btype not in ("p", "h"):          # 只处理段落与标题
            continue
        if bid in ignore:
            continue
        new = transform(md, args.with_adj)
        if new != md:
            changed.append((bid, rid, btype, md, new))
    print(f"待改块数 {len(changed)}  按类型 {Counter(t for _, _, t, _, _ in changed).most_common()}（已忽略 {len(ignore)} 个白名单块）")
    if args.plan_out:
        with open(args.plan_out, "w", encoding="utf-8") as fh:
            json.dump([{"id": b, "new": n} for b, _, _, _, n in changed], fh, ensure_ascii=False)
        print(f"计划已写入 {args.plan_out}")
    for bid, _rid, btype, old, new in changed[:args.limit]:
        print("---", bid, btype)
        print("  OLD:", old[:150].replace("\n", " "))
        print("  NEW:", new[:150].replace("\n", " "))
    return 0


if __name__ == "__main__":
    sys.exit(main())
