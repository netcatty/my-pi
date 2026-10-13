#!/usr/bin/env python3
"""从图标库挑图标 → 落到 data/emojis/ → 设为文档图标（参考 siyuan-plugin-emoji-market 的实现）。

用法：
    python3 fetch_icon.py search iconfont "数据库" [--limit 20]
    python3 fetch_icon.py search cainiao "数据库" [--limit 20]
    python3 fetch_icon.py use iconfont <id> [--name 文件名主干] [--color orig|RRGGBB] [--doc <文档id>]

要点：
  · 数据源：iconfont 走公开接口 POST /api/icon/search.json；cainiao 抓 https://icon.sucai999.com/s-<kw>-1.html（HTML 内联 svg）
  · 外发内容：仅**查询关键词**（匿名请求，不带任何 cookie/token）。库站点的图标版权/许可由使用者自行确认
  · 落盘：走内核接口 POST /api/file/putFile → `/data/emojis/<source>/<名>-<id>-<colorKey>.svg`（与插件同规则）
  · 设为图标：`attr {action:"set", id, attrs:{icon:"<文件名>"}}`；`--doc` 不给则只下载
  · search 结果缓存在 /tmp/siyuan-icons/，`use` 直接取缓存（避免二次请求）
"""
import argparse
import json
import os
import re
import sys
import urllib.parse
import urllib.request
import uuid

BASE = os.environ.get("SIYUAN_API", "http://127.0.0.1:6806")
CACHE_DIR = "/tmp/siyuan-icons"
UA = "Mozilla/5.0"
SOURCES = {"iconfont": "https://www.iconfont.cn", "cainiao": "https://icon.sucai999.com"}


def http(url, data=None, headers=None, timeout=30):
    req = urllib.request.Request(url, data=data, headers={"User-Agent": UA, **(headers or {})}, method="POST" if data is not None else "GET")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", "replace")


def cache_path(source, keyword):
    os.makedirs(CACHE_DIR, exist_ok=True)
    return os.path.join(CACHE_DIR, f"{source}-{re.sub(r'[^0-9A-Za-z一-龥]+', '_', keyword)}.json")


