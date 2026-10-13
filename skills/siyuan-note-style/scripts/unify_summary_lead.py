#!/usr/bin/env python3
"""把全库首块摘要的引导词（要点/结论/背景）统一改成「摘要」。

用法:
  python3 unify_summary_lead.py --dry-run
  python3 unify_summary_lead.py            # 实跑
  python3 unify_summary_lead.py --doc <docid>   # 只跑一篇（测试）
"""
import argparse, json, os, re, sqlite3, sys, urllib.request
import concurrent.futures as cf

API = "http://127.0.0.1:6806/api/"
ROOT = os.path.expanduser("~/data/siyuan/data/20220830141027-o4meubr")
DB = os.path.expanduser("~/data/siyuan/temp/siyuan.db")
LEADS = ("要点", "结论", "背景", "摘要")


def post(path, payload):
    req = urllib.request.Request(API + path, data=json.dumps(payload).encode("utf-8"),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def leading_strong(n):
    """返回 (strong 文本, 摘录前 40 字)；首块内按顺序找第一个 strong 标记。"""
    found = []
    txt = []

    def walk(y):
        for ch in y.get("Children") or []:
            t = ch.get("Type")
            if t == "NodeTextMark" and ch.get("TextMarkType") == "strong" and not found:
                found.append(ch.get("TextMarkTextContent") or "")
            if t == "NodeText":
                txt.append(ch.get("Data") or "")
            elif t == "NodeTextMark":
                v = ch.get("TextMarkTextContent")
                if v is not None:
                    txt.append(v)
                else:
                    walk(ch)
            else:
                walk(ch)

    walk(n)
    return (found[0] if found else None), "".join(txt).replace("\u200b", "")[:40]


def build_plan(only_doc=None):
    c = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    q = "SELECT id,hpath,path FROM blocks WHERE type='d' AND box='20220830141027-o4meubr' AND path IS NOT NULL"
    rows = list(c.execute(q))
    plan = []
    for i, h, p in rows:
        if only_doc and i != only_doc:
            continue
        d = json.load(open(os.path.join(ROOT, p.lstrip("/")), encoding="utf-8"))
        ks = [k for k in (d.get("Children") or []) if k.get("ID")]
        if not ks or ks[0].get("Type") != "NodeBlockquote":
            continue
        lead, head = leading_strong(ks[0])
        if lead in ("要点", "结论", "背景"):
            plan.append({"doc": i, "hpath": h, "sum": ks[0]["ID"], "old": lead, "head": head})
    return plan


def convert(item):
    try:
        dom = post("block/getBlockDOM", {"id": item["sum"]})["data"]["dom"]
    except Exception as e:
        return item["hpath"], f"取 DOM 失败 {e}"
    m = re.search(r'<span data-type="strong">(' + "|".join(LEADS) + r')</span>', dom)
    if not m:
        return item["hpath"], "未找到 strong 标记"
    if m.group(1) == "摘要":
        return None, None
    new = dom[:m.start(1)] + "摘要" + dom[m.end(1):]
    try:
        r = post("block/updateBlock", {"id": item["sum"], "dataType": "dom", "data": new})
        if r.get("code") != 0:
            return item["hpath"], f"update 返回 {r.get('msg') or r.get('code')}"
    except Exception as e:
        return item["hpath"], f"update 异常 {e}"
    return None, None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--doc")
    ap.add_argument("--workers", type=int, default=10)
    ap.add_argument("--out", default="summary-lead-before.json", help="改前计划落盘路径（默认当前目录）")
    args = ap.parse_args()

    plan = build_plan(args.doc)
    from collections import Counter
    print(f"待改 {len(plan)} 篇  引导词分布: {dict(Counter(x['old'] for x in plan))}")
    if args.dry_run:
        for x in plan[:5]:
            print(f"   {x['hpath']}  [{x['old']}] {x['head']}")
        return
    json.dump(plan, open(args.out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    ok = fails = 0
    errs = []
    with cf.ThreadPoolExecutor(args.workers) as ex:
        for road, err in ex.map(convert, plan):
            if err:
                fails += 1
                errs.append((road, err))
            else:
                ok += 1
    print(f"完成 {ok}/{len(plan)}；失败 {fails}")
    for r, e in errs[:10]:
        print(f"   ✗ {r}  {e}")


if __name__ == "__main__":
    main()
