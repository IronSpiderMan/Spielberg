#!/usr/bin/env bash
# Usage: ./scripts/start-comfyui-video.sh [--host 0.0.0.0] [--port 8002]
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PYTHON_BIN="${PYTHON_BIN:-python3}"

if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  echo "错误：未找到 $PYTHON_BIN，请安装 Python 3.10+，或设置 PYTHON_BIN。" >&2
  exit 1
fi

if ! "$PYTHON_BIN" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)'; then
  echo "错误：需要 Python 3.10 或更新版本。" >&2
  exit 1
fi

export COMFYUI_URL="${COMFYUI_URL:-http://192.168.1.10:8188}"
exec "$PYTHON_BIN" "$SCRIPT_DIR/comfyui_video_api.py" "$@"
