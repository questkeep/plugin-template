# AGENTS.md

Guide for humans and coding agents working on the **Questkeep plugin template** itself (this file
is replaced by the generated plugin's own `AGENTS.md` when someone runs `npm run init`).

## What this repository is

A GitHub template repository. Its files form a complete plugin with the placeholder id `my-plugin`
(a store, an extension and a theme at once) plus `scripts/init.mjs`, which turns it into a real plugin
of the kinds the user picks. Nothing here is ever published as a plugin.

## Commands

| Task | Command |
|---|---|
| All script tests (release tooling, zip, manifest rules, **init**) | `npm test` |
| Try init without changing anything | `node scripts/init.mjs demo-plugin "Demo Plugin" --kinds store,theme --yes --dry-run` |
| Store checks | `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test` |
| Build the sample store | `npm run build` (needs the `wasm32-wasip2` target, set up by `mise install`) |
| Pack the placeholder plugin | `node scripts/pack.mjs` |

Never run init in this working copy (it deletes init): copy the folder first, or run the tests, which
do exactly that in a temp folder. `.github/workflows/template-check.yml` runs init for all seven kind
combinations on CI and then the generated plugin's checks.

## How init works

- Placeholders in the template files: the id `my-plugin`, the name `My Plugin`, the repository
  `OWNER/my-plugin`, author `Your Name`. `scripts/init.mjs` edits `plugin.json`, `registry/meta.json`,
  `Cargo.toml`, `Cargo.lock` (and re-sorts it), `src/lib.rs` (`ID`, `NAME`), `package.json`, `LICENSE`
  structurally or with a pattern that must match (it fails loudly when the template changed).
- Kind blocks: text files (workflows, `.gitignore`, `docs/RELEASING.md`, `THIRD_PARTY_NOTICES.md` and the
  two init templates) mark kind-specific lines with `# @kind:store` ... `# @end` (`// @kind:` and
  `<!-- @kind:store -->` work too; several kinds separated by commas keep the block when any is chosen).
  A marker must be alone on its line. Blocks of unchosen kinds are removed, marker lines always.
  Do not write marker lines in prose or examples.
- `scripts/init-templates/README.md` and `AGENTS.md` become the plugin's README and AGENTS.md
  (`{{id}}`, `{{name}}`, `{{description}}`, `{{author}}`, `{{repo}}`, `{{zip}}`, `{{kinds}}`).
- Everything is planned in memory and written at the end; `package.json` (with the marker
  `"questkeepTemplate": "pending"`) is written last.

## Conventions

- **Toolchain pins:** `mise.toml` pins exact versions; `.github/workflows/update-toolchain.yml` (calls
  `questkeep/workflows`) lists every pinned tool in its `tools` input with a version label (`lts`,
  `latest` or a prefix). **When you add or remove a tool in `mise.toml`, update that list in the same
  change**; the workflow fails when a pinned tool is missing from it. Generated plugins keep the workflow; its list names Rust even for non-store plugins
  (a listed tool that `mise.toml` does not pin is skipped).
- When you change a template file, check that init still works for all seven combinations
  (`npm test` covers the file sets and manifests; for Rust changes also build a generated store).
- The manifest checker `scripts/manifest.mjs` mirrors the host's rules (`crates/questkeep-plugins/src/manifest.rs`
  and two UI files, listed at its top). Update both lists together when the host changes.
- New `permissions` fields (`filesystem`, `registry`, `launcher`, `login`, `folders`) need Questkeep 0.7.0.
  The sample store only uses `folders` and the SDK dependency below has none of the newer host APIs
  (`secrets` and the like) yet: do not use them here before the SDK tag moves.
- The SDK dependency in `Cargo.toml` is pinned to a Questkeep tag; `registry/min-app` is the
  matching minimum app version. Bump them together, regenerate `Cargo.lock` and run the checks.
- The release tooling is generic: it reads the plugin id and name from `plugin.json`. Do not
  hard-code a plugin id in a workflow or script.
- No dependencies in `package.json` (Node built-ins only). Conventional Commits.