def search_iconfont(keyword, limit):
    origin = SOURCES["iconfont"]
    q = urllib.parse.urlencode({"q": keyword, "page": 1, "count": max(limit, 20),
                                "sortType": "updated_at", "fromCollection": "1"})
    ref = f"{origin}/search/index?searchType=icon&q={urllib.parse.quote(keyword)}"
    raw = http(f"{origin}/api/icon/search.json?{q}", data=b"",
               headers={"Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                        "Referer": ref, "Origin": origin, "X-Requested-With": "XMLHttpRequest"})
    body = json.loads(raw)
    if int(body.get("code") or 0) != 200:
        raise RuntimeError("iconfont 返回: " + str(body.get("message"))[:80])
    out = []
    for it in (body.get("data") or {}).get("icons") or []:
        svg = (it.get("show_svg") or it.get("svg") or "").strip()
        if svg:
            out.append({"id": str(it.get("id")), "name": str(it.get("name") or ""), "svg": svg})
    return out[:limit]


def search_cainiao(keyword, limit):
    origin = SOURCES["cainiao"]
    html = http(f"{origin}/s-{urllib.parse.quote(keyword)}-1.html",
                headers={"Referer": origin + "/", "Origin": origin})
    out, seen = [], set()
    for m in re.finditer(r'class="icon-item[^"]*"\s*data-id="(\d+)"', html):
        blk = html[m.start():html.find("</div>", m.end()) + 6]
        svg = re.search(r"<svg.*?</svg>", blk, re.S)
        iid = m.group(1)
        if not svg or iid in seen:
            continue
        seen.add(iid)
        nm = re.search(r'data-name="([^"]+)"|title="([^"]+)"', blk)
        name = (nm.group(1) or nm.group(2)) if nm else ""
        out.append({"id": iid, "name": name or keyword, "svg": svg.group(0)})
        if len(out) >= limit:
            break
    return out


def clean_svg(svg, color):
    svg = re.sub(r'\s(?:class|style|width|height)="[^"]*"', "", svg, count=1)
    svg = svg.replace("data-colorindex", "")
    if color and color != "orig":
        hexcol = "#" + color.lstrip("#")
        svg = svg.replace("currentColor", hexcol)
        svg = re.sub(r'(fill|stroke)="(?!none)[^"]*"', lambda m: f'{m.group(1)}="{hexcol}"', svg)
    return svg


def put_file(workspace_path, content, mime="image/svg+xml"):
    boundary = uuid.uuid4().hex
    parts = []
    for field, value in (("path", workspace_path), ("isDir", "false"), ("modTime", "0")):
        parts.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"{field}\"\r\n\r\n{value}\r\n".encode())
    parts.append(
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{os.path.basename(workspace_path)}\"\r\n"
        f"Content-Type: {mime}\r\n\r\n".encode() + content.encode("utf-8") + b"\r\n")
    parts.append(f"--{boundary}--\r\n".encode())
    req = urllib.request.Request(BASE + "/api/file/putFile", data=b"".join(parts),
                                headers={"Content-Type": f"multipart/form-data; boundary={boundary}"}, method="POST")
    with urllib.request.urlopen(req, timeout=30) as resp:
        body = json.loads(resp.read().decode("utf-8"))
    if body.get("code") != 0:
        raise RuntimeError("putFile 失败: " + str(body.get("msg")))
    return body


def set_icon(doc_id, icon):
    payload = json.dumps({"id": doc_id, "attrs": {"icon": icon}}).encode()
    req = urllib.request.Request(BASE + "/api/attr/setBlockAttrs", data=payload,
                                headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=30) as resp:
        body = json.loads(resp.read().decode("utf-8"))
    if body.get("code") != 0:
        raise RuntimeError("setBlockAttrs 失败: " + str(body.get("msg")))


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("search"); p.add_argument("source", choices=list(SOURCES)); p.add_argument("keyword")
    p.add_argument("--limit", type=int, default=20)
    p = sub.add_parser("use"); p.add_argument("source", choices=list(SOURCES)); p.add_argument("id")
    p.add_argument("--name", default=""); p.add_argument("--color", default="orig"); p.add_argument("--doc", default="")
    p.add_argument("--keyword", default="", help="缓存不存在时用该词重新搜索定位")
    args = ap.parse_args()

    if args.cmd == "search":
        items = (search_iconfont if args.source == "iconfont" else search_cainiao)(args.keyword, args.limit)
        if not items:
            print("没有结果"); return 1
        with open(cache_path(args.source, args.keyword), "w", encoding="utf-8") as fh:
            json.dump(items, fh, ensure_ascii=False)
        print(f"{'序号':<4}{'id':<12}名称")
        for i, it in enumerate(items, 1):
            print(f"{i:<4}{it['id']:<12}{it['name'][:40]}")
        print(f"\n缓存: {cache_path(args.source, args.keyword)}  → 用 `use {args.source} <id>` 落盘", file=sys.stderr)
        return 0

    # use：先查缓存，找不到就按 --keyword 重新搜索
    hits = []
    for f in os.listdir(CACHE_DIR) if os.path.isdir(CACHE_DIR) else []:
        if f.startswith(args.source + "-"):
            hits += [x for x in json.load(open(os.path.join(CACHE_DIR, f), encoding="utf-8")) if x["id"] == args.id]
    if not hits and args.keyword:
        hits = [x for x in (search_iconfont if args.source == "iconfont" else search_cainiao)(args.keyword, 50) if x["id"] == args.id]
    if not hits:
        print(f"缓存里没有 id={args.id}，先 `search {args.source} <关键词>` 或加 --keyword 重搜"); return 1
    item = hits[0]
    stem = args.name or item["name"] or args.keyword or args.id
    stem = re.sub(r'[/\\:*?"<>|]+', "-", stem).strip() or args.id
    color_key = "orig" if args.color == "orig" else "c" + args.color.lstrip("#").lower()
    file_name = f"{stem}-{args.id}-{color_key}.svg"
    put_file(f"/data/emojis/{args.source}/{file_name}", clean_svg(item["svg"], args.color))
    print(f"已落盘: data/emojis/{args.source}/{file_name}")
    print(f"icon 值: {file_name}")
    if args.doc:
        set_icon(args.doc, file_name)
        print(f"已设为文档图标: {args.doc}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
