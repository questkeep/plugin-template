import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { checkIconFile, manifestKinds, validateManifest } from "./manifest.mjs";
import { pack, packageFiles } from "./pack.mjs";
import { createZip, listZip } from "./zip.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (file) => JSON.parse(fs.readFileSync(path.join(repo, file), "utf8"));

/** A folder holding a plugin: `files` maps relative paths to content. */
function plugin(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-pack-"));
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), content);
  }
  return root;
}

test("this repository's plugin.json is valid (provider.wasm is not required here)", () => {
  const manifest = readJson("plugin.json");
  const present = (rel) => rel === "provider.wasm" || fs.existsSync(path.join(repo, rel));
  assert.deepEqual(validateManifest(manifest, present), []);
  assert.equal(manifest.apiVersion, 1);
  if (manifest.icon) {
    assert.deepEqual(checkIconFile(manifest.icon, fs.readFileSync(path.join(repo, manifest.icon))), []);
  }
});

test("registry/meta.json agrees with plugin.json", () => {
  const manifest = readJson("plugin.json");
  const meta = readJson("registry/meta.json");
  assert.equal(meta.id, manifest.id);
  assert.equal(meta.name, manifest.name);
  assert.deepEqual([...meta.kinds].sort(), manifestKinds(manifest).sort());
  assert.match(meta.repository, /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
  assert.ok(meta.summary.length <= 120 && !/[\r\n]/.test(meta.summary));
  assert.match(fs.readFileSync(path.join(repo, "registry/min-app"), "utf8").trim(), /^\d+\.\d+\.\d+$/);
});

test("validateManifest checks permissions.folders like the host", () => {
  const base = {
    id: "my-store",
    name: "X",
    version: "1.0.0",
    apiVersion: 1,
    providers: [{ wasm: "provider.wasm" }],
  };
  const folder = { key: "games", label: "Games", as: "/games", default: "~/Games" };
  const check = (folders, read = []) => validateManifest({ ...base, permissions: { read, folders } });
  assert.deepEqual(check([folder]), []);
  assert.ok(check([{ ...folder, key: "Games" }]).length > 0);
  assert.ok(check([{ ...folder, label: " " }]).length > 0);
  assert.ok(check([{ ...folder, default: "" }]).length > 0);
  assert.ok(check([{ ...folder, as: "/data" }]).length > 0);
  assert.ok(check([{ ...folder, as: "/plugin/x" }]).length > 0);
  assert.ok(check([{ ...folder, as: "/a/../b" }]).length > 0);
  assert.ok(check([folder, { ...folder, as: "/other" }]).length > 0);
  assert.ok(check([folder], [{ path: "~/X", as: "/games" }]).length > 0);
});

test("validateManifest follows the host's rules", () => {
  const ok = {
    id: "my-store",
    name: "X",
    version: "1.0.0",
    apiVersion: 1,
    providers: [{ wasm: "provider.wasm" }],
    permissions: { read: [{ path: "~/X", as: "/x" }], http: ["*.example.com", "http://localhost"] },
  };
  assert.deepEqual(validateManifest(ok), []);
  const bad = (change) => validateManifest({ ...ok, ...change }).length > 0;
  assert.ok(bad({ id: "A" }));
  assert.ok(bad({ id: "-ab" }));
  assert.ok(bad({ id: "a" }));
  assert.ok(bad({ version: "1.0" }));
  assert.ok(bad({ apiVersion: 2 }));
  assert.ok(bad({ providers: [{ wasm: "../x.wasm" }] }));
  assert.ok(bad({ providers: [{ wasm: "C:/x.wasm" }] }));
  assert.ok(bad({ providers: [{ wasm: "/x.wasm" }] }));
  assert.ok(bad({ permissions: { read: [{ path: "a", as: "/data" }] } }));
  assert.ok(bad({ permissions: { read: [{ path: "a", as: "x" }] } }));
  assert.ok(bad({ permissions: { read: [{ path: "a", as: "/x" }, { path: "b", as: "/x" }] } }));
  assert.ok(bad({ permissions: { http: ["not a host"] } }));
  assert.ok(validateManifest(ok, () => false).length > 0);
});

test("validateManifest checks icon, extension and themes", () => {
  const base = { id: "my-theme", name: "X", version: "1.0.0", apiVersion: 1 };
  const theme = { id: "my-theme", name: "T", css: "themes/t.css" };
  assert.ok(validateManifest(base).some((p) => /brings nothing/.test(p)));
  assert.deepEqual(validateManifest({ ...base, themes: [theme] }), []);
  assert.deepEqual(validateManifest({ ...base, themes: [{ ...theme, id: "my-theme-dusk" }] }), []);
  const bad = (change) => validateManifest({ ...base, themes: [theme], ...change }).length > 0;
  assert.ok(bad({ themes: [{ ...theme, id: "other" }] }), "foreign theme id");
  assert.ok(bad({ themes: [{ ...theme, id: "my-themex" }] }), "prefix without a dash");
  assert.ok(bad({ themes: [{ ...theme, css: "../x.css" }] }));
  assert.ok(bad({ themes: [{ ...theme, name: "" }] }));
  assert.ok(bad({ themes: [theme, theme] }), "same theme twice");
  assert.ok(bad({ icon: "icon.gif" }));
  assert.ok(bad({ icon: "../icon.svg" }));
  assert.ok(!bad({ icon: "icon.PNG" }));
  assert.ok(bad({ extension: { main: "../main.js" } }));
  assert.ok(bad({ extension: { styles: ["a.css"] } }), "extension without main");
  assert.ok(bad({ extension: { main: "main.js", settings: [{ key: "a", label: "A", type: "wat" }] } }));
  assert.ok(bad({ extension: { main: "main.js", settings: [{ key: "a", label: "A", type: "select" }] } }));
  assert.ok(
    bad({
      extension: {
        main: "main.js",
        settings: [
          { key: "a", label: "A", type: "toggle" },
          { key: "a", label: "B", type: "text" },
        ],
      },
    }),
    "repeated setting key",
  );
  assert.ok(!bad({ extension: { main: "main.js", styles: ["s.css"], settings: [{ key: "a", label: "A", type: "toggle" }] } }));
  // Every file the manifest names must exist.
  const exists = (rel) => rel !== "themes/t.css";
  assert.ok(validateManifest({ ...base, themes: [theme] }, exists).some((p) => /themes\/t\.css/.test(p)));
});

test("checkIconFile follows the host's icon rules", () => {
  const svg = (body) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg">${body}</svg>`);
  assert.deepEqual(checkIconFile("icon.svg", svg("<circle/>")), []);
  assert.ok(checkIconFile("icon.svg", svg("<script>x</script>")).length > 0);
  assert.ok(checkIconFile("icon.svg", svg('<a href="javascript:x"/>')).length > 0);
  assert.ok(checkIconFile("icon.svg", svg('<circle onclick="x"/>')).length > 0);
  assert.ok(checkIconFile("icon.svg", Buffer.from("not an svg")).length > 0);
  assert.ok(checkIconFile("icon.svg", Buffer.alloc(201 * 1024, "a")).length > 0);
  assert.ok(checkIconFile("icon.png", Buffer.from("nope")).length > 0);
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
  assert.deepEqual(checkIconFile("icon.png", png), []);
});

test("pack writes a zip with the plugin's files at the top level", () => {
  const manifest = {
    id: "demo-plugin",
    name: "Demo",
    version: "1.2.3",
    icon: "icon.svg",
    apiVersion: 1,
    providers: [{ wasm: "provider.wasm" }],
    extension: { main: "main.js", styles: ["style.css"] },
    themes: [{ id: "demo-plugin", name: "Demo", css: "themes/demo-plugin.css" }],
  };
  const root = plugin({
    "plugin.json": JSON.stringify(manifest),
    "provider.wasm": "wasm",
    "main.js": "export function activate() {}",
    "style.css": ".x{}",
    "themes/demo-plugin.css": ":root{}",
    "icon.svg": "<svg></svg>",
    "README.md": "readme",
    LICENSE: "license",
    "src/lib.rs": "not shipped",
    "questkeep-plugin.d.ts": "not shipped",
  });
  try {
    const result = pack(root);
    assert.equal(result.name, "demo-plugin-1.2.3.zip");
    assert.match(result.sha256, /^[0-9a-f]{64}$/);
    const zip = fs.readFileSync(result.file);
    assert.equal(zip.length, result.size);
    assert.deepEqual(listZip(zip), [
      "plugin.json",
      "LICENSE",
      "README.md",
      "icon.svg",
      "main.js",
      "provider.wasm",
      "style.css",
      "themes/demo-plugin.css",
    ]);
    assert.ok(listZip(zip).every((n) => !n.includes("\\")));
    fs.rmSync(path.join(root, "provider.wasm"));
    assert.throws(() => pack(root), /provider\.wasm/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("pack.include adds files and folders, and refuses paths outside the plugin", () => {
  const manifest = { id: "demo-plugin", name: "Demo", version: "1.0.0", apiVersion: 1, extension: { main: "main.js" } };
  const root = plugin({
    "plugin.json": JSON.stringify(manifest),
    "main.js": "",
    "README.md": "r",
    LICENSE: "l",
    "package.json": JSON.stringify({ pack: { include: ["assets", "lib/helper.js"] } }),
    "assets/a/b.png": "png",
    "assets/c.svg": "<svg/>",
    "lib/helper.js": "export {}",
    "lib/other.js": "not listed",
  });
  try {
    assert.deepEqual(packageFiles(root, manifest), [
      "plugin.json",
      "LICENSE",
      "README.md",
      "assets/a/b.png",
      "assets/c.svg",
      "lib/helper.js",
      "main.js",
    ]);
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ pack: { include: ["../x"] } }));
    assert.throws(() => packageFiles(root, manifest), /inside the plugin folder/);
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ pack: { include: ["nope"] } }));
    assert.throws(() => packageFiles(root, manifest), /does not exist/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("pack refuses an invalid plugin.json and a bad icon", () => {
  const manifest = { id: "Bad Id", name: "X", version: "1.0.0", apiVersion: 1, extension: { main: "main.js" } };
  const root = plugin({ "plugin.json": JSON.stringify(manifest), "main.js": "", "README.md": "r", LICENSE: "l" });
  try {
    assert.throws(() => pack(root), /plugin id/);
    fs.writeFileSync(path.join(root, "plugin.json"), JSON.stringify({ ...manifest, id: "good-id", icon: "icon.svg" }));
    fs.writeFileSync(path.join(root, "icon.svg"), "<svg><script></script></svg>");
    assert.throws(() => pack(root), /script/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("createZip is deterministic and rejects backslash names", () => {
  const entries = [{ name: "a.txt", data: Buffer.from("hello") }];
  assert.deepEqual(createZip(entries), createZip(entries));
  assert.throws(() => createZip([{ name: "a\\b.txt", data: Buffer.alloc(0) }]));
});
