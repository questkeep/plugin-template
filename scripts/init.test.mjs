import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  KINDS,
  kindsText,
  nameFromId,
  parseArgs,
  parseKinds,
  parseRepo,
  processBlocks,
  rustString,
  sortCargoLock,
  summaryFrom,
  validateId,
  fillPlaceholders,
} from "./init.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ---------------------------------------------------------------------------------------------
// Pure helpers

test("validateId is the host's rule", () => {
  for (const ok of ["ab", "a1", "my-plugin", "0day", "a-b-c", "x".repeat(64)]) {
    assert.equal(validateId(ok), null, ok);
  }
  for (const bad of ["", "a", "-ab", "My-Plugin", "my_plugin", "my plugin", "x".repeat(65), "ünï", "a/b", undefined]) {
    assert.match(validateId(bad), /not valid/, String(bad));
  }
});

test("parseKinds orders, validates and rejects", () => {
  assert.deepEqual(parseKinds("theme, store"), ["store", "theme"]);
  assert.deepEqual(parseKinds("EXTENSION"), ["extension"]);
  assert.deepEqual(parseKinds(KINDS.join(",")), KINDS);
  assert.throws(() => parseKinds(""), /at least one/);
  assert.throws(() => parseKinds("store,wat"), /Unknown kind "wat"/);
  assert.throws(() => parseKinds("store,store"), /twice/);
  assert.equal(kindsText(["store"]), "store");
  assert.equal(kindsText(KINDS), "store, extension and theme");
});

test("parseRepo accepts owner/repo, URLs and ssh remotes", () => {
  for (const same of [
    "acme/tool",
    "https://github.com/acme/tool",
    "https://github.com/acme/tool.git",
    "git@github.com:acme/tool.git",
    " acme/tool ",
  ]) {
    assert.equal(parseRepo(same), "acme/tool", same);
  }
  assert.throws(() => parseRepo("acme"), /owner\/repo/);
  assert.throws(() => parseRepo("https://gitlab.com/a/b"), /owner\/repo/);
  assert.throws(() => parseRepo("a/b/c"), /owner\/repo/);
});

test("names, summaries and Rust literals", () => {
  assert.equal(nameFromId("my-cool-plugin"), "My Cool Plugin");
  assert.equal(summaryFrom("Short."), "Short.");
  assert.equal(summaryFrom("A".repeat(300)).length, 120);
  assert.equal(summaryFrom(`First sentence. ${"x ".repeat(100)}`), "First sentence.");
  assert.ok(summaryFrom("word ".repeat(60)).length <= 120);
  assert.equal(rustString('Say "hi" \\ there'), '"Say \\"hi\\" \\\\ there"');
});

test("processBlocks keeps the chosen kinds and always drops the marker lines", () => {
  const text = [
    "a",
    "# @kind:store",
    "b",
    "# @kind:extension,theme",
    "c",
    "# @end",
    "d",
    "# @end",
    "<!-- @kind:theme -->",
    "e",
    "<!-- @end -->",
    "// @kind:extension",
    "f",
    "// @end",
    "g",
  ].join("\n");
  assert.equal(processBlocks(text, ["store"]), "a\nb\nd\ng");
  assert.equal(processBlocks(text, ["extension"]), "a\nf\ng");
  assert.equal(processBlocks(text, ["store", "theme"]), "a\nb\nc\nd\ne\ng");
  assert.equal(processBlocks(text, KINDS), "a\nb\nc\nd\ne\nf\ng");
  // Prose that merely mentions the markers is left alone.
  assert.equal(processBlocks('say "# @kind:store" in prose', []), 'say "# @kind:store" in prose');
  assert.throws(() => processBlocks("# @end", KINDS), /without a block/);
  assert.throws(() => processBlocks("# @kind:store\nx", KINDS), /not closed/);
  assert.throws(() => processBlocks("# @kind:wat\n# @end", KINDS), /unknown kind/);
  // CRLF files keep their line ends.
  assert.equal(processBlocks("a\r\n# @kind:store\r\nb\r\n# @end\r\nc", []), "a\r\nc");
});

test("fillPlaceholders fills known keys and rejects unknown ones", () => {
  assert.equal(fillPlaceholders("{{a}} and {{b}} {{a}}", { a: "1", b: "$&" }), "1 and $& 1");
  assert.throws(() => fillPlaceholders("{{nope}}", {}), /unknown placeholder/);
});

