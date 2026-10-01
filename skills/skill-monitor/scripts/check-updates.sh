#!/usr/bin/env bash
# skill-monitor 自动检查脚本（供 cron / systemd timer 或手动调用）
# 读取 ~/.skill-monitor/monitor.json，对每条 watch 用 GitHub API 对比 blob sha，
# 发现变化则下载新版本、生成变更摘要报告（reports/<日期>/<watch-id>.md），
# 并更新 monitor.json 中的 sha 记录（无人值守：同一更新只报告一次）。
#
# 用法: check-updates.sh
# 可选环境变量: GITHUB_TOKEN（提高 API 限速）、SKILL_MONITOR_DIR（覆盖数据目录）
set -uo pipefail

DATA_DIR="${SKILL_MONITOR_DIR:-$HOME/.skill-monitor}"
MANIFEST="$DATA_DIR/monitor.json"
REPORTS_DIR="$DATA_DIR/reports"
LOGS_DIR="$DATA_DIR/logs"
TODAY="$(date +%F)"
LOG_FILE="$LOGS_DIR/check-$TODAY.log"

mkdir -p "$LOGS_DIR" "$REPORTS_DIR"

log() {
	local line
	line="[$(date '+%F %T')] $1"
	printf '%s\n' "$line" >>"$LOG_FILE"
	printf '%s\n' "$1"
}

if [ ! -f "$MANIFEST" ]; then
	log "monitor.json 不存在（$MANIFEST），跳过检查"
	exit 0
fi

command -v jq >/dev/null 2>&1 || { log '缺少 jq，无法解析 GitHub API 响应'; exit 1; }
command -v curl >/dev/null 2>&1 || { log '缺少 curl'; exit 1; }

API_HEADERS=(-H 'User-Agent: skill-monitor' -H 'Accept: application/vnd.github+json')
if [ -n "${GITHUB_TOKEN:-}" ]; then
	API_HEADERS+=(-H "Authorization: Bearer $GITHUB_TOKEN")
fi

api_get() { # url
	curl -sS "${API_HEADERS[@]}" --max-time 30 "$1" 2>/dev/null
}

# 网络就绪探测：开机后计划任务可能先于网络启动，失败则每 60 秒重试，最多 6 次（约 5 分钟）
wait_network_ready() {
	local max_attempts=6 attempt=0
	while [ "$attempt" -lt "$max_attempts" ]; do
		# 有响应即视为网络通（403 限速也算），仅连接失败才重试
		if curl -sS -o /dev/null --max-time 10 -H 'User-Agent: skill-monitor' https://api.github.com 2>/dev/null; then
			return 0
		fi
		attempt=$((attempt + 1))
		if [ "$attempt" -lt "$max_attempts" ]; then
			log "网络未就绪（第 $attempt 次尝试失败），60 秒后重试..."
			sleep 60
		fi
	done
	log '网络探测失败，跳过本次检查'
	return 1
}

# 递归列出仓库目录下所有文件，输出 JSON 对象 {"相对路径": "blob sha"}
remote_files_json() { # repo path ref
	local repo="$1" path="$2" ref="$3"
	local url="https://api.github.com/repos/$repo/contents/${path}?ref=${ref}"
	[ -z "$path" ] && url="https://api.github.com/repos/$repo/contents?ref=${ref}"

	local json count out='{}' i=0
	json="$(api_get "$url")"
	[ -z "$json" ] && { printf '{}'; return 0; }
	count="$(jq 'if type == "array" then length else 0 end' <<<"$json" 2>/dev/null)" || count=0

	while [ "$i" -lt "$count" ]; do
		local type name sha sub
		type="$(jq -r ".[$i].type" <<<"$json")"
		name="$(jq -r ".[$i].name" <<<"$json")"
		if [ "$type" = "dir" ]; then
			sub="$(remote_files_json "$repo" "$(jq -r ".[$i].path" <<<"$json")" "$ref")"
			sub="$(jq -cn --arg p "$name/" --argjson s "$sub" '$s | with_entries(.key = ($p + .key))')"
			out="$(jq -cn --argjson a "$out" --argjson b "$sub" '$a + $b')"
		else
			sha="$(jq -r ".[$i].sha" <<<"$json")"
			out="$(jq -cn --argjson a "$out" --arg k "$name" --arg v "$sha" '$a + {($k): $v}')"
		fi
		i=$((i + 1))
	done
	printf '%s' "$out"
}

download_raw() { # repo ref remote-file out-path
	local repo="$1" ref="$2" file="$3" out="$4"
	mkdir -p "$(dirname "$out")"
	curl -sS -fL --max-time 60 -H 'User-Agent: skill-monitor' \
		${GITHUB_TOKEN:+-H "Authorization: Bearer $GITHUB_TOKEN"} \
		-o "$out" "https://raw.githubusercontent.com/$repo/$ref/$file"
}

