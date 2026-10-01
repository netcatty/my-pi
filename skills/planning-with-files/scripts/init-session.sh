#!/usr/bin/env bash
# 初始化规划文件（tasks/task_plan.md、tasks/findings.md、tasks/progress.md）
# 用法: init-session.sh [项目名]
set -euo pipefail

PROJECT_NAME="${1:-project}"
DATE="$(date +%Y-%m-%d)"
TASK_DIR="tasks"

echo "Initializing planning files for: $PROJECT_NAME"

if [ ! -d "$TASK_DIR" ]; then
	mkdir -p "$TASK_DIR"
	echo "Created tasks directory"
fi

if [ ! -f "$TASK_DIR/task_plan.md" ]; then
	cat >"$TASK_DIR/task_plan.md" <<'EOF'
# Task Plan: [Brief Description]

## Goal
[One sentence describing the end state]

## Current Phase
Phase 1

## Phases

### Phase 1: Requirements & Discovery
- [ ] Understand user intent
- [ ] Identify constraints
- [ ] Document in tasks/findings.md
- **Status:** in_progress

### Phase 2: Planning & Structure
- [ ] Define approach
- [ ] Create project structure
- **Status:** pending

### Phase 3: Implementation
- [ ] Execute the plan
- [ ] Write to files before executing
- **Status:** pending

### Phase 4: Testing & Verification
- [ ] Verify requirements met
- [ ] Document test results
- **Status:** pending

### Phase 5: Delivery
- [ ] Review outputs
- [ ] Deliver to user
- **Status:** pending

## Decisions Made
| Decision | Rationale |
|----------|-----------|

## Errors Encountered
| Error | Resolution |
|-------|------------|
EOF
	echo "Created tasks/task_plan.md"
else
	echo "tasks/task_plan.md already exists, skipping"
fi

if [ ! -f "$TASK_DIR/findings.md" ]; then
	cat >"$TASK_DIR/findings.md" <<'EOF'
# Findings & Decisions

## Requirements
-

## Research Findings
-

## Technical Decisions
| Decision | Rationale |
|----------|-----------|

## Issues Encountered
| Issue | Resolution |
|-------|------------|

## Resources
-
EOF
	echo "Created tasks/findings.md"
else
	echo "tasks/findings.md already exists, skipping"
fi

if [ ! -f "$TASK_DIR/progress.md" ]; then
	cat >"$TASK_DIR/progress.md" <<EOF
# Progress Log

## Session: $DATE

### Current Status
- **Phase:** 1 - Requirements & Discovery
- **Started:** $DATE

### Actions Taken
-

### Test Results
| Test | Expected | Actual | Status |
|------|----------|--------|--------|

### Errors
| Error | Resolution |
|-------|------------|
EOF
	echo "Created tasks/progress.md"
else
	echo "tasks/progress.md already exists, skipping"
fi

echo ""
echo "Planning files initialized!"
echo "Files: tasks/task_plan.md, tasks/findings.md, tasks/progress.md"
