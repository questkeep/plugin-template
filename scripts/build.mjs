#!/usr/bin/env node
// Builds provider.wasm next to plugin.json (cross-platform; build.ps1 / build.sh do the same).
// Needs the Rust target once: rustup target add wasm32-wasip2
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
execFileSync("cargo", ["build", "--release", "--target", "wasm32-wasip2"], {
  cwd: root,
  stdio: "inherit",
});
// The library is named `provider` in Cargo.toml, so the component is provider.wasm.
const targetDir = process.env.CARGO_TARGET_DIR ?? path.join(root, "target");
fs.copyFileSync(
  path.join(targetDir, "wasm32-wasip2", "release", "provider.wasm"),
  path.join(root, "provider.wasm"),
);
console.log("Built provider.wasm");
