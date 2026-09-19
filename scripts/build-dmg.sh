#!/usr/bin/env bash
# Build a macOS DMG for Spielberg.
# Usage: npm run desktop:dmg
# Optional: TARGET=universal-apple-darwin npm run desktop:dmg

set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Error: DMG packages can only be built on macOS." >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "Error: npm is required to build the application." >&2
  exit 1
fi

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"

target_suffix=""
if [[ -n "${TARGET:-}" ]]; then
  target_suffix="/$TARGET"
fi

echo "Building Spielberg DMG..."
if [[ -n "${TARGET:-}" ]]; then
  npm exec tauri build -- --bundles dmg --target "$TARGET"
else
  npm exec tauri build -- --bundles dmg
fi

bundle_dir="src-tauri/target${target_suffix}/release/bundle/dmg"
shopt -s nullglob
dmg_files=("$bundle_dir"/*.dmg)

if (( ${#dmg_files[@]} != 1 )); then
  echo "Error: expected one DMG in $bundle_dir, found ${#dmg_files[@]}." >&2
  exit 1
fi

echo "DMG created: ${dmg_files[0]}"
