#!/usr/bin/env python3
"""思源内核 HTTP API 直连工具：补齐官方 MCP 没有的三个能力。

用法：
    python3 sy_api.py sql "<SELECT ...>"                 # 自动分页取全，输出 JSON
    python3 sy_api.py docs <boxID>                       # 列出文档（id / hpath）
    python3 sy_api.py move --from id1,id2 --to <父文档id> [--yes]     # 批量搬文档
    python3 sy_api.py create --notebook <boxID> --path "/a/b/文档名" [--md "> **要点**：…"] [--yes]
    python3 sy_api.py call <端点> '<json>'   [--yes]      # 兜底：直接调任意内核端点

要点（实测）：
  · 本机免 token（**不要**带 Authorization 头，带错 token 反而 401）；若实例设了访问授权码，用 --token 或 SIYUAN_TOKEN 传入，不落盘
  · `/api/query/sql` 返回 JSON，但**固定 32 行上限**（`limit` 参数无效）→ 本脚本自动按 LIMIT/OFFSET 分页取全
  · `/api/filetree/createDocWithMd` 的 `path` 是**完整路径**，会**自动创建中间父级**（第三方 create_doc 的能力来源；官方 MCP 的 document.create 要求父级已存在）
  · 写操作默认 dry-run，确认后加 --yes
"""
import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request

BASE = os.environ.get("SIYUAN_API", "http://127.0.0.1:6806")


def call(endpoint, payload, token=None, timeout=60):
    req = urllib.request.Request(
        BASE + endpoint,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    if token:
        req.add_header("Authorization", "Token " + token)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        body = json.loads(resp.read().decode("utf-8"))
    if body.get("code") != 0:
        raise RuntimeError(f"{endpoint} 失败: {body.get('msg')}")
    return body


def sql_all(stmt, token=None, page=500):
    """取全：内核 API 在本机默认只回 32 行，但**尊重 SQL 里写的 LIMIT** →
    语句自带 LIMIT 时直接跑（注意仍可能被截到 32 行）；否则按 LIMIT/OFFSET 自动翻页。"""
    base = stmt.rstrip().rstrip(";")
    if re.search(r"\blimit\b", base, re.I):
        rows = call("/api/query/sql", {"stmt": base}, token).get("data") or []
        if len(rows) >= 32:
            print("# 注意：语句自带 LIMIT，内核单次最多 32 行；要取全就去掉 LIMIT 让脚本分页", file=sys.stderr)
        return rows
    rows, offset = [], 0
    while True:
        body = call("/api/query/sql", {"stmt": f"{base} LIMIT {page} OFFSET {offset}"}, token)
        chunk = body.get("data") or []
        rows.extend(chunk)
        if len(chunk) < page:
            return rows
        offset += page


def main():
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--token", default=os.environ.get("SIYUAN_TOKEN"))
    common.add_argument("--yes", action="store_true", help="真正执行写操作（默认只打印）")
    common.add_argument("--out", help="把结果写成 JSON 文件（大清单用，避免刷屏）")

    ap = argparse.ArgumentParser(parents=[common])
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("sql", parents=[common]); p.add_argument("stmt")
    p = sub.add_parser("docs", parents=[common]); p.add_argument("box")
    p = sub.add_parser("move", parents=[common])
    p.add_argument("--from", dest="from_ids", required=True); p.add_argument("--to", required=True)
    p = sub.add_parser("create", parents=[common])
    p.add_argument("--notebook", required=True); p.add_argument("--path", required=True)
    p.add_argument("--md", default="> **要点**：待补充。\n")
    p = sub.add_parser("call", parents=[common]); p.add_argument("endpoint"); p.add_argument("payload")
    args = ap.parse_args()

    if args.cmd == "sql":
        rows = sql_all(args.stmt, args.token)
        if args.out:
            with open(args.out, "w", encoding="utf-8") as fh:
                json.dump(rows, fh, ensure_ascii=False, indent=1)
            print(f"{len(rows)} 行 → {args.out}")
        else:
            print(json.dumps(rows, ensure_ascii=False))
        return 0

    if args.cmd == "docs":
        rows = sql_all(f"SELECT id, hpath FROM blocks WHERE type='d' AND box='{args.box}'", args.token)
        if args.out:
            with open(args.out, "w", encoding="utf-8") as fh:
                json.dump(rows, fh, ensure_ascii=False, indent=1)
            print(f"{len(rows)} 篇 → {args.out}")
        else:
            for r in rows:
                print(f"{r['id']}  {r['hpath']}")
            print(f"# 共 {len(rows)} 篇", file=sys.stderr)
        return 0

    if args.cmd == "move":
        ids = [x.strip() for x in args.from_ids.split(",") if x.strip()]
        if not args.yes:
            print(f"[dry-run] 将搬 {len(ids)} 篇→ 目标 {args.to}: {ids}")
            print("加 --yes 执行")
            return 0
        call("/api/filetree/moveDocsByID", {"fromIDs": ids, "toID": args.to}, args.token)
        print(f"已搬 {len(ids)} 篇 → {args.to}")
        return 0

    if args.cmd == "create":
        if not args.yes:
            print(f"[dry-run] 将在 {args.notebook} 建 {args.path}（中间父级会自动创建）")
            print("加 --yes 执行")
            return 0
        body = call("/api/filetree/createDocWithMd",
                    {"notebook": args.notebook, "path": args.path, "markdown": args.md}, args.token)
        print("已创建:", body.get("data"))
        return 0

    payload = json.loads(args.payload)
    if not args.yes:
        print(f"[dry-run] POST {args.endpoint} {json.dumps(payload, ensure_ascii=False)}（加 --yes 执行）")
        return 0
    print(json.dumps(call(args.endpoint, payload, args.token), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (urllib.error.URLError, RuntimeError) as exc:
        print("错误:", exc, file=sys.stderr)
        sys.exit(1)
