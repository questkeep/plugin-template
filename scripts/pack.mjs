#!/usr/bin/env node
// Packs the plugin into dist/<id>-<version>.zip. The zip holds, at its top level with forward
// slashes: plugin.json, the files plugin.json names (the store's wasm, the extension's main file
// and style sheets, the themes' CSS, the icon), README.md, LICENSE, and whatever package.json's
// "pack.include" lists (files or folders, for example images or helper modules the plugin loads).
// Run the build first for a store (npm run build).
//
//   node scripts/pack.mjs
//
// Prints `file=`, `sha256=` and `size=` lines (also appended to $GITHUB_OUTPUT when it is set).
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkIconFile, validateManifest } from "./manifest.mjs";
import { createZip } from "./zip.mjs";

/** Every file below `dir` (relative paths with forward slashes), sorted. */
function walk(root, rel) {
  const full = path.join(root, rel);
  const stat = fs.statSync(full);
  if (stat.isFile()) return [rel];
  return fs
    .readdirSync(full)
    .sort()
    .flatMap((name) => walk(root, `${rel}/${name}`));
}

/** The files of the package, in zip order: plugin.json first, then the rest sorted. */
export function packageFiles(root, manifest) {
  const wanted = new Set(["plugin.json", "README.md", "LICENSE"]);
  for (const p of manifest.providers ?? []) wanted.add(p.wasm);
  if (manifest.icon) wanted.add(manifest.icon);
  if (manifest.extension?.main) wanted.add(manifest.extension.main);
  for (const s of manifest.extension?.styles ?? []) wanted.add(s);
  for (const t of manifest.themes ?? []) wanted.add(t.css);

  let include = [];
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    include = pkg.pack?.include ?? [];
  } catch {
    // No package.json: nothing extra.
  }
  for (const extra of include) {
    const rel = String(extra).replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
    if (rel === "" || rel.startsWith("/") || rel.split("/").includes("..")) {
      throw new Error(`pack.include: "${extra}" must be a path inside the plugin folder`);
    }
    if (!fs.existsSync(path.join(root, rel))) throw new Error(`pack.include: "${extra}" does not exist`);
    for (const file of walk(root, rel)) wanted.add(file);
  }

  const missing = [...wanted].filter((f) => !fs.existsSync(path.join(root, f)));
  if (missing.length > 0) throw new Error(`${missing.join(", ")} is missing`);
  const rest = [...wanted].filter((f) => f !== "plugin.json").map((f) => f.replace(/^\.\//, "")).sort();
  return ["plugin.json", ...new Set(rest)];
}

/** Packs the plugin in `root` into `<root>/dist` and returns `{ file, name, sha256, size, files }`. */
export function pack(root) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "plugin.json"), "utf8"));
  const problems = validateManifest(manifest, (rel) => fs.existsSync(path.join(root, rel)));
  if (manifest.icon && fs.existsSync(path.join(root, manifest.icon))) {
    problems.push(...checkIconFile(manifest.icon, fs.readFileSync(path.join(root, manifest.icon))));
  }
  if (problems.length > 0) throw new Error(`plugin.json is not valid:\n- ${problems.join("\n- ")}`);
  const files = packageFiles(root, manifest);
  const zip = createZip(files.map((name) => ({ name, data: fs.readFileSync(path.join(root, name)) })));
  const distDir = path.join(root, "dist");
  fs.mkdirSync(distDir, { recursive: true });
  const name = `${manifest.id}-${manifest.version}.zip`;
  const file = path.join(distDir, name);
  fs.writeFileSync(file, zip);
  return { file, name, sha256: createHash("sha256").update(zip).digest("hex"), size: zip.length, files };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  try {
    const result = pack(root);
    const lines = [`file=${result.file}`, `sha256=${result.sha256}`, `size=${result.size}`];
    console.log(lines.join("\n"));
    console.log(`files=${result.files.join(", ")}`);
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join("\n")}\n`);
  } catch (error) {
    console.error(`error: ${error.message}`);
    process.exit(1);
  }
}
