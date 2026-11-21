# {{name}}

{{description}}

A [Questkeep](https://github.com/questkeep/questkeep) plugin: {{kinds}}.

## Install

- **From the plugin browser** (once the plugin is listed in the registry): Questkeep, Settings,
  Plugins, Browse plugins…, search for "{{name}}", Install.
- **From a zip:** download `{{zip}}` from the
  [releases](https://github.com/{{repo}}/releases), then Settings, Plugins, "Install from file…".

<!-- @kind:store -->
## The store

The store lists the sample games of `games.json` (replace them with what your store really reads).
It asks for one folder, the **Games folder** (`permissions.folders` in `plugin.json`): choose it in
Settings, Plugins, {{name}}, Folders. Questkeep gives the plugin read-only access to that folder only. (Stores can ask for more: every file or
the registry read-only, the launcher's program names, a sign-in window. See the
[plugin docs](https://github.com/questkeep/questkeep/blob/main/docs/PLUGINS.md); those need Questkeep 0.7.0.)
A game is listed as installed when its executable is in the folder (for the samples:
`Sample Adventure/adventure.exe`), and as owned otherwise.

<!-- @end -->
<!-- @kind:extension -->
## The extension

A title bar button that says hello, and a setting (Settings, {{name}}) that decides whether a message
is shown when the plugin starts. Extensions are trusted code: they can do everything the app's own
interface can, so this one only does what is described here.

<!-- @end -->
<!-- @kind:theme -->
## The theme

"{{name}}" appears in Settings, Appearance, marked "Plugin: {{name}}", with an accent color option.

<!-- @end -->
## Develop

Needs [Node.js](https://nodejs.org) 24 or newer.
<!-- @kind:store -->
The store also needs [Rust](https://rustup.rs) and `rustup target add wasm32-wasip2`.
<!-- @end -->

<!-- @kind:store -->
- `npm run build` writes `provider.wasm` next to `plugin.json`.
<!-- @end -->
- In Questkeep: Settings, Plugins, **Install from folder…**, choose this folder, and turn on
  **Reload on change** in the plugin's row. Saving a change reloads the plugin without restarting.
<!-- @kind:store -->
- For the store, build again after each change (`npm run build`): Questkeep reloads when the folder
  changes.
<!-- @end -->
- `npm test` runs the checks of the release tooling and the manifest rules.
  `node scripts/pack.mjs` writes `dist/<id>-<version>.zip`, exactly what a release contains.
<!-- @kind:store -->
- `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings` and `cargo test` check the Rust code.
<!-- @end -->

More in [`AGENTS.md`](AGENTS.md).

## Changes and releases

Every user-visible change adds a changeset (`npm run changeset -- add minor "What changed."`).
**Actions, Release** turns the pending ones into a version, the zip and a GitHub release.
See [`docs/RELEASING.md`](docs/RELEASING.md), which also covers listing the plugin in the
[registry](https://github.com/questkeep/plugins).

## License

MIT, see [`LICENSE`](LICENSE) and [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
