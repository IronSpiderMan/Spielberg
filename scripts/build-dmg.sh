#!/usr/bin/env bash
# Build and verify a macOS DMG for Spielberg.
# Usage: npm run desktop:dmg
# Optional: TARGET=universal-apple-darwin npm run desktop:dmg
# Optional: VERBOSE=1 npm run desktop:dmg
# Optional: INSTALL_APP=0 npm run desktop:dmg (build only)
# Optional: INSTALL_DIR="$HOME/Applications" npm run desktop:dmg

set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Error: DMG packages can only be built on macOS." >&2
  exit 1
fi

for required in npm node cargo hdiutil ditto; do
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
tauri_args=(build --bundles app)
if [[ -n "$build_target" ]]; then
  tauri_args+=(--target "$build_target")
  target_dir="$target_dir/$build_target"
fi
if [[ "${VERBOSE:-0}" == "1" ]]; then
  tauri_args+=(--verbose)
fi

work_dir="$(mktemp -d "${TMPDIR:-/tmp}/spielberg-dmg-build.XXXXXX")"
trap 'rm -rf "$work_dir"' EXIT

echo "Building Spielberg app..."
npm exec -- tauri "${tauri_args[@]}"

app="$target_dir/release/bundle/macos/Spielberg.app"
if [[ ! -d "$app" ]]; then
  echo "Error: build finished without $app." >&2
  exit 1
fi

# Create the image without Finder/AppleScript layout windows.
version="$(node -p 'JSON.parse(require("fs").readFileSync("src-tauri/tauri.conf.json", "utf8")).version')"
architecture="${build_target:-$(uname -m)}"
bundle_dir="$target_dir/release/bundle/dmg"
mkdir -p "$bundle_dir" "$work_dir/image"
ditto "$app" "$work_dir/image/Spielberg.app"
ln -s /Applications "$work_dir/image/Applications"
dmg="$bundle_dir/Spielberg_${version}_${architecture}.dmg"
hdiutil create -volname Spielberg -srcfolder "$work_dir/image" -format UDZO -ov "$dmg"
hdiutil verify "$dmg"
echo "DMG created: $dmg"

# CI produces artifacts only. Local builds install unless explicitly disabled.
if [[ "${INSTALL_APP:-1}" == "1" && -z "${CI:-}" ]]; then
  install_dir="${INSTALL_DIR:-/Applications}"
  mkdir -p "$install_dir"
  if [[ ! -w "$install_dir" ]]; then
    echo "Error: $install_dir is not writable. Use INSTALL_DIR=\"\$HOME/Applications\" or INSTALL_APP=0." >&2
    exit 1
  fi
  destination="$install_dir/Spielberg.app"
  executable="$destination/Contents/MacOS/spielberg-studio"
  if pgrep -f "^$executable([[:space:]]|$)" >/dev/null; then
    echo "Error: quit Spielberg before installing. DMG is available at $dmg." >&2
    exit 1
  fi
  # Stage a complete copy before replacing the installed application.
  stage="$(mktemp -d "$install_dir/.spielberg-install.XXXXXX")"
  if ! ditto "$app" "$stage/Spielberg.app"; then
    rm -rf "$stage"
    exit 1
  fi
  if [[ -e "$destination" || -L "$destination" ]]; then
    if ! mv "$destination" "$stage/previous.app"; then
      rm -rf "$stage"
      exit 1
    fi
  fi
  if ! mv "$stage/Spielberg.app" "$destination"; then
    if [[ -e "$stage/previous.app" ]]; then
      mv "$stage/previous.app" "$destination"
    fi
    rm -rf "$stage"
    exit 1
  fi
  rm -rf "$stage"
  echo "Installed: $destination"
fi
