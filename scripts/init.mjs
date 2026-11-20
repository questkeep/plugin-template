#!/usr/bin/env node
// Turns this template into your plugin. Dependency-free (Node 24, `node:` built-ins only).
//
//   node scripts/init.mjs <id> "<Display Name>" [--kinds store,extension,theme]
//        [--author "<name>"] [--description "<text>"] [--repo <owner/repo>]
//        [--yes] [--dry-run] [--keep-init]
//   npm run init -- <id> "<Display Name>" ...
//
// Missing values are asked for (readline, with defaults) when the terminal is interactive;
// `--yes` (or no terminal) takes the defaults instead. What it does:
//
//   * validates the id like Questkeep's plugin host (2 to 64 of a-z, 0-9 and -, not starting with -);
//   * rewrites plugin.json, registry/meta.json, Cargo.toml and Cargo.lock, package.json, LICENSE,
//     README.md and AGENTS.md (from scripts/init-templates/) for the kinds you chose;
//   * strips the "# @kind:<kind>" ... "# @end" blocks of the other kinds from the workflows and
//     other text files (the marker lines themselves always go);
//   * deletes the files of the kinds you did not choose (src/, Cargo.*, build scripts for a plugin
//     without a store; main.js, style.css for one without an extension; themes/ without themes);
//   * adds the changeset for the first release;
//   * deletes itself, its tests, its templates and the template's own workflow (`--keep-init` keeps
//     the first three).
//
// Everything is worked out in memory first and written only when it all worked, so a mistake in
// the arguments never leaves a half-converted folder. It runs once: package.json carries the
// marker `"questkeepTemplate": "pending"`, which init removes. It touches nothing outside this
// folder. `--dry-run` prints what it would do and changes nothing.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";

export const KINDS = ["store", "extension", "theme"];
export const ID_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;
/** What the template's files say before init. */
export const PLACEHOLDER_ID = "my-plugin";
export const PLACEHOLDER_NAME = "My Plugin";
export const PLACEHOLDER_REPO = "OWNER/my-plugin";
export const MARKER = "questkeepTemplate";

const here = path.dirname(fileURLToPath(import.meta.url));
const defaultRoot = path.resolve(here, "..");

// ---------------------------------------------------------------------------------------------
// Validation and small pure helpers

/** An error message, or `null` when the id is valid. Same rule as the plugin host. */
export function validateId(id) {
  if (typeof id !== "string" || !ID_RE.test(id)) {
    return `The id "${id}" is not valid: use 2 to 64 lowercase letters, digits and dashes, starting with a letter or digit (a-z, 0-9, -).`;
  }
  return null;
}

/** The kinds as an array in canonical order. Throws on an empty list, unknown or repeated kinds. */
export function parseKinds(text) {
  const given = String(text)
    .split(",")
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean);
  if (given.length === 0) throw new Error(`Choose at least one kind: ${KINDS.join(", ")}.`);
  for (const kind of given) {
    if (!KINDS.includes(kind)) throw new Error(`Unknown kind "${kind}": use ${KINDS.join(", ")}.`);
  }
  if (new Set(given).size !== given.length) throw new Error("A kind is listed twice.");
  return KINDS.filter((k) => given.includes(k));
}

