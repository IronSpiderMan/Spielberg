#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENGINE="${CONTAINER_ENGINE:-podman}"
TARGET_DIR="$ROOT/target-linux-arm64"

"$ENGINE" run --rm --platform linux/arm64 \
  -v "$ROOT:/workspace" -w /workspace \
  docker.io/library/rust:1.91-bookworm bash -lc '
    set -euo pipefail
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      build-essential curl file libssl-dev pkg-config nodejs npm
    npm ci
    npm run build
    CARGO_TARGET_DIR=/workspace/target-linux-arm64 cargo build --release \
      --manifest-path backend/Cargo.toml
  '

echo "Built executable: $TARGET_DIR/release/spielberg-backend"