test("sortCargoLock puts a renamed package where cargo wants it", () => {
  const lock = [
    "# header",
    "version = 4",
    "",
    '[[package]]',
    'name = "aaa"',
    'version = "1.0.0"',
    "",
    '[[package]]',
    'name = "zzz-plugin"',
    'version = "0.1.0"',
    'dependencies = [',
    ' "aaa",',
    "]",
    "",
    '[[package]]',
    'name = "mmm"',
    'version = "1.0.0"',
    "",
  ].join("\n");
  const names = [...sortCargoLock(lock).matchAll(/^name = "(.*)"$/gm)].map((m) => m[1]);
  assert.deepEqual(names, ["aaa", "mmm", "zzz-plugin"]);
  assert.ok(sortCargoLock(lock).startsWith("# header\nversion = 4\n\n[[package]]"));
  assert.ok(sortCargoLock(lock).endsWith("\n") && !sortCargoLock(lock).endsWith("\n\n"));
});

test("parseArgs", () => {
  const { positional, flags } = parseArgs(["my-id", "My Name", "--kinds", "store", "--author=Me", "-y", "--dry-run"]);
  assert.deepEqual(positional, ["my-id", "My Name"]);
  assert.deepEqual(flags, { kinds: "store", author: "Me", yes: true, "dry-run": true });
  assert.throws(() => parseArgs(["--nope"]), /Unknown option/);
  assert.throws(() => parseArgs(["--kinds"]), /needs a value/);
});

// ---------------------------------------------------------------------------------------------
// The command line, in a temporary copy of this repository

const SKIP = new Set([".git", "target", "node_modules", "dist", "provider.wasm"]);

function copyTemplate() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-template-"));
  fs.cpSync(repo, dir, {
    recursive: true,
    filter: (src) => !SKIP.has(path.basename(src)),
  });
  return dir;
}

/** Every file below `dir` as sorted relative paths with forward slashes. */
function files(dir, rel = "") {
  return fs
    .readdirSync(path.join(dir, rel), { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? files(dir, `${rel}${e.name}/`) : [`${rel}${e.name}`]))
    .sort();
}

function snapshot(dir) {
  return files(dir).map((f) => `${f} ${createHash("sha256").update(fs.readFileSync(path.join(dir, f))).digest("hex")}`);
}

function runInit(dir, args, options = {}) {
  return spawnSync(process.execPath, [path.join(dir, "scripts", "init.mjs"), ...args], {
    cwd: dir,
    encoding: "utf8",
    input: "",
    ...options,
  });
}

const COMBINATIONS = [
  ["store"],
  ["extension"],
  ["theme"],
  ["store", "extension"],
  ["store", "theme"],
  ["extension", "theme"],
  ["store", "extension", "theme"],
];

const TEXT_FILE = /\.(md|json|toml|lock|yml|mjs|js|css|svg|rs|sh|ps1|ts)$|^LICENSE$|^\.gitignore$/;

