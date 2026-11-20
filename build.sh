#!/usr/bin/env sh
# Builds the plugin for wasm32-wasip2 and puts the component next to plugin.json as provider.wasm.
# Needs the target once: rustup target add wasm32-wasip2
set -eu
cd "$(dirname "$0")"
cargo build --release --target wasm32-wasip2
cp "${CARGO_TARGET_DIR:-target}/wasm32-wasip2/release/provider.wasm" provider.wasm
echo "Built provider.wasm"