/** `owner/repo` from `owner/repo`, an https GitHub URL or an ssh remote. Throws otherwise. */
export function parseRepo(text) {
  const m =
    /^(?:https?:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)?([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(
      String(text).trim(),
    );
  if (!m) throw new Error(`The repository "${text}" is not owner/repo (a GitHub repository).`);
  return `${m[1]}/${m[2]}`;
}

/** "my-cool-plugin" gives "My Cool Plugin". */
export function nameFromId(id) {
  return id
    .split("-")
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

/** The registry's one-line summary (at most 120 characters) from a longer description. */
export function summaryFrom(description) {
  const line = description.replace(/\s+/g, " ").trim();
  if (line.length <= 120) return line;
  const sentence = /^(.{1,118}[.!?])(\s|$)/.exec(line);
  if (sentence) return sentence[1];
  return `${line.slice(0, 117).trimEnd()}...`;
}

/** A Rust string literal for text without control characters. */
export function rustString(text) {
  return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

const KIND_LABELS = { store: "store", extension: "extension", theme: "theme" };
/** "store, extension and theme" */
export function kindsText(kinds) {
  const labels = kinds.map((k) => KIND_LABELS[k]);
  return labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
}

/** Checks the free-text options against what the registry accepts. Returns messages. */
export function validateOptions({ name, author, description }) {
  const problems = [];
  const control = /[\u0000-\u001f\u007f]/;
  if (!name || !name.trim()) problems.push("The name must not be empty.");
  else if (name.length > 64) problems.push("The name is longer than 64 characters (the registry's limit).");
  else if (control.test(name)) problems.push("The name must not contain control characters.");
  if (!author || !author.trim()) problems.push("The author must not be empty.");
  else if (author.length > 100) problems.push("The author is longer than 100 characters.");
  else if (control.test(author)) problems.push("The author must not contain control characters.");
  if (!description || !description.trim()) problems.push("The description must not be empty.");
  else if (description.length > 2000) problems.push("The description is longer than 2000 characters.");
  return problems;
}

const OPEN = /^\s*(?:#|\/\/|<!--)\s*@kind:([a-z,]+)\s*(?:-->)?\s*$/;
const CLOSE = /^\s*(?:#|\/\/|<!--)\s*@end\s*(?:-->)?\s*$/;

/**
 * Applies the kind blocks of a text file. A block starts with a line `# @kind:store` (or
 * `// @kind:` / `<!-- @kind:store -->`; several kinds separated by commas keep the block when any
 * of them is chosen) and ends with `# @end`. The pseudo-kind `template` is never chosen: such blocks
 * explain the template itself and are always removed. The marker lines are always removed; the lines
 * between them stay when the block's kind was chosen, and go otherwise. Blocks may nest.
 */
export function processBlocks(text, kinds) {
  const out = [];
  const keeping = [];
  for (const [i, line] of text.split("\n").entries()) {
    const bare = line.replace(/\r$/, "");
    const open = OPEN.exec(bare);
    if (open) {
      const wanted = open[1].split(",");
      for (const kind of wanted) {
        if (!KINDS.includes(kind) && kind !== "template") {
          throw new Error(`line ${i + 1}: unknown kind "${kind}" in a block marker`);
        }
      }
      keeping.push(wanted.some((k) => kinds.includes(k)));
      continue;
    }
    if (CLOSE.test(bare)) {
      if (keeping.length === 0) throw new Error(`line ${i + 1}: "@end" without a block`);
      keeping.pop();
      continue;
    }
    if (keeping.every(Boolean)) out.push(line);
  }
  if (keeping.length > 0) throw new Error("a kind block is not closed with @end");
  return out.join("\n");
}

/** Fills `{{key}}` placeholders; an unknown key is an error. */
export function fillPlaceholders(text, values) {
  return text.replace(/\{\{(\w+)\}\}/g, (whole, key) => {
    if (!(key in values)) throw new Error(`unknown placeholder ${whole}`);
    return values[key];
  });
}

/** Cargo writes `[[package]]` entries sorted by name; renaming a package needs the same order. */
export function sortCargoLock(text) {
  const start = text.indexOf("[[package]]");
  if (start < 0) return text;
  const head = text.slice(0, start);
  const blocks = text
    .slice(start)
    .split(/(?=\[\[package\]\]\r?\n)/)
    .map((b) => b.trimEnd());
  const key = (b) => {
    const name = /^name = "([^"]*)"/m.exec(b)?.[1] ?? "";
    const version = /^version = "([^"]*)"/m.exec(b)?.[1] ?? "";
    return [name, version];
  };
  blocks.sort((a, b) => {
    const [an, av] = key(a);
    const [bn, bv] = key(b);
    return an < bn ? -1 : an > bn ? 1 : av < bv ? -1 : av > bv ? 1 : 0;
  });
  return `${head}${blocks.join("\n\n")}\n`;
}

/** Replaces the first match of `pattern` and fails loudly when the template changed under us. */
function replaceOnce(text, pattern, replacement, what) {
  if (!pattern.test(text)) throw new Error(`could not find ${what} in the template (was it edited?)`);
  return text.replace(pattern, typeof replacement === "function" ? replacement : () => replacement);
}

// ---------------------------------------------------------------------------------------------
// The plan

/**
 * Works out everything init would do in the folder `root` and returns
 * `{ writes: Map<path, text>, deletes: string[], notes: string[] }` (paths relative to `root`,
 * forward slashes). Reads files, writes nothing. `options` is `{ id, name, kinds, author,
 * description, repo, keepInit, year }`.
 */
export function planInit(root, options) {
  const { id, name, kinds, author, description, repo } = options;
  const keepInit = options.keepInit ?? false;
  const year = options.year ?? new Date().getFullYear();
  const idProblem = validateId(id);
  if (idProblem) throw new Error(idProblem);
  const problems = validateOptions({ name, author, description });
  if (problems.length > 0) throw new Error(problems.join("\n"));
  parseRepo(repo);
  const has = (kind) => kinds.includes(kind);

  const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
  const exists = (rel) => fs.existsSync(path.join(root, rel));
  const writes = new Map();
  const deletes = [];
  const notes = [];

  const pkgText = read("package.json");
  const pkg = JSON.parse(pkgText);
  if (pkg[MARKER] !== "pending") {
    throw new Error(
      `This folder was already initialised (package.json has no "${MARKER}": "pending" marker). Nothing was changed.`,
    );
  }

  // plugin.json: only the sections of the chosen kinds, in the usual order.
  const old = JSON.parse(read("plugin.json"));
  const manifest = {
    id,
    name,
    version: old.version,
    description,
    author,
    icon: old.icon,
    apiVersion: old.apiVersion,
  };
  if (has("store")) {
    manifest.providers = old.providers;
    manifest.permissions = old.permissions;
  }
  if (has("extension")) manifest.extension = old.extension;
  if (has("theme")) {
    manifest.themes = old.themes.map((theme) => ({
      ...theme,
      id,
      name,
      css: `themes/${id}.css`,
    }));
  }
  writes.set("plugin.json", `${JSON.stringify(manifest, null, 2)}\n`);

  // The registry listing.
  const meta = JSON.parse(read("registry/meta.json"));
  writes.set(
    "registry/meta.json",
    `${JSON.stringify(
      {
        ...meta,
        id,
        name,
        summary: summaryFrom(description),
        description,
        author,
        repository: `https://github.com/${repo}`,
        kinds,
      },
      null,
      2,
    )}\n`,
  );

  // Store: Cargo project and Rust sources; otherwise they go.
  const storeFiles = [
    "Cargo.toml",
    "Cargo.lock",
    "build.sh",
    "build.ps1",
    "scripts/build.mjs",
    "src",
    "games.json",
    "store-icon.svg",
  ];
  if (has("store")) {
    let cargo = read("Cargo.toml");
    cargo = replaceOnce(cargo, /^name = "my-plugin"$/m, `name = "${id}"`, "the package name in Cargo.toml");
    cargo = replaceOnce(
      cargo,
      /^description = ".*"$/m,
      `description = ${JSON.stringify(description.replace(/\s+/g, " ").trim())}`,
      "the description in Cargo.toml",
    );
    cargo = replaceOnce(
      cargo,
      /^repository = ".*"$/m,
      `repository = "https://github.com/${repo}"`,
      "the repository in Cargo.toml",
    );
    writes.set("Cargo.toml", cargo);
    const lock = replaceOnce(
      read("Cargo.lock"),
      /(\[\[package\]\]\r?\nname = )"my-plugin"/,
      (_whole, head) => `${head}"${id}"`,
      "the package in Cargo.lock",
    );
    writes.set("Cargo.lock", sortCargoLock(lock));
    let lib = read("src/lib.rs");
    lib = replaceOnce(lib, /^const ID: &str = ".*";$/m, `const ID: &str = ${rustString(id)};`, "ID in src/lib.rs");
    lib = replaceOnce(
      lib,
      /^const NAME: &str = ".*";$/m,
      `const NAME: &str = ${rustString(name)};`,
      "NAME in src/lib.rs",
    );
    writes.set("src/lib.rs", lib);
  } else {
    deletes.push(...storeFiles);
  }

  // Extension: main.js and style.css carry the id as the prefix of their class names.
  if (has("extension")) {
    for (const file of ["main.js", "style.css"]) {
      writes.set(file, read(file).split(PLACEHOLDER_ID).join(id));
    }
  } else {
    deletes.push("main.js", "style.css", "questkeep-plugin.d.ts");
  }

  // Theme: the CSS file is named and written against the plugin's id.
  if (has("theme")) {
    const css = read(`themes/${PLACEHOLDER_ID}.css`).split(PLACEHOLDER_ID).join(id);
    writes.set(`themes/${id}.css`, css);
    if (id !== PLACEHOLDER_ID) deletes.push(`themes/${PLACEHOLDER_ID}.css`);
  } else {
    deletes.push("themes");
  }

  // package.json: its own name, no template marker, no init script.
  const nextPkg = { ...pkg };
  delete nextPkg[MARKER];
  nextPkg.name = id;
  nextPkg.description = `Release tooling of the ${name} Questkeep plugin (no dependencies, Node 24).`;
  nextPkg.scripts = { ...pkg.scripts };
  delete nextPkg.scripts.init;
  if (!has("store")) delete nextPkg.scripts.build;
  writes.set("package.json", `${JSON.stringify(nextPkg, null, 2)}\n`);

  // Text files with kind blocks.
  for (const file of [".github/workflows/ci.yml", ".github/workflows/release.yml", ".gitignore", "docs/RELEASING.md", "THIRD_PARTY_NOTICES.md"]) {
    if (exists(file)) writes.set(file, processBlocks(read(file), kinds));
  }

  // LICENSE: holder and year.
  writes.set(
    "LICENSE",
    replaceOnce(read("LICENSE"), /^Copyright \(c\) .*$/m, `Copyright (c) ${year} ${author}`, "the copyright line in LICENSE"),
  );

  // README.md and AGENTS.md come from the templates for generated plugins.
  const values = {
    id,
    name,
    description,
    author,
    repo,
    zip: `${id}-<version>.zip`,
    kinds: kindsText(kinds),
  };
  for (const file of ["README.md", "AGENTS.md"]) {
    const template = read(`scripts/init-templates/${file}`);
    writes.set(file, fillPlaceholders(processBlocks(template, kinds), values));
  }

  // The first release: one minor changeset (0.0.0 plus minor is 0.1.0, the version in plugin.json).
  writes.set(".changeset/first-release.md", `---\nbump: minor\n---\nFirst release of ${name}.\n`);

  // The template's own files.
  deletes.push(".github/workflows/template-check.yml");
  if (!keepInit) deletes.push("scripts/init.mjs", "scripts/init.test.mjs", "scripts/init-templates");
  else notes.push("--keep-init: scripts/init.mjs, its tests and templates stay (it will not run again).");
  return { writes, deletes, notes };
}

/** Writes the plan into `root`. The folder's own files only: every path is checked. */
export function applyPlan(root, plan) {
  const inside = (rel) => {
    const full = path.resolve(root, rel);
    if (full !== root && !full.startsWith(`${root}${path.sep}`)) throw new Error(`refusing to touch ${rel}`);
    return full;
  };
  // package.json carries the "already initialised" marker, so it is written last of all: until
  // then a run that failed halfway can simply be started again.
  const last = "package.json";
  for (const [rel, text] of plan.writes) {
    if (rel === last) continue;
    const full = inside(rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, text);
  }
  for (const rel of plan.deletes) fs.rmSync(inside(rel), { recursive: true, force: true });
  if (plan.writes.has(last)) fs.writeFileSync(inside(last), plan.writes.get(last));
}

// ---------------------------------------------------------------------------------------------
// Command line

const USAGE = `Usage: node scripts/init.mjs <id> "<Display Name>" [options]

  <id>                     2 to 64 of a-z, 0-9 and "-", not starting with "-" (the plugin id)
  "<Display Name>"         the name shown in Questkeep

Options:
  --kinds <list>           store, extension, theme (comma separated; default: store)
  --author "<name>"        author and license holder (default: git user.name)
  --description "<text>"   what the plugin does (default: a short sentence)
  --repo <owner/repo>      the GitHub repository (default: git remote "origin")
  --yes, -y                take defaults instead of asking
  --dry-run                show what would happen, change nothing
  --keep-init              keep scripts/init.mjs, its tests and templates
  --help, -h               this text
`;

/** Parses the command line. Returns `{ positional, flags }`; throws on unknown flags. */
export function parseArgs(argv) {
  const valued = ["kinds", "author", "description", "repo"];
  const switches = ["yes", "dry-run", "keep-init", "help"];
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-y") flags.yes = true;
    else if (arg === "-h") flags.help = true;
    else if (arg.startsWith("--")) {
      const [rawName, inline] = arg.slice(2).split(/=(.*)/s);
      if (switches.includes(rawName)) flags[rawName] = true;
      else if (valued.includes(rawName)) {
        const value = inline ?? argv[++i];
        if (value === undefined || (inline === undefined && value.startsWith("--"))) {
          throw new Error(`--${rawName} needs a value`);
        }
        flags[rawName] = value;
      } else throw new Error(`Unknown option --${rawName}`);
    } else positional.push(arg);
  }
  return { positional, flags };
}

function git(root, args) {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

function defaultRepo(root, id) {
  const remote = git(root, ["remote", "get-url", "origin"]);
  try {
    if (remote) return parseRepo(remote);
  } catch {
    // Not a GitHub remote: fall through.
  }
  return `OWNER/${id}`;
}

/** Fills in what the command line left out: asks when there is a terminal, else defaults. */
async function complete(root, positional, flags, ask) {
  let [id, name] = positional;
  const interactive = Boolean(ask) && !flags.yes;
  const prompt = async (label, fallback) => {
    if (!interactive) return fallback;
    const answer = (await ask(`${label}${fallback ? ` [${fallback}]` : ""}: `)).trim();
    return answer || fallback;
  };
  if (id === undefined) {
    if (!interactive) throw new Error(`The plugin id is required.\n\n${USAGE}`);
    id = await prompt("Plugin id (lowercase letters, digits, dashes)", "");
  }
  const idProblem = validateId(id);
  if (idProblem) throw new Error(idProblem);
  name = name ?? (await prompt("Display name", nameFromId(id)));
  const kinds = parseKinds(flags.kinds ?? (await prompt("Kinds (store, extension, theme; comma separated)", "store")));
  const author = flags.author ?? (await prompt("Author (also the license holder)", git(root, ["config", "user.name"]) || "Your Name"));
  const description =
    flags.description ?? (await prompt("Description", `A Questkeep ${kindsText(kinds)} plugin.`));
  const repo = parseRepo(flags.repo ?? (await prompt("GitHub repository (owner/repo)", defaultRepo(root, id))));
  return { id, name, kinds, author, description, repo };
}

/** Prints what a plan does. */
function describePlan(plan, root, out) {
  out(`Writes (${plan.writes.size}):`);
  for (const rel of [...plan.writes.keys()].sort()) out(`  ${rel}`);
  const deletes = plan.deletes.filter((rel) => fs.existsSync(path.join(root, rel)));
  out(`Deletes (${deletes.length}):`);
  for (const rel of deletes.sort()) out(`  ${rel}`);
  for (const note of plan.notes) out(note);
}

export async function main(argv, { root = defaultRoot, out = console.log, input = process.stdin } = {}) {
  const { positional, flags } = parseArgs(argv);
  if (flags.help) {
    out(USAGE);
    return 0;
  }
  if (positional.length > 2) throw new Error(`Too many arguments: ${positional.slice(2).join(" ")}\n\n${USAGE}`);
  // Refuse early (before asking questions) when this folder was initialised already.
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  if (pkg[MARKER] !== "pending") {
    throw new Error(
      `This folder was already initialised (package.json has no "${MARKER}": "pending" marker). Nothing was changed.`,
    );
  }
  let rl;
  let ask;
  if (input.isTTY && !flags.yes) {
    rl = readline.createInterface({ input, output: process.stdout });
    ask = (question) => rl.question(question);
  }
  let options;
  try {
    options = await complete(root, positional, flags, ask);
  } finally {
    rl?.close();
  }
  const plan = planInit(root, { ...options, keepInit: Boolean(flags["keep-init"]) });
  if (flags["dry-run"]) {
    out(`Dry run: ${options.id} (${options.name}), kinds: ${options.kinds.join(", ")}, repository ${options.repo}`);
    describePlan(plan, root, out);
    out("Nothing was changed.");
    return 0;
  }
  applyPlan(root, plan);
  out(`Created the plugin "${options.name}" (${options.id}) with: ${kindsText(options.kinds)}.`);
  if (options.repo.startsWith("OWNER/")) {
    out(`Note: the repository is a placeholder (${options.repo}). Fix "repository" in registry/meta.json${options.kinds.includes("store") ? " and Cargo.toml" : ""}.`);
  }
  out("");
  out("Next steps:");
  out("  npm test                              the checks of the release tooling");
  if (options.kinds.includes("store")) out("  npm run build                         build provider.wasm (rustup target add wasm32-wasip2)");
  out("  node scripts/pack.mjs                 the zip in dist/");
  out("  Questkeep > Settings > Plugins > Install from folder... to try it; turn on Reload on change.");
  out("  See README.md and docs/RELEASING.md.");
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error(`error: ${error.message}`);
      process.exit(1);
    },
  );
}
