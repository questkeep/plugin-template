#!/usr/bin/env node
// Writes the plugin registry's `versions.json` entry of a release (docs/PLUGIN_REGISTRY.md in the
// Questkeep repository) as JSON, ready to paste.
//
//   node scripts/release/registry-entry.mjs --version 0.1.0 --repo <owner>/<repo> \
//     --file <id>-0.1.0.zip --sha256 <hex> --size <bytes> --notes notes.md \
//     [--min-app 0.7.0] [--released 2026-11-20] [--out entry.json]
//
// Without --min-app the lowest Questkeep version comes from registry/min-app (first line).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildRegistryEntry } from "./lib.mjs";

const args = process.argv.slice(2);
function option(name, fallback) {
  const i = args.indexOf(`--${name}`);
  const value = i < 0 ? undefined : args[i + 1];
  if (value === undefined || value.startsWith("--")) {
    if (fallback !== undefined) return fallback;
    console.error(`error: --${name} is required`);
    process.exit(1);
  }
  return value;
}

/** The default `minApp`: the first line of registry/min-app. */
function defaultMinApp() {
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "registry", "min-app");
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8").split(/\r?\n/)[0].trim() : "0.7.0";
}

const entry = buildRegistryEntry({
  version: option("version"),
  repo: option("repo"),
  file: option("file"),
  sha256: option("sha256"),
  size: Number(option("size")),
  minApp: option("min-app", defaultMinApp()),
  released: option("released", new Date().toISOString().slice(0, 10)),
  notes: fs.readFileSync(option("notes"), "utf8"),
});
const json = `${JSON.stringify(entry, null, 2)}\n`;
const out = args.includes("--out") ? option("out") : undefined;
if (out) fs.writeFileSync(out, json);
else process.stdout.write(json);
