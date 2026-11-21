# Questkeep plugin template

A GitHub template for [Questkeep](https://github.com/questkeep/questkeep) plugins. Click
**Use this template**, clone your new repository, run one command, and you have a working, tested
and releasable plugin of the kind you want:

| Kind | What it is | Written in |
|---|---|---|
| **store** | A game source: lists games in your library, runs sandboxed | Rust, compiled to WebAssembly (`wasm32-wasip2`) |
| **extension** | Adds to the app's interface: title bar buttons, menus, pages, dialogs, settings | Plain JavaScript, no build step |
| **theme** | Restyles the app, with options the user can set | CSS |

One plugin can be any combination of the three.

## Getting started

1. Click **Use this template** on GitHub (**Create a new repository**), then clone it.
2. Needs [Node.js](https://nodejs.org) 24 or newer; for a store also
   [Rust](https://rustup.rs) and `rustup target add wasm32-wasip2`.
3. Run init in the clone:

   ```sh
   node scripts/init.mjs my-cool-plugin "My Cool Plugin" --kinds store,extension
   # or: npm run init -- my-cool-plugin "My Cool Plugin" --kinds store,extension
   ```

   Leave arguments out and it asks for them. Add `--yes` to take defaults without asking, and
   `--dry-run` to see what would change first.

   | Argument | Meaning |
   |---|---|
   | `<id>` | The plugin id: 2 to 64 lowercase letters, digits and dashes, not starting with a dash. Cannot be changed later without being a new plugin. |
   | `"<Display Name>"` | The name Questkeep shows (default: the id in title case). |
   | `--kinds` | `store`, `extension`, `theme`, comma separated (default `store`). |
   | `--author` | Author, also the license holder (default: your `git config user.name`). |
   | `--description` | What the plugin does, in a sentence or two. |
   | `--repo` | `owner/repo` on GitHub (default: your clone's `origin`). |
   | `--yes`, `-y` | Don't ask, use defaults. |
   | `--dry-run` | Print what would be written and deleted, change nothing. |
   | `--keep-init` | Keep `scripts/init.mjs`, its tests and templates (normally init deletes itself). |

4. Look at what you got (`git status`), then commit:
   `git add -A && git commit -m "chore: initialise the plugin"` and push.

Init rewrites `plugin.json`, `registry/meta.json`, `Cargo.toml`, `package.json`, `LICENSE` (your name
and the year), the README and `AGENTS.md`; keeps only the workflow steps, files and folders of the
kinds you chose; adds a changeset for the first release; and removes itself. It runs once and touches
nothing outside the repository folder.

## What each kind gives you

- **Store** (`src/lib.rs`, `src/games.rs`, `games.json`, `store-icon.svg`, `Cargo.toml`): a `cdylib`
  `Provider` that lists a few sample games. Parsing is kept apart from the `Provider` and has native
  unit tests. It shows **one folder the user chooses** (`permissions.folders` in `plugin.json`, mounted
  at `/games`): paths it returns are **mount paths** such as `/games/Sample Adventure/adventure.exe`,
  never containing `..`, which Questkeep translates to real paths. To turn the folder off, delete the
  entry (and the code that uses it). `launcher()` is documented in `src/lib.rs` but not implemented.
  The SDK is a git dependency pinned to a Questkeep release tag; `Cargo.toml` explains how to bump it
  and how to develop against a local checkout.
- **Extension** (`main.js`, `style.css`, `questkeep-plugin.d.ts`): an ES module with `activate(api)`
  that adds a title bar button and reacts to a setting declared in `plugin.json`. Types come from
  `questkeep-plugin.d.ts` through JSDoc. Class names are prefixed with the plugin id and styles use
  only the app's `--qk-*` variables, so it follows every theme.
- **Theme** (`themes/<id>.css`, the `themes` entry in `plugin.json`): a light and a dark palette and
  one option (the accent color).
- **Always:** `plugin.json`, `icon.svg` (replace it with your own), `registry/meta.json` (the
  registry listing), `LICENSE`, `.changeset/`, and the tooling below.

## Develop and try it in Questkeep

1. For a store: `npm run build` (writes `provider.wasm` next to `plugin.json`).
2. In Questkeep: **Settings > Plugins > Install from folder…** and choose your repository folder.
3. Turn on **Reload on change** in the plugin's row. Edit, save (for a store: build again), and
   Questkeep reloads the plugin without restarting. Extension and theme changes need no build.
4. Anything wrong with `plugin.json` is reported by `npm test` and `node scripts/pack.mjs` with the
   host's own messages.

On Windows run cargo from PowerShell or cmd, not Git Bash. `build.ps1` is the PowerShell version of
`build.sh`.

## Test, check and pack

```sh
npm test                    # release tooling, zip, manifest rules
cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test   # store
node scripts/pack.mjs       # checks plugin.json like the host, writes dist/<id>-<version>.zip
```

`scripts/manifest.mjs` is a JavaScript copy of the host's `plugin.json` rules (the list, with where
each rule lives in Questkeep's source, is at the top of the file). The package always contains
`plugin.json`, the files it names, `README.md` and `LICENSE`; list more files or folders under
`pack.include` in `package.json` when your extension loads extra files.

CI (`.github/workflows/ci.yml`, Ubuntu) does the same and uploads the zip. Pull requests that change
code without a changeset get a warning, never a failure.

## Changesets and releases

Every user-visible pull request adds a **changeset**, a small markdown file:

```sh
npm run changeset -- add minor "Added a title bar button."
npm run changeset -- status
```

**Actions > Release > Run workflow** turns the pending changesets into the next version, builds the zip,
commits the version bump, tags `vX.Y.Z` and publishes a GitHub release whose notes end with the
registry entry (use **dry_run** first). Details, recovery from a half-finished release and the
registry steps: [`docs/RELEASING.md`](docs/RELEASING.md).

## Publishing to the plugin registry

The plugin browser in Questkeep lists the plugins of
[questkeep/plugins](https://github.com/questkeep/plugins). Listing is reviewed by pull request (see
its `CONTRIBUTING.md`): the first release creates the folder `plugins/<id>/` there from your
`registry/meta.json` and `icon`, and every later release appends the version. The release workflow
can open that pull request for you with a GitHub App (only for the questkeep organization) or a
`REGISTRY_TOKEN` secret of your own; without either it prints the entry for you to paste. Set
`registry/min-app` to the lowest Questkeep version your plugin needs: 0.7.0 as soon as a store uses
`permissions.folders`, `filesystem`, `registry`, `launcher` or `login` (older apps ignore those fields).

### What a store can reach

A store runs sandboxed: it sees its own plugin folder and `/data`, and only reaches more through
`permissions` in `plugin.json`: web hosts (`http`), folders (`read`, or `folders` that the user
points somewhere), read-only access to every file (`filesystem`) or to the registry (`registry`),
the store launcher's program names (`launcher`) and a sign-in window locked to some domains
(`login`). Declare the minimum. A plugin that reads everything the user can read is reviewed hardest on
its web hosts, because those are the only way out of the PC. Keep tokens in the SDK's `secrets`
module (the system keyring), never in `/data`. Details: [PLUGINS.md](https://github.com/questkeep/questkeep/blob/main/docs/PLUGINS.md) and the wiki page
[Plugin Manifest Reference](https://github.com/questkeep/questkeep/wiki/Plugin-Manifest-Reference).

## Template maintenance

`.github/workflows/template-check.yml` runs init for all seven kind combinations and then the
generated plugin's own checks, so the template cannot rot. `scripts/init.test.mjs` tests init itself.
See `AGENTS.md` for how the template is organised.

## Learn more

The [Questkeep wiki](https://github.com/questkeep/questkeep/wiki):
[Plugin Basics](https://github.com/questkeep/questkeep/wiki/Plugin-Basics),
[Plugin Manifest Reference](https://github.com/questkeep/questkeep/wiki/Plugin-Manifest-Reference),
[Store Plugin API Reference](https://github.com/questkeep/questkeep/wiki/Store-Plugin-API-Reference),
[Extension API Reference](https://github.com/questkeep/questkeep/wiki/Extension-API-Reference),
[Theme Reference](https://github.com/questkeep/questkeep/wiki/Theme-Reference),
[Publishing Plugins](https://github.com/questkeep/questkeep/wiki/Publishing-Plugins), and the
tutorials for a
[store](https://github.com/questkeep/questkeep/wiki/Tutorial-Store-Plugin),
[extension](https://github.com/questkeep/questkeep/wiki/Tutorial-Extension-Plugin) and
[theme](https://github.com/questkeep/questkeep/wiki/Tutorial-Theme-Plugin).

## License

MIT, see [`LICENSE`](LICENSE). See [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
