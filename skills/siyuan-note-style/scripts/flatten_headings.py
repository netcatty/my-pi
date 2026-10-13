#!/usr/bin/env python3
"""把「正文首块 # 文档标题 + ## 章节」的文档压平成「无文档标题 + # 章节」。

用法:
  python3 flatten_headings.py --plan /tmp/h1-flatten-plan.json --dry-run
  python3 flatten_headings.py --plan /tmp/h1-flatten-plan.json --limit 3
  python3 flatten_headings.py --plan /tmp/h1-flatten-plan.json

每篇: 删掉 h1（文本 == 文档标题）→ 其余标题层级 -1（kramdown 改前缀，文本原样）。
"""
import argparse, json, os, re, sqlite3, sys, urllib.request
import concurrent.futures as cf

API = "http://127.0.0.1:6806/api/"


def post(path, payload):
    req = urllib.request.Request(
        API + path,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def kramdown(bid):
    return post("block/getBlockKramdown", {"id": bid})["data"]["kramdown"]


def new_kramdown(bid, level):
    """把 `## x` 改成 `# x`（只动前缀，其余原样）。"""
    kd = kramdown(bid)
    m = re.match(r"^(#{1,6})\s+(.*)$", kd, re.S)
    if not m:
        raise RuntimeError(f"非标题 kramdown: {kd[:40]!r}")
    return "#" * (level - 1) + " " + m.group(2)


def handle(doc):
    """返回 (删除的 h1 数, 降级的标题数, 失败列表)"""
    fails = []
    n_del = n_lv = 0
    try:
        post("block/deleteBlock", {"id": doc["h1"]})
        n_del = 1
    except Exception as e:
        fails.append(("del", doc["h1"], str(e)[:80]))
    for tid, lv in doc["titles"]:
        for attempt in (0, 1):
            try:
                data = new_kramdown(tid, lv)
                post("block/updateBlock", {"id": tid, "dataType": "markdown", "data": data})
                n_lv += 1
                break
            except Exception as e:
                if attempt:
                    fails.append((f"lv{lv}", tid, str(e)[:80]))
    return n_del, n_lv, fails


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--plan", required=True)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    plan = json.load(open(args.plan, encoding="utf-8"))
    if args.limit:
        plan = plan[: args.limit]
    titles = sum(len(d["titles"]) for d in plan)
    print(f"待处理 {len(plan)} 篇 / 删 h1 {len(plan)} 个 / 降级标题 {titles} 个")
    if args.dry_run:
        for d in plan[:5]:
            print(f"   {d['hpath']}  标题 {len(d['titles'])} 个")
        return

    del_ok = lv_ok = 0
    all_fails = []
    done = 0
    with cf.ThreadPoolExecutor(args.workers) as ex:
        futs = {ex.submit(handle, d): d for d in plan}
        for f in cf.as_completed(futs):
            d_ok, l_ok, fails = f.result()
            del_ok += d_ok
            lv_ok += l_ok
            all_fails.extend(fails)
            done += 1
            if done % 100 == 0:
                print(f"   … {done}/{len(plan)} 篇，标题已改 {lv_ok} 个", flush=True)
    print(f"\n删除 h1 {del_ok}/{len(plan)} | 降级标题 {lv_ok}/{titles}")
    if all_fails:
        print(f"失败 {len(all_fails)} 项:")
        for kind, bid, err in all_fails[:15]:
            print(f"   [{kind}] {bid}  {err}")
        json.dump(all_fails, open("/tmp/flatten-fails.json", "w"), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
