#!/usr/bin/env bash
# 思源库定期巡检：全规则合规 + 标点扫描，报告落到文件，有违规则退出码 1。
#
# 用法:
#   bash sy_patrol.sh <数据目录> [报告目录]
#   bash sy_patrol.sh ~/data/siyuan/data/20220830141027-o4meubr
#
# 环境变量:
#   SIYUAN_BOX  笔记本 id（默认 20220830141027-o4meubr）
#   SIYUAN_DB   索引库路径（默认 ~/data/siyuan/temp/siyuan.db）
#
# cron 示例（每周一 9:05，日志留在报告目录）:
#   5 9 * * 1 /usr/bin/bash "$HOME/.pi/agent/skills/siyuan-note-style/scripts/sy_patrol.sh" \
#       "$HOME/data/siyuan/data/20220830141027-o4meubr" >> "$HOME/tasks/siyuan-java-dedup/patrol.log" 2>&1
set -uo pipefail

DATA_DIR="${1:?用法: sy_patrol.sh <数据目录> [报告目录]}"
OUT_DIR="${2:-$HOME/tasks/siyuan-java-dedup}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SIYUAN_BOX="${SIYUAN_BOX:-20220830141027-o4meubr}"
SIYUAN_DB="${SIYUAN_DB:-$HOME/data/siyuan/temp/siyuan.db}"
IGNORE_FILE="${SIYUAN_PUNCT_IGNORE:-$OUT_DIR/punct-ignore.txt}"

mkdir -p "$OUT_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
REPORT="$OUT_DIR/patrol-$STAMP.txt"
PATHS="$OUT_DIR/patrol-$STAMP.paths"

{
  echo "=== 思源库巡检 $(date '+%Y-%m-%d %H:%M:%S') ==="
  echo "数据目录: $DATA_DIR"
  echo

  echo "--- 1/2 全规则合规（sy_compliance.py）---"
  python3 "$SCRIPT_DIR/sy_compliance.py" "$DATA_DIR" --box "$SIYUAN_BOX" --db "$SIYUAN_DB"
  RC_COMPLIANCE=$?

  echo
  echo "--- 2/2 标点扫描（punct_scan.py，只报告）---"
  python3 - "$SIYUAN_DB" "$SIYUAN_BOX" "$PATHS" <<'PY'
import sqlite3, sys
db, box, out = sys.argv[1], sys.argv[2], sys.argv[3]
c = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
rows = [p for (p,) in c.execute(
    "SELECT path FROM blocks WHERE type='d' AND box=? AND path IS NOT NULL", (box,))]
open(out, "w", encoding="utf-8").write("\n".join(rows) + "\n")
print(f"文档 {len(rows)} 篇 → {out}")
PY
  if [ -f "$IGNORE_FILE" ]; then
    python3 "$SCRIPT_DIR/punct_scan.py" "$PATHS" --db "$SIYUAN_DB" --ignore "$IGNORE_FILE"
  else
    python3 "$SCRIPT_DIR/punct_scan.py" "$PATHS" --db "$SIYUAN_DB"
  fi
  RC_PUNCT=$?

  echo
  echo "=== 巡检结束：合规退出码 $RC_COMPLIANCE，标点退出码 $RC_PUNCT ==="
  if [ "$RC_COMPLIANCE" -eq 0 ] && [ "$RC_PUNCT" -eq 0 ]; then
    echo "结论：无待改项 ✓"
  else
    echo "结论：有需要处理的项目，请查看上面列出的条目"
  fi
  rm -f "$PATHS"
} >"$REPORT" 2>&1

cat "$REPORT"
echo
echo "报告已写入: $REPORT"
if grep -q "结论：无待改项" "$REPORT"; then exit 0; else exit 1; fi
