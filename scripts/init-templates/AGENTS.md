# AGENTS.md

Guide for humans and coding agents working on the Questkeep plugin {{name}} (`{{id}}`).

## Commands

| Task | Command |
|---|---|
<!-- @kind:store -->
| Format check / clippy / tests | `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test` |
| Build `provider.wasm` (needs `rustup target add wasm32-wasip2`) | `npm run build`, `./build.sh` or `./build.ps1` |
<!-- @end -->
<!-- @kind:extension -->
| Syntax check of the extension | `node --check main.js` |
<!-- @end -->
| Script tests (release tooling, zip, manifest rules) | `npm test` |
| Pack `dist/{{zip}}` (checks `plugin.json`, prints sha256 and size) | `node scripts/pack.mjs` |
| Add a changeset (every user-visible PR) | `npm run changeset -- add <major\|minor\|patch> "summary"` |
| Version, pending changesets, next version | `npm run changeset -- status` |

CI (`.github/workflows/ci.yml`) and the release build run on `ubuntu-latest`.
<!-- @kind:store -->
Locally on Windows run cargo from PowerShell or cmd, not Git Bash (its `link` shadows MSVC's
`link.exe`); `build.ps1` is the Windows convenience script next to `build.sh`.
<!-- @end -->
Never invoke `python` in scripts: on stock Windows it is a Microsoft Store stub that hangs.

## Layout

- `plugin.json`: the manifest. `scripts/manifest.mjs` checks it with the plugin host's rules (the
  rule list and the Questkeep source files they come from are at its top); `pack` and `npm test` run
  that check. `icon.svg`: the plugin's icon (Settings > Plugins and the registry listing).
<!-- @kind:store -->
- `src/lib.rs`: the `Provider` (id, name, scans, metadata). `src/games.rs`: parsing and path rules,
  no SDK types, unit-tested natively. `games.json`: the sample catalogue, compiled in.
  `store-icon.svg`: the one-colour (`currentColor`) icon compiled in as `icon_svg()`.
  `Cargo.toml`: the SDK is a git dependency pinned to a Questkeep release tag (how to bump it, and
  how to build against a local Questkeep checkout, is explained there).
<!-- @end -->
<!-- @kind:extension -->
- `main.js`: the extension (`activate(api)`), `style.css` its styles, `questkeep-plugin.d.ts` the
  API's types (JSDoc: `// @ts-check` and `import("./questkeep-plugin")`). Copy a newer
  `questkeep-plugin.d.ts` from Questkeep's `examples/plugins/` when you adopt a newer API.
<!-- @end -->
<!-- @kind:theme -->
- `themes/{{id}}.css`: the theme. Every rule is written against `:root[data-theme="{{id}}"]`; the
  `themes` entry in `plugin.json` has its parameters and preview swatches.
<!-- @end -->
- `registry/meta.json` and `registry/min-app`: the registry listing and the lowest Questkeep
  version that runs the plugin. `scripts/`: `pack.mjs`, `manifest.mjs`, `zip.mjs`, `release/`
  (changesets, registry entry). `docs/RELEASING.md` describes the release.

## Conventions

- Conventional Commits. Every user-visible change adds a changeset; docs/CI-only changes do not.
- The plugin `id` never changes (it is the plugin's identity). Raise `registry/min-app` when you use
  something only newer Questkeep versions have.
- Never commit `dist/`.
<!-- @kind:store -->
- Never commit `provider.wasm` or `target/`: they are build output.
<!-- @end -->
