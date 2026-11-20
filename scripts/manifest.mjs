// Checks a plugin.json against the rules of Questkeep's plugin host. Pure: no I/O.
//
// The rule list, with where each rule lives in the Questkeep repository
// (https://github.com/questkeep/questkeep):
//
//   crates/questkeep-plugins/src/manifest.rs  (`PluginManifest::validate`, `check_mount`,
//                                              `check_relative`, `check_icon_path`, `HostRule`)
//     - id: 2 to 64 of [a-z0-9-], not starting with a dash
//     - name is not blank; version is not blank; apiVersion equals API_VERSION (1)
//     - every provider's `wasm`, `icon`, `extension.main` and every theme's `css` is a plain path
//       inside the plugin folder: not blank, no ":", no leading "/" or "\", no ".." part
//     - `icon` names an .svg or .png
//     - permissions.read: a non-blank `path`, a mount name (`as`) that is an absolute path of plain
//       parts (no "", ".", "..", backslash, colon or control character), is not /plugin or /data
//       (or below them) and is unique across `read` and `folders`
//     - permissions.folders: `key` is 1 to 32 of [a-z0-9-] and unique, `label` is not blank,
//       `default` (when given) is not blank, `as` follows the mount rules above
//     - permissions.http: each entry is a host rule (`api.example.com`, `*.example.com`,
//       `http://localhost`)
//   ui/src/lib/pluginThemes.ts  (`parseThemeEntry`): a theme has an id of 2 to 64 of [a-z0-9-] that
//       is the plugin's id or starts with it and a dash, a name, and a `css` path of plain parts
//   ui/src/lib/extensions/declaredSettings.ts  (`normalizeSettings`): the host silently drops a
//       declared setting without key or label, with an unknown type, with a repeated key, or a
//       select without options. Here that is a problem, because it is a mistake.
//
// Stricter than the host, on purpose (the registry and the release tooling need them):
//   - `version` must be X.Y.Z (the registry wants semver; the host only wants it non-blank)
//   - `extension.styles` entries are checked like other plugin paths
//   - a plugin must bring at least one of a store, an extension or a theme
//
// The icon's content (size, PNG signature, SVG without scripts) is checked by `checkIconFile`.

export const API_VERSION = 1;
export const MAX_ICON_BYTES = 200 * 1024;
export const SETTING_TYPES = ["toggle", "text", "number", "select", "color"];

const ID_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;
const FOLDER_KEY_RE = /^[a-z0-9-]{1,32}$/;

export const isValidId = (id) => typeof id === "string" && ID_RE.test(id);

/** A path inside the plugin folder: relative, no drive, no root, no `..` part. */
export const isPlainRelative = (p) =>
  typeof p === "string" &&
  p.trim() !== "" &&
  !p.includes(":") &&
  !/^[/\\]/.test(p) &&
  !p.split(/[/\\]/).some((part) => part === "..");

function checkMount(mount) {
  const parts = String(mount).split("/");
  const plain =
    String(mount).startsWith("/") &&
    parts.length >= 2 &&
    parts
      .slice(1)
      .every((p) => p !== "" && p !== "." && p !== ".." && !/[\\:\u0000-\u001f]/.test(p));
  if (!plain) return `The folder name "${mount}" is not valid: use an absolute path such as /store.`;
  if (["/plugin", "/data"].some((r) => mount === r || mount.startsWith(`${r}/`))) {
    return `The folder name "${mount}" is taken: /plugin and /data belong to the plugin itself.`;
  }
  return null;
}

function checkHost(host) {
  const rest = String(host)
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^\*\./, "");
  return (
    rest !== "" &&
    rest.length <= 253 &&
    rest
      .split(".")
      .every((l) => l !== "" && !l.startsWith("-") && !l.endsWith("-") && /^[a-z0-9_-]+$/.test(l))
  );
}

