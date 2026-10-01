#!/usr/bin/env bash
# 校验 tasks/task_plan.md 中各阶段的完成状态。
# 始终以退出码 0 结束：任务未完成是正常状态，不是错误。
# 用法: check-complete.sh [plan-file]
set -uo pipefail

PLAN_FILE="${1:-tasks/task_plan.md}"

if [ ! -f "$PLAN_FILE" ]; then
	echo '[planning-with-files] No tasks/task_plan.md found -- no active planning session.'
	exit 0
fi

TOTAL="$(grep -o '### Phase' "$PLAN_FILE" 2>/dev/null | wc -l | tr -d ' ')"
COMPLETE="$(grep -o '\*\*Status:\*\* complete' "$PLAN_FILE" 2>/dev/null | wc -l | tr -d ' ')"
IN_PROGRESS="$(grep -o '\*\*Status:\*\* in_progress' "$PLAN_FILE" 2>/dev/null | wc -l | tr -d ' ')"
PENDING="$(grep -o '\*\*Status:\*\* pending' "$PLAN_FILE" 2>/dev/null | wc -l | tr -d ' ')"

# 回退：没有 **Status:** 标记时检查 [complete] 行内格式
if [ "$COMPLETE" -eq 0 ] && [ "$IN_PROGRESS" -eq 0 ] && [ "$PENDING" -eq 0 ]; then
	COMPLETE="$(grep -o '\[complete\]' "$PLAN_FILE" 2>/dev/null | wc -l | tr -d ' ')"
	IN_PROGRESS="$(grep -o '\[in_progress\]' "$PLAN_FILE" 2>/dev/null | wc -l | tr -d ' ')"
	PENDING="$(grep -o '\[pending\]' "$PLAN_FILE" 2>/dev/null | wc -l | tr -d ' ')"
fi

if [ "$TOTAL" -gt 0 ] && [ "$COMPLETE" -eq "$TOTAL" ]; then
	echo "[planning-with-files] ALL PHASES COMPLETE ($COMPLETE/$TOTAL)"
else
	echo "[planning-with-files] Task in progress ($COMPLETE/$TOTAL phases complete)"
	if [ "$IN_PROGRESS" -gt 0 ]; then
		echo "[planning-with-files] $IN_PROGRESS phase(s) still in progress."
	fi
	if [ "$PENDING" -gt 0 ]; then
		echo "[planning-with-files] $PENDING phase(s) pending."
	fi
fi

exit 0
