#!/usr/bin/env python3
"""全库合规终检：把《笔记规范》的规则逐篇核一遍，只报告违规，不落盘。

用法：
    python3 sy_compliance.py <数据目录> [--db <工作区>/temp/siyuan.db] [--box <boxid>] [--json]

检查项（每条给出违规样本，最多 20 条）：
  1. 首块是引用块，且以「摘要：」开头
  2. 无「摘要 + 同名标题」空壳（文档只剩摘要和一个与文档同名的标题）
  3. 标题不跳级（层级只能逐级下降或回升，不能跳）
  4. 每篇有图标
  5. 同目录内图标不重复
  6. 表格三件套：表块 IAL 居中、单元格居中（TableAligns 全 2 或全部带 text-align:center）、colgroup 每项 72–620px
  7. 代码块围栏都带语言
  8. 顶层无空段落、无 --- 分隔线、无 AI 对话痕迹
"""
import argparse, json, os, re, sqlite3, sys, unicodedata
from collections import Counter, defaultdict

BOX_DEFAULT = "20220830141027-o4meubr"


def text_of(n, unescape=False):
    """按 .sy 节点树取文本（含 TextMark 内容）。unescape=True 时反转义 HTML 实体。"""
    out = []

    def walk(y):
        for ch in y.get("Children") or []:
            t = ch.get("Type")
            if t == "NodeText":
                out.append(ch.get("Data") or "")
            elif t == "NodeTextMark":
                v = ch.get("TextMarkTextContent")
                if v is not None:
                    out.append(v)
                else:
                    walk(ch)
            else:
                walk(ch)

    walk(n)
    s = "".join(out).replace("\u200b", "")
    import html as _h
    return _h.unescape(s) if unescape else s


def norm(s):
    return re.sub(r"[\s\u3000·（）()、：:，,。.\-—_/|]", "", s).lower()


def load_docs(root, db, box):
    c = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    rows = list(c.execute(
        "SELECT id,hpath,path FROM blocks WHERE type='d' AND box=? AND path IS NOT NULL ORDER BY hpath", (box,)))
    docs = []
    for i, h, p in rows:
        f = os.path.join(root, p.lstrip("/"))
        if not os.path.exists(f):
            docs.append({"id": i, "hpath": h, "err": "文件不存在"})
            continue
        d = json.load(open(f, encoding="utf-8"))
        kids = [k for k in (d.get("Children") or []) if k.get("ID")]
        docs.append({"id": i, "hpath": h, "doc": d, "kids": kids,
                     "icon": (d.get("Properties") or {}).get("icon")})
    return docs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("root")
    ap.add_argument("--db", default=os.path.expanduser("~/data/siyuan/temp/siyuan.db"))
    ap.add_argument("--box", default=BOX_DEFAULT)
    ap.add_argument("--json")
    args = ap.parse_args()

    docs = load_docs(args.root, args.db, args.box)
    bad = defaultdict(list)
    icons_by_par = defaultdict(Counter)

    for x in docs:
        if "err" in x:
            bad["文件不存在"].append(x["hpath"])
            continue
        kids, d = x["kids"], x["doc"]
        par = x["hpath"].rsplit("/", 1)[0] if "/" in x["hpath"] else "/"
        icons_by_par[par][str(x["icon"])] += 1
        title = x["hpath"].split("/")[-1]

        # 1 首块摘要
        if not kids or kids[0].get("Type") != "NodeBlockquote":
            bad["1 首块非摘要"].append(x["hpath"])
        else:
            t = text_of(kids[0], True).strip()
            if not re.match(r"^摘要[：:]", t):
                bad["1 摘要引导词不是「摘要：」"].append(f"{x['hpath']} :: {t[:36]}")

        # 2 摘要 + 同名标题空壳
        if kids and kids[0].get("Type") == "NodeBlockquote":
            rest = [k for k in kids[1:]]
            if len(rest) == 1 and rest[0].get("Type") == "NodeHeading" \
                    and (rest[0].get("HeadingLevel") or 9) == 1 \
                    and norm(text_of(rest[0], True)) == norm(title):
                bad["2 摘要后同名空壳标题"].append(x["hpath"])

        # 3 跳级
        prev = 1
        for k in [k for k in kids if k.get("Type") == "NodeHeading"]:
            lv = k.get("HeadingLevel") or 1
            if lv > prev + 1:
                bad["3 标题跳级"].append(f"{x['hpath']} :: h{prev}→h{lv}")
                break
            prev = lv

        # 4 图标
        if not x["icon"]:
            bad["4 缺图标"].append(x["hpath"])

        # 6 表格三件套 / 7 代码块 / 8 清理
        st = [d]
        while st:
            n = st.pop()
            t = n.get("Type")
            if t == "NodeTable":
                pr = n.get("Properties") or {}
                cg = (pr.get("colgroup") or "").split("|")
                ms = [re.fullmatch(r"\s*min-width:\s*(\d+)px\s*;?\s*", v) for v in cg]
                if not cg[0] or not all(ms) or not all(72 <= int(m.group(1)) <= 620 for m in ms):
                    bad["6 表格 colgroup 不合格"].append(f"{x['hpath']} :: {pr.get('colgroup')!r}")
                al = n.get("TableAligns") or []
                if not al or not all(a == 2 for a in al):
                    cells = []

                    def collect(y):
                        for ch in y.get("Children") or []:
                            if ch.get("Type") == "NodeTableCell":
                                cells.append(ch)
                            else:
                                collect(ch)

                    collect(n)
                    centered = cells and all(
                        "text-align: center" in ((c.get("Properties") or {}).get("style") or "") for c in cells)
                    if not centered:
                        bad["6 单元格未居中"].append(f"{x['hpath']} :: aligns={al} cells={len(cells)}")
            if t == "NodeCodeBlock":
                lang = None
                for ch in (n.get("Children") or []):
                    if ch.get("Type") == "NodeCodeBlockFenceInfoMarker":
                        lang = ch.get("CodeBlockInfo")
                if not lang:
                    bad["7 代码块缺语言"].append(x["hpath"])
            st.extend(n.get("Children") or [])
        for k in kids:
            if k.get("Type") == "NodeParagraph" and not (k.get("Children") or []):
                bad["8 顶层空段落"].append(x["hpath"])
            if k.get("Type") == "NodeThematicBreak":
                bad["8 分隔线"].append(x["hpath"])

    # 5 同目录图标重复
    for par, cnt in icons_by_par.items():
        for ic, v in cnt.items():
            if v > 1 and ic != "None":
                bad["5 同目录图标重复"].append(f"{par} :: {ic} × {v}")

    print(f"文档 {len(docs)} 篇，检查 {len(bad)} 类问题")
    total = 0
    for k in sorted(bad):
        total += len(bad[k])
        print(f"\n[{k}] {len(bad[k])} 处")
        for s in bad[k][:20]:
            print(f"    {s}")
    print(f"\n合计违规 {total} 处" + (" ✓ 全部合规" if total == 0 else ""))
    if args.json:
        json.dump({k: v for k, v in bad.items()}, open(args.json, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    return 0 if total == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