/**
 * Returns a list of problems (empty when the manifest is valid). `fileExists(relativePath)` is
 * asked for every file the manifest names (store components, the extension's main file and
 * styles, theme CSS, the icon).
 */
export function validateManifest(manifest, fileExists = () => true) {
  const problems = [];
  const add = (message) => problems.push(message);
  if (typeof manifest !== "object" || manifest === null || Array.isArray(manifest)) {
    return ["plugin.json is not an object"];
  }

  if (!isValidId(manifest.id)) {
    add(
      `The plugin id "${manifest.id}" is not valid: use 2 to 64 lowercase letters, digits and dashes, starting with a letter or digit.`,
    );
  }
  if (typeof manifest.name !== "string" || manifest.name.trim() === "") add("The plugin has no name.");
  if (typeof manifest.version !== "string" || !/^\d+\.\d+\.\d+$/.test(manifest.version)) {
    add(`The version "${manifest.version}" is not X.Y.Z (the registry needs semver).`);
  }
  if (manifest.apiVersion !== API_VERSION) {
    add(`apiVersion must be ${API_VERSION} (got ${manifest.apiVersion}).`);
  }

  /** A plugin file: a plain path, and present. */
  const checkFile = (p, what) => {
    if (!isPlainRelative(p)) add(`${what} "${p}" must be a path inside the plugin folder.`);
    else if (!fileExists(p)) add(`${what} "${p}" does not exist.`);
  };

  const providers = manifest.providers ?? [];
  if (!Array.isArray(providers)) add("providers must be a list.");
  for (const provider of Array.isArray(providers) ? providers : []) {
    if (!isPlainRelative(provider?.wasm)) {
      add(`The store file "${provider?.wasm}" must be a path inside the plugin folder.`);
    } else if (!fileExists(provider.wasm)) {
      add(`The store file "${provider.wasm}" does not exist (run the build first).`);
    }
  }

  if (manifest.icon !== undefined) {
    if (!isPlainRelative(manifest.icon)) {
      add(`The icon file "${manifest.icon}" must be a path inside the plugin folder.`);
    } else if (!/\.(svg|png)$/i.test(manifest.icon)) {
      add(`The icon file "${manifest.icon}" must be an .svg or .png image.`);
    } else if (!fileExists(manifest.icon)) {
      add(`The icon file "${manifest.icon}" does not exist.`);
    }
  }

  const extension = manifest.extension;
  if (extension !== undefined) {
    if (typeof extension !== "object" || extension === null || Array.isArray(extension)) {
      add("extension must be an object.");
    } else {
      checkFile(extension.main, "The extension file");
      for (const style of extension.styles ?? []) checkFile(style, "The extension style sheet");
      const keys = new Set();
      for (const setting of extension.settings ?? []) {
        const where = `The setting "${setting?.key}"`;
        if (typeof setting?.key !== "string" || setting.key === "") add("A setting has no key.");
        else if (keys.has(setting.key)) add(`Two settings use the key "${setting.key}".`);
        else keys.add(setting.key);
        if (typeof setting?.label !== "string" || setting.label === "") add(`${where} has no label.`);
        if (!SETTING_TYPES.includes(setting?.type)) {
          add(`${where} has an unknown type "${setting?.type}" (use ${SETTING_TYPES.join(", ")}).`);
        }
        if (setting?.type === "select" && !(setting.options ?? []).some((o) => typeof o?.value === "string")) {
          add(`${where} is a select without options.`);
        }
      }
    }
  }

  const themeIds = new Set();
  if (manifest.themes !== undefined && !Array.isArray(manifest.themes)) add("themes must be a list.");
  for (const [i, theme] of (Array.isArray(manifest.themes) ? manifest.themes : []).entries()) {
    const where = `The theme ${theme?.id ?? `#${i + 1}`}`;
    if (!isValidId(theme?.id)) {
      add(`${where} has no valid id (2 to 64 lowercase letters, digits and dashes).`);
    } else if (theme.id !== manifest.id && !theme.id.startsWith(`${manifest.id}-`)) {
      add(`${where}: a theme's id must be the plugin's id "${manifest.id}" or start with "${manifest.id}-".`);
    } else if (themeIds.has(theme.id)) {
      add(`Two themes use the id "${theme.id}".`);
    }
    themeIds.add(theme?.id);
    if (typeof theme?.name !== "string" || theme.name.trim() === "") add(`${where} has no name.`);
    checkFile(theme?.css, `${where}: the CSS file`);
  }

  const mounts = [];
  for (const read of manifest.permissions?.read ?? []) {
    if (typeof read?.path !== "string" || read.path.trim() === "") {
      add("A folder permission has no path.");
      continue;
    }
    const problem = checkMount(read.as);
    if (problem) add(problem);
    if (mounts.includes(read.as)) add(`Two folder permissions use the same name "${read.as}".`);
    mounts.push(read.as);
  }
  const keys = [];
  for (const folder of manifest.permissions?.folders ?? []) {
    if (!FOLDER_KEY_RE.test(folder?.key ?? "")) {
      add(`The folder key "${folder?.key}" is not valid: use 1 to 32 lowercase letters, digits and dashes.`);
    }
    if (keys.includes(folder?.key)) add(`Two folders use the same key "${folder.key}".`);
    keys.push(folder?.key);
    if (typeof folder?.label !== "string" || folder.label.trim() === "") {
      add(`The folder "${folder?.key}" has no label.`);
    }
    if (folder?.default !== undefined && (typeof folder.default !== "string" || folder.default.trim() === "")) {
      add(`The default of the folder "${folder?.key}" is empty.`);
    }
    const problem = checkMount(folder?.as);
    if (problem) add(problem);
    if (mounts.includes(folder?.as)) add(`Two folder permissions use the same name "${folder.as}".`);
    mounts.push(folder?.as);
  }
  for (const host of manifest.permissions?.http ?? []) {
    if (!checkHost(host)) add(`The web permission "${host}" is not valid.`);
  }

  const brings =
    (Array.isArray(providers) && providers.length > 0) ||
    (extension !== undefined && extension !== null) ||
    (Array.isArray(manifest.themes) && manifest.themes.length > 0);
  if (!brings) add("The plugin brings nothing: add a store (providers), an extension or themes.");
  return problems;
}

