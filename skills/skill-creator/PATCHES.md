# skill-creator 补丁记录

> **注**：`skills/skill-creator/` 是本地目录，`pi update` 不会覆盖。
> 本文档仅作记录，供重新安装该 skill 时参考。

## 修复日期

2026-09-12

## 4 个修复

### 1. 缺失 PyYAML（环境依赖）

```bash
python -m pip install pyyaml
```

验证：`python -c "import yaml; print(yaml.__version__)"`

### 2. 文件读取缺 encoding（9 处）

**症状**：Windows 下读 UTF-8 中文文件报 `UnicodeDecodeError: 'gbk' codec`

| 文件 | 修改 |
|------|------|
| `quick_validate.py:22` | `read_text()` → `read_text(encoding="utf-8")` |
| `utils.py:9` | 同上 |
| `generate_report.py:314` | 同上 |
| `improve_description.py:208,211` | 同上 |
| `run_eval.py:272` | 同上 |
| `run_loop.py:261` | 同上 |
| `aggregate_benchmark.py:377,383` | `open(..., "w")` → 加 `encoding="utf-8"` |

### 3. emoji 输出崩溃（7 个脚本）

**症状**：`UnicodeEncodeError: 'gbk' codec can't encode character '\U0001f4e6'`

**修复**：在每个脚本的 import 之后插入：

```python
import sys, io
if sys.stdout.encoding and sys.stdout.encoding.lower() not in ('utf-8','utf8'):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')
```

涉及：`package_skill.py` `aggregate_benchmark.py` `generate_report.py`
`improve_description.py` `run_eval.py` `run_loop.py` `quick_validate.py`

### 4. 验证器字段列表过时

**症状**：把 pi 官方字段 `disable-model-invocation` 判为非法

**修复**（`quick_validate.py`）：

```python
# 原
ALLOWED_PROPERTIES = {'name', 'description', 'license', 'allowed-tools', 'metadata', 'compatibility'}
# 改
ALLOWED_PROPERTIES = {'name', 'description', 'license', 'allowed-tools', 'metadata', 'compatibility', 'disable-model-invocation'}
```

## 验证

```bash
# 验证所有 skill
for d in skills/*/; do
  python skills/skill-creator/scripts/quick_validate.py "$d"
done
# 预期：14/14 输出 "Skill is valid!"

# 测试打包
cd skills/skill-creator && python -m scripts.package_skill ../naming
```

## 为什么不写成补丁脚本

`skills/` 是本地目录，`pi update` 不覆盖，无需重复打补丁。
若将来通过 npm 重装 `skill-creator`，按本文档手工修一遍即可。