for (const kinds of COMBINATIONS) {
  test(`init --kinds ${kinds.join(",")} produces a consistent, valid plugin`, async () => {
    const dir = copyTemplate();
    try {
      const run = runInit(dir, [
        "demo-plugin",
        'Demo "Plugin"',
        "--kinds",
        kinds.join(","),
        "--author",
        "Ada Lovelace",
        "--description",
        "Does demo things.",
        "--repo",
        "https://github.com/acme/demo-plugin.git",
        "--yes",
      ]);
      assert.equal(run.status, 0, run.stderr + run.stdout);
      const result = files(dir);
      const has = (kind) => kinds.includes(kind);
      const present = (f) => result.includes(f) || result.some((r) => r.startsWith(`${f}/`));

      // Files of the kinds that were chosen exist, the others are gone.
      const storeFiles = ["Cargo.toml", "Cargo.lock", "build.sh", "build.ps1", "scripts/build.mjs", "src/lib.rs", "src/games.rs", "games.json", "store-icon.svg"];
      for (const f of storeFiles) assert.equal(present(f), has("store"), f);
      for (const f of ["main.js", "style.css", "questkeep-plugin.d.ts"]) assert.equal(present(f), has("extension"), f);
      assert.equal(present("themes/demo-plugin.css"), has("theme"));
      assert.equal(present("themes/my-plugin.css"), false);
      for (const f of [
        "plugin.json",
        "icon.svg",
        "README.md",
        "AGENTS.md",
        "LICENSE",
        "THIRD_PARTY_NOTICES.md",
        "package.json",
        "mise.toml",
        ".gitignore",
        ".editorconfig",
        ".changeset/README.md",
        ".changeset/first-release.md",
        ".github/workflows/ci.yml",
        ".github/workflows/release.yml",
        "docs/RELEASING.md",
        "registry/meta.json",
        "registry/min-app",
        "scripts/pack.mjs",
        "scripts/manifest.mjs",
        "scripts/zip.mjs",
        "scripts/pack.test.mjs",
        "scripts/release/changeset.mjs",
        "scripts/release/lib.mjs",
        "scripts/release/registry-entry.mjs",
        "scripts/release/retry.sh",
      ]) {
        assert.ok(present(f), `${f} should exist`);
      }
      // Init removed itself and the template's own workflow.
      for (const f of ["scripts/init.mjs", "scripts/init.test.mjs", "scripts/init-templates", ".github/workflows/template-check.yml"]) {
        assert.equal(present(f), false, `${f} should be gone`);
      }

      // plugin.json has exactly the sections of the chosen kinds.
      const manifest = JSON.parse(fs.readFileSync(path.join(dir, "plugin.json"), "utf8"));
      assert.equal(manifest.id, "demo-plugin");
      assert.equal(manifest.name, 'Demo "Plugin"');
      assert.equal(manifest.author, "Ada Lovelace");
      assert.equal(manifest.description, "Does demo things.");
      assert.equal(manifest.icon, "icon.svg");
      assert.equal(manifest.apiVersion, 1);
      assert.equal("providers" in manifest, has("store"));
      assert.equal("permissions" in manifest, has("store"));
      assert.equal("extension" in manifest, has("extension"));
      assert.equal("themes" in manifest, has("theme"));
      if (has("theme")) {
        assert.equal(manifest.themes[0].id, "demo-plugin");
        assert.equal(manifest.themes[0].css, "themes/demo-plugin.css");
        const css = fs.readFileSync(path.join(dir, "themes/demo-plugin.css"), "utf8");
        assert.ok(css.includes(':root[data-theme="demo-plugin"]'));
      }
      if (has("store")) {
        assert.deepEqual(manifest.permissions.folders.map((f) => f.key), ["games"]);
        assert.deepEqual(manifest.permissions.http, []);
      }

      // The generated manifest passes this repository's own checker (the one the copy keeps).
      const checker = await import(pathToFileURL(path.join(dir, "scripts", "manifest.mjs")).href);
      const exists = (rel) => rel === "provider.wasm" || fs.existsSync(path.join(dir, rel));
      assert.deepEqual(checker.validateManifest(manifest, exists), []);
      assert.deepEqual(checker.manifestKinds(manifest), kinds);

      // The registry listing matches.
      const meta = JSON.parse(fs.readFileSync(path.join(dir, "registry/meta.json"), "utf8"));
      assert.equal(meta.id, "demo-plugin");
      assert.equal(meta.repository, "https://github.com/acme/demo-plugin");
      assert.deepEqual(meta.kinds, kinds);
      assert.equal(meta.author, "Ada Lovelace");

      // package.json: no marker, no init script, `build` only for stores.
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
      assert.equal(pkg.questkeepTemplate, undefined);
      assert.equal(pkg.scripts.init, undefined);
      assert.equal("build" in pkg.scripts, has("store"));
      assert.equal(pkg.name, "demo-plugin");

      // No placeholder or marker survives in any text file.
      for (const f of result.filter((r) => TEXT_FILE.test(path.basename(r)) || TEXT_FILE.test(r))) {
        const text = fs.readFileSync(path.join(dir, f), "utf8");
        assert.ok(!text.includes("my-plugin"), `${f} still says my-plugin`);
        assert.ok(!text.includes("My Plugin"), `${f} still says My Plugin`);
        assert.ok(!text.includes("OWNER/"), `${f} still has OWNER/`);
        assert.ok(!/\{\{\w+\}\}/.test(text), `${f} has a placeholder`);
        assert.ok(!/@kind:|^\s*(#|\/\/|<!--)\s*@end/m.test(text), `${f} has a block marker`);
      }

      // Workflows: Rust steps only for stores, extension step only for extensions.
      const ci = fs.readFileSync(path.join(dir, ".github/workflows/ci.yml"), "utf8");
      const release = fs.readFileSync(path.join(dir, ".github/workflows/release.yml"), "utf8");
      for (const [text, what] of [[ci, "ci"], [release, "release"]]) {
        assert.equal(text.includes("wasm32-wasip2"), false, `${what}: the toolchain comes from mise.toml`);
        assert.ok(!text.includes("rust-toolchain"), `${what}: the toolchain comes from mise.toml`);
      }
      // mise.toml: Node always, Rust (with the wasm target) only for stores.
      const mise = fs.readFileSync(path.join(dir, "mise.toml"), "utf8");
      assert.ok(mise.includes("node ="), "mise: node");
      assert.equal(mise.includes("rust ="), has("store"), "mise: rust");
      assert.equal(mise.includes("wasm32-wasip2"), has("store"), "mise: wasm target");
      assert.equal(ci.includes("cargo clippy"), has("store"));
      assert.equal(ci.includes("node --check main.js"), has("extension"));
      assert.equal(release.includes("git add Cargo.toml Cargo.lock"), has("store"));
      assert.ok(release.includes("git add .changeset plugin.json"));
      assert.ok(ci.includes("node scripts/pack.mjs"));

      // Cargo files: the package carries the id, the lock stays sorted for cargo.
      if (has("store")) {
        const cargo = fs.readFileSync(path.join(dir, "Cargo.toml"), "utf8");
        assert.match(cargo, /^name = "demo-plugin"$/m);
        assert.match(cargo, /^repository = "https:\/\/github\.com\/acme\/demo-plugin"$/m);
        assert.match(cargo, /^description = "Does demo things\."$/m);
        const lock = fs.readFileSync(path.join(dir, "Cargo.lock"), "utf8");
        const names = [...lock.matchAll(/^name = "(.*)"$/gm)].map((m) => m[1]);
        assert.deepEqual(names, [...names].sort());
        assert.ok(names.includes("demo-plugin") && !names.includes("my-plugin"));
        const lib = fs.readFileSync(path.join(dir, "src/lib.rs"), "utf8");
        assert.ok(fs.readFileSync(path.join(dir, ".gitignore"), "utf8").includes("/target/"));
        assert.match(lib, /^const NAME: &str = "Demo \\"Plugin\\"";$/m);
        assert.ok(!/^\/target\/$/m.test("") && fs.readFileSync(path.join(dir, ".gitignore"), "utf8").includes("/target/"));
      } else {
        assert.ok(!fs.readFileSync(path.join(dir, ".gitignore"), "utf8").includes("/target/"));
      }

      // LICENSE holder and year.
      assert.match(fs.readFileSync(path.join(dir, "LICENSE"), "utf8"), /^Copyright \(c\) \d{4} Ada Lovelace$/m);

      // The first release changeset exists and is valid.
      const lib = await import(pathToFileURL(path.join(dir, "scripts/release/lib.mjs")).href);
      const changeset = lib.parseChangeset(fs.readFileSync(path.join(dir, ".changeset/first-release.md"), "utf8"));
      assert.equal(changeset.bump, "minor");
      assert.equal(lib.nextVersion("0.0.0", [changeset]), manifest.version);

      // The README and AGENTS.md describe the plugin.
      const readme = fs.readFileSync(path.join(dir, "README.md"), "utf8");
      assert.ok(readme.startsWith('# Demo "Plugin"\n'));
      assert.ok(readme.includes("demo-plugin-<version>.zip") && readme.includes("acme/demo-plugin"));
      assert.equal(readme.includes("## The store"), has("store"));
      assert.equal(readme.includes("## The extension"), has("extension"));
      assert.equal(readme.includes("## The theme"), has("theme"));
      assert.equal(readme.includes("cargo clippy"), has("store"));
      const agents = fs.readFileSync(path.join(dir, "AGENTS.md"), "utf8");
      assert.equal(agents.includes("src/games.rs"), has("store"));
      assert.equal(agents.includes("main.js"), has("extension"));
      assert.equal(agents.includes("themes/demo-plugin.css"), has("theme"));

      // It packs (a store needs its component first), into <id>-<version>.zip.
      if (has("store")) fs.writeFileSync(path.join(dir, "provider.wasm"), "\0asm");
      const packer = await import(pathToFileURL(path.join(dir, "scripts", "pack.mjs")).href);
      const packed = packer.pack(dir);
      assert.equal(packed.name, "demo-plugin-0.1.0.zip");
      assert.ok(packed.files.includes("plugin.json") && packed.files.includes("LICENSE"));
      assert.equal(packed.files.includes("provider.wasm"), has("store"));
      assert.equal(packed.files.includes("main.js"), has("extension"));
      assert.equal(packed.files.includes("themes/demo-plugin.css"), has("theme"));

      // A second run refuses.
      const again = runInit(dir, ["other-id", "Other", "--yes"]);
      assert.notEqual(again.status, 0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}

test("--dry-run changes nothing and lists what would happen", () => {
  const dir = copyTemplate();
  try {
    const before = snapshot(dir);
    const run = runInit(dir, ["demo-plugin", "Demo", "--kinds", "theme", "--yes", "--dry-run"]);
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /Dry run/);
    assert.match(run.stdout, /themes\/demo-plugin\.css/);
    assert.match(run.stdout, /Cargo\.toml/);
    assert.match(run.stdout, /Nothing was changed/);
    assert.deepEqual(snapshot(dir), before);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("invalid input is refused before anything is written", () => {
  const dir = copyTemplate();
  try {
    const before = snapshot(dir);
    const fails = (args, pattern) => {
      const run = runInit(dir, [...args, "--yes"]);
      assert.notEqual(run.status, 0, args.join(" "));
      assert.match(run.stderr, pattern, args.join(" "));
      assert.deepEqual(snapshot(dir), before, `${args.join(" ")} changed files`);
    };
    fails(["Bad_Id", "Name"], /not valid/);
    fails(["-bad", "Name"], /not valid/);
    fails(["a", "Name"], /not valid/);
    fails(["good-id", "Name", "--kinds", "nope"], /Unknown kind/);
    fails(["good-id", "Name", "--kinds", ""], /at least one|needs a value/);
    fails(["good-id", "Name", "--repo", "not a repo"], /owner\/repo/);
    fails(["good-id", "N".repeat(65)], /longer than 64/);
    fails(["good-id", "Name", "--description", "x".repeat(2001)], /2000/);
    fails(["good-id", "Name", "--bogus"], /Unknown option/);
    // Without a terminal the id cannot be asked for.
    const noId = runInit(dir, ["--yes"]);
    assert.notEqual(noId.status, 0);
    assert.match(noId.stderr, /id is required/);
    assert.deepEqual(snapshot(dir), before);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("defaults: name from the id, store, and git's author and origin", () => {
  const dir = copyTemplate();
  try {
    const git = (...args) => spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    git("init", "-q", "-b", "main");
    git("config", "user.name", "Grace Hopper");
    git("remote", "add", "origin", "git@github.com:acme/cool-thing.git");
    const run = runInit(dir, ["cool-thing", "--yes"]);
    assert.equal(run.status, 0, run.stderr);
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, "plugin.json"), "utf8"));
    assert.equal(manifest.name, "Cool Thing");
    assert.equal(manifest.author, "Grace Hopper");
    assert.ok("providers" in manifest && !("extension" in manifest) && !("themes" in manifest));
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "registry/meta.json"), "utf8")).repository, "https://github.com/acme/cool-thing");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("--keep-init keeps init, its tests and templates but still refuses a second run", () => {
  const dir = copyTemplate();
  try {
    const run = runInit(dir, ["demo-plugin", "Demo", "--kinds", "extension", "--yes", "--keep-init"]);
    assert.equal(run.status, 0, run.stderr);
    const result = files(dir);
    assert.ok(result.includes("scripts/init.mjs") && result.includes("scripts/init.test.mjs"));
    assert.ok(result.includes("scripts/init-templates/README.md"));
    assert.ok(!result.includes(".github/workflows/template-check.yml"));
    const again = runInit(dir, ["demo-plugin", "Demo", "--yes"]);
    assert.notEqual(again.status, 0);
    assert.match(again.stderr, /already initialised/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("init touches nothing outside its folder", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-template-parent-"));
  try {
    fs.writeFileSync(path.join(parent, "sibling.txt"), "keep me");
    const dir = path.join(parent, "inner");
    fs.cpSync(repo, dir, { recursive: true, filter: (src) => !SKIP.has(path.basename(src)) });
    const run = runInit(dir, ["demo-plugin", "Demo", "--yes"]);
    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(fs.readdirSync(parent).sort(), ["inner", "sibling.txt"]);
    assert.equal(fs.readFileSync(path.join(parent, "sibling.txt"), "utf8"), "keep me");
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});