/** The kinds a manifest brings, as the registry names them (`store`, `extension`, `theme`). */
export function manifestKinds(manifest) {
  const kinds = [];
  if (Array.isArray(manifest.providers) && manifest.providers.length > 0) kinds.push("store");
  if (manifest.extension) kinds.push("extension");
  if (Array.isArray(manifest.themes) && manifest.themes.length > 0) kinds.push("theme");
  return kinds;
}

/**
 * Checks the icon file like `read_icon` in manifest.rs: at most 200 KB, a PNG really is one, an
 * SVG is UTF-8 text without scripts, `on...=` attributes or `javascript:` links. Returns a list of
 * problems.
 */
export function checkIconFile(name, bytes) {
  const out = [];
  if (bytes.length > MAX_ICON_BYTES) out.push(`The icon "${name}" is larger than ${MAX_ICON_BYTES / 1024} KB.`);
  if (/\.png$/i.test(name)) {
    const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    if (!bytes.subarray(0, 8).equals(signature)) out.push(`The icon "${name}" is not a PNG image.`);
    return out;
  }
  const text = bytes.toString("utf8");
  if (!/<svg[\s>]/i.test(text)) out.push(`The icon "${name}" is not an SVG.`);
  if (/<script/i.test(text)) out.push(`The icon "${name}" may not contain a script.`);
  if (/javascript:/i.test(text)) out.push(`The icon "${name}" may not contain a javascript: link.`);
  if (/[\s"'/]on[a-z]+\s*=/i.test(text)) {
    out.push(`The icon "${name}" may not contain an event handler attribute (on...=).`);
  }
  return out;
}