# 对比本地旧文件与下载的新文件，设置 DIFF_STAT / DIFF_SAMPLE
diff_summary() { # old-path new-path
	local old="$1" new="$2" diff added removed
	diff="$(git diff --no-index --unified=2 -- "$old" "$new" 2>/dev/null || true)"
	added="$(printf '%s\n' "$diff" | grep -c '^+[^+]' || true)"
	removed="$(printf '%s\n' "$diff" | grep -c '^-[^-]' || true)"
	DIFF_STAT="+$added -$removed"
	DIFF_SAMPLE="$(printf '%s\n' "$diff" | grep '^[+-][^+-]' | head -30 | cut -c1-120 || true)"
}

wait_network_ready || exit 1
log '=== skill-monitor 检查开始 ==='

mapfile -t WATCHES < <(jq -r '.watches[]? | [.id, .repo, .path, .ref, .local_dir] | @tsv' "$MANIFEST")
changed=0

for watch in "${WATCHES[@]}"; do
	IFS=$'\t' read -r id repo path ref local_dir <<<"$watch"
	[ -z "$id" ] && continue
	log "==> 检查 $id ($repo/$path)"

	remote="$(remote_files_json "$repo" "$path" "$ref")"
	if [ -z "$remote" ] || [ "$remote" = '{}' ]; then
		log '    获取远端文件失败或目录为空'
		continue
	fi

	old_files="$(jq -c --arg id "$id" '(.watches[] | select(.id == $id) | .files) // {}' "$MANIFEST")"
	modified="$(jq -rn --argjson o "$old_files" --argjson r "$remote" '$r | to_entries[] | select($o[.key] != null and $o[.key] != .value) | .key')"
	added="$(jq -rn --argjson o "$old_files" --argjson r "$remote" '$r | to_entries[] | select($o[.key] == null) | .key')"
	deleted="$(jq -rn --argjson o "$old_files" --argjson r "$remote" '$o | to_entries[] | select($r[.key] == null) | .key')"

	[ -z "$modified$added$deleted" ] && { log '    无更新'; continue; }
	changed=1
	log "    发现更新: 修改 $(printf '%s' "$modified" | grep -c . ) / 新增 $(printf '%s' "$added" | grep -c . ) / 删除 $(printf '%s' "$deleted" | grep -c . )"

	tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/skill-monitor-$id-XXXXXX")"
	report=("# 更新摘要：$id（$TODAY）" \
		"来源: https://github.com/$repo/tree/$ref/$path" \
		"本地: $local_dir" "" "## 变更列表")
	while IFS= read -r f; do [ -n "$f" ] && report+=("- [修改] $f"); done <<<"$modified"
	while IFS= read -r f; do [ -n "$f" ] && report+=("- [新增] $f"); done <<<"$added"
	while IFS= read -r f; do [ -n "$f" ] && report+=("- [删除] $f"); done <<<"$deleted"
	report+=("" "## 变更详情")

	while IFS= read -r f; do
		[ -z "$f" ] && continue
		new_file="$tmp_dir/$f"
		download_raw "$repo" "$ref" "$path/$f" "$new_file" || { report+=("### $f" "" "（下载失败）" ""); continue; }
		diff_summary "$local_dir/$f" "$new_file"
		report+=("### $f（$DIFF_STAT）" '```diff' "$DIFF_SAMPLE" '```' "")
	done <<<"$modified"

	while IFS= read -r f; do
		[ -z "$f" ] && continue
		new_file="$tmp_dir/$f"
		download_raw "$repo" "$ref" "$path/$f" "$new_file" || continue
		report+=("### $f（新增文件）" '```' "$(head -30 "$new_file")" '```' "")
	done <<<"$added"

	while IFS= read -r f; do [ -n "$f" ] && report+=("### $f（远端已删除）" ""); done <<<"$deleted"

	report_dir="$REPORTS_DIR/$TODAY"
	mkdir -p "$report_dir"
	printf '%s\n' "${report[@]}" >"$report_dir/$id.md"
	log "    报告已生成: $report_dir/$id.md"

	# 无人值守：直接记录新 sha，同一更新只报告一次
	jq --arg id "$id" --argjson files "$remote" \
		'(.watches[] | select(.id == $id) | .files) = $files' \
		"$MANIFEST" >"$MANIFEST.tmp" && mv "$MANIFEST.tmp" "$MANIFEST"

	rm -rf "$tmp_dir"
done

[ "$changed" -eq 0 ] && log "所有监控项均无更新（$TODAY）"
log '=== 检查完成 ==='
