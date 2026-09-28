#!/usr/bin/env bash
# Build and verify a macOS DMG for Spielberg.
# Usage: npm run desktop:dmg
# Optional: TARGET=universal-apple-darwin npm run desktop:dmg
# Optional: VERBOSE=1 npm run desktop:dmg

set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Error: DMG packages can only be built on macOS." >&2
  exit 1
fi

for required in npm node cargo hdiutil; do
  if ! command -v "$required" >/dev/null 2>&1; then
    echo "Error: $required is required to build the application." >&2
    exit 1
  fi
done

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"

# Ask Cargo for its actual target directory, including CARGO_TARGET_DIR/config overrides.
target_dir="$(cd "$project_dir/src-tauri" && cargo metadata --no-deps --format-version 1 --offline |
  node -e 'let data="";process.stdin.on("data",v=>data+=v);process.stdin.on("end",()=>process.stdout.write(JSON.parse(data).target_directory));')"
build_target="${TARGET:-${CARGO_BUILD_TARGET:-}}"
tauri_args=(build --bundles dmg)
if [[ -n "$build_target" ]]; then
  tauri_args+=(--target "$build_target")
  target_dir="$target_dir/$build_target"
fi
if [[ "${VERBOSE:-0}" == "1" ]]; then
  tauri_args+=(--verbose)
fi

marker="$(mktemp "${TMPDIR:-/tmp}/spielberg-dmg-build.XXXXXX")"
trap 'rm -f "$marker"' EXIT

echo "Building Spielberg DMG..."
npm exec -- tauri "${tauri_args[@]}"

bundle_dir="$target_dir/release/bundle/dmg"
shopt -s nullglob
created=()
for dmg in "$bundle_dir"/*.dmg; do
  # Historical versions may remain in this directory; report only this build's output.
  if [[ "$dmg" -nt "$marker" ]]; then
    created+=("$dmg")
  fi
done
if (( ${#created[@]} == 0 )); then
  echo "Error: build finished without a new DMG in $bundle_dir." >&2
  exit 1
fi
for dmg in "${created[@]}"; do
  hdiutil verify "$dmg"
  echo "DMG created: $dmg"
done
