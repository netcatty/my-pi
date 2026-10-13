#!/usr/bin/env python3
"""思源文档格式审计：直接读 .sy 文件，绕开 SQL 列掩码。

用法：
    python3 sy_audit.py <data目录> <文档路径…>
    python3 sy_audit.py <data目录> --paths-file paths.txt

data目录 = <工作区>/data/<notebookID>；文档路径 = 相对该目录的 .sy 路径（形如 /技术/数据/x.sy）
输出每篇一行 + 末行「合计」。`H4+` 列只是统计更深层级（允许存在，不是错误）。判据：**H1 列必须 = 1**（每篇正文都得有 `# 文档标题`，
摘要之后；分类父文档同理）、`code_nolang` 0、`cg_bad` / `center_bad` 0、`首块` 列 = `Blockquote`。
`align_bad`：TableAligns 全 2 或全部单元格带行内 IAL 居中；合并单元格表可豁免。
"""
import json
import os
import re
import sys

COLS = [
    ("文档", 30), ("表", 4), ("对齐✗", 6), ("列宽✗", 6), ("居中✗", 6), ("码", 6),
    ("无语言", 7), ("H4+", 6), ("H1", 4), ("H2", 4), ("H3", 4), ("首块", 8),
    ("图标", 5), ("空段", 5), ("分隔", 5), ("AI", 4),
]


def audit(path):
    with open(path, encoding="utf-8") as fh:
        doc = json.load(fh)
    st = dict(tbl=0, cg_bad=0, align_bad=0, center_bad=0, code=0, code_nolang=0, deeph=0,
              h1=0, h2=0, h3=0, icon=1 if (doc.get("Properties") or {}).get("icon") else 0,
              sep=0, empty=0, ai=0, img=0, av=0)
    title = (doc.get("Properties") or {}).get("title", "?")

    def walk(n):
        t = n.get("Type")
        if t == "NodeTable":
            st["tbl"] += 1
            # 单元格居中：TableAligns 全 2，或所有单元格带行内 IAL text-align: center
            if not all(a == 2 for a in (n.get("TableAligns") or [])):
                cells = []

                def collect_cells(x):
                    for ch in x.get("Children") or []:
                        if ch.get("Type") == "NodeTableCell":
                            cells.append(ch)
                        else:
                            collect_cells(ch)

                collect_cells(n)
                centered = cells and all(
                    "text-align: center" in ((c.get("Properties") or {}).get("style") or "")
                    for c in cells)
                if not centered:
                    st["align_bad"] += 1
            colgroup = ((n.get("Properties") or {}).get("colgroup") or "").split("|")
            hits = [re.fullmatch(r"\s*min-width:\s*(\d+)px\s*;?\s*", x) for x in colgroup]
            if not (colgroup[0] and all(hits) and all(72 <= int(m.group(1)) <= 620 for m in hits)):
                st["cg_bad"] += 1
            if "text-align: center" not in ((n.get("Properties") or {}).get("style") or ""):
                st["center_bad"] += 1
        if t == "NodeCodeBlock":
            st["code"] += 1
            info = ""
            for child in n.get("Children") or []:
                if child.get("Type") == "NodeCodeBlockFenceInfoMarker":
                    info = child.get("CodeBlockInfo") or ""
            if not info:
                st["code_nolang"] += 1
        if t == "NodeHeading":
            lv = n.get("HeadingLevel") or 0
            st["h1" if lv == 1 else "h2" if lv == 2 else "h3" if lv == 3 else "deeph"] += 1
        if t == "NodeThematicBreak":
            st["sep"] += 1
        if t == "NodeParagraph" and not (n.get("Children") or []):
            st["empty"] += 1
        if t == "NodeImage":
            st["img"] += 1
        if t == "NodeAttributeView":
            st["av"] += 1
        if t == "NodeText" and re.search("🧑‍💻|🤖", n.get("Data") or ""):
            st["ai"] += 1
        for child in n.get("Children") or []:
            walk(child)

    kids = doc.get("Children") or []
    children = kids[0] if kids else {}
    st["first"] = children.get("Type") or ""
    for child in kids:
        walk(child)
    return title, st


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        return 2
    root = sys.argv[1]
    if sys.argv[2] == "--paths-file":
        with open(sys.argv[3], encoding="utf-8") as fh:
            paths = [line.strip() for line in fh if line.strip()]
    else:
        paths = sys.argv[2:]
    rows = []
    for rel in paths:
        # 注意：DB 的 path 列形如 /a/b/c.sy，看着像绝对路径但其实相对笔记本根目录 →
        # 不能用 os.path.isabs 判断，只能“先看原路径存不存在，不存在再拼根目录”
        path = rel if os.path.exists(rel) else os.path.join(root, rel.lstrip("/"))
        if not os.path.exists(path):
            print(f"!! 找不到 {path}")
            continue
        rows.append(audit(path))
    if not rows:
        print("没有可审计的文档")
        return 1
    print("".join(f"{name:>{width}}" for name, width in COLS))
    for title, st in rows:
        print(f"{title[:28]:<30}{st['tbl']:>4}{st['align_bad']:>6}{st['cg_bad']:>6}{st['center_bad']:>6}"
              f"{st['code']:>6}{st['code_nolang']:>7}{st['deeph']:>6}{st['h1']:>4}{st['h2']:>4}{st['h3']:>4}"
              f"{st['first'].replace('Node', ''):>8}{st['icon']:>5}{st['empty']:>5}{st['sep']:>5}{st['ai']:>4}")
    keys = [k for k in rows[0][1] if k != "first"]
    print("合计:", {k: sum(st[k] for _, st in rows) for k in keys})
    return 0


if __name__ == "__main__":
    sys.exit(main())
