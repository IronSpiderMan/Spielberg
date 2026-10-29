#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

VENV_DIR="${RUNNINGHUB_VENV_DIR:-$PROJECT_ROOT/.venv-runninghub}"
PYTHON="$VENV_DIR/bin/python"

if [[ ! -x "$PYTHON" ]]; then
  if ! command -v python3 >/dev/null 2>&1; then
    echo "未找到 python3，请先安装 Python 3。" >&2
    exit 1
  fi
  echo "创建 RunningHub Python 虚拟环境……"
  python3 -m venv "$VENV_DIR"
fi

if ! "$PYTHON" -c 'import fastapi, uvicorn, httpx, boto3' >/dev/null 2>&1; then
  echo "安装 RunningHub 服务依赖……"
  "$PYTHON" -m pip install -r "$PROJECT_ROOT/scripts/requirements-runninghub.txt"
fi

# 与现有 Cookie 服务文档中的画布保持一致，允许环境变量覆盖。
export RUNNINGHUB_CANVAS_ID="${RUNNINGHUB_CANVAS_ID:-2105284694684114946}"

# 前台运行，Ctrl+C 停止；所有参数直接传给 Python 服务。
exec "$PYTHON" "$PROJECT_ROOT/scripts/runninghub_cookie_api.py" "$@"
