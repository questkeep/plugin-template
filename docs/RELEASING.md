# Releasing the plugin

Releases are cut from a manual GitHub Actions run. Versions come from git tags and from
**changesets**: small markdown files that each pull request adds to `.changeset/`. This mirrors
the Questkeep app's process.

## Changesets

```md
---
bump: minor   # major | minor | patch
---
Added a title bar button that shows how many games you have.
```

```sh
npm run changeset -- add <major|minor|patch> "<summary>"   # creates .changeset/<random>.md
npm run changeset -- status                                 # current version, pending files, next version
```

- Add one per user-visible change, written for the people who use the plugin. Docs/CI-only
  changes need none. CI posts a warning (never a failure) on pull requests that change code
  without adding one.
- **Current version** = the highest `vX.Y.Z` git tag (no tag means `0.0.0`).
- **Next version** = current bumped by the highest pending bump. Pre-1.0 is plain semver: `major`
  on 0.x gives 1.0.0, `minor` gives 0.(x+1).0.
- No pending changesets means nothing to release; the workflow ends successfully with a notice.
- A new repository has no tag, so the first release computes from `0.0.0`: the `minor` changeset
  `npm run init` added ("First release") gives 0.1.0, the version in `plugin.json`.

## Cutting a release

1. Make sure `main` is green and contains the changesets you want to ship.
2. GitHub, Actions, **Release**, **Run workflow** on `main`. Tick **dry_run** to compute the
   version, render the notes, build and pack without committing, tagging or publishing anything
   (the run summary shows the notes and the registry entry). A dry run may run from any branch; a
   real release only from `main`.
3. The workflow:
   1. `prepare` computes current/next version and the notes. No changesets: stop.
   2. `build` (Ubuntu) writes the version into `plugin.json`.
<!-- @kind:store -->
      It also writes it into `Cargo.toml` (`[package]`) and `Cargo.lock` and builds
      `provider.wasm`.
<!-- @end -->
      Then it
      packs `<id>-X.Y.Z.zip` (see `scripts/pack.mjs`: `plugin.json`, the files it names,
      `README.md` and `LICENSE` at the top level), and computes the sha256 and size. The notes
      and the job summary end with the registry `versions.json` entry.
   3. `release` (not on dry runs) fails if `main` moved during the build, then commits
      `chore(release): vX.Y.Z` (version files and deleted changesets) as `github-actions[bot]`,
      pushes it and the annotated tag `vX.Y.Z`, and runs `gh release create` with the notes and
      the zip. Every `git push` and `gh release create/upload` is retried up to 4 times (waits of
      5, 15 and 30 seconds, `scripts/release/retry.sh`) and fails loudly after that.
   4. It then tries to open the registry pull request (see below).
4. Only one release runs at a time.

The plugin id and name are read from `plugin.json`; the workflows do not name your plugin.

### If the release fails halfway

Re-run the failed `release` job (Actions, the run, **Re-run failed jobs**). It first checks how far
the earlier attempt got:

| State found | Detection | What the re-run does |
|---|---|---|
| Tag `vX.Y.Z` is on origin | `git ls-remote` finds the tag | Only publishes the GitHub release (`gh release upload --clobber` if it already exists). |
| Release commit on main, no tag | `origin/main`'s head is `chore(release): vX.Y.Z` and the tag is missing (the commit push worked, the tag push did not) | Creates the annotated tag on that commit, pushes it, then publishes the release. The version commit is not made again: the changesets are already consumed. |
| Nothing pushed | neither of the above | The normal path: commit, push, tag, push, publish. |

The "main did not move during the build" check depends on the state: on the normal path `main` must
still be the commit the run started from; for "release commit, no tag" the release commit must sit
directly on that commit (a re-run keeps the original commit, and main only moved by the release
commit itself), so the tag never lands on something that was not built; when the tag already exists
the check is skipped because nothing is pushed. If main has other commits after the release commit,
the head is no longer recognized: tag the release commit by hand (`git tag -a vX.Y.Z <sha> && git push
origin vX.Y.Z`) and re-run the job.

The release commit is pushed with `GITHUB_TOKEN`, so GitHub does not start CI on it. If `main` has
branch protection, allow `github-actions[bot]` to push (or change the workflow to push a pull
request instead).

## Listing the release in the plugin registry

The registry ([`questkeep/plugins`](https://github.com/questkeep/plugins)) points at the release zip
and pins its sha256. It is reviewed: read its
[CONTRIBUTING.md](https://github.com/questkeep/plugins/blob/main/CONTRIBUTING.md) first (public
repository, license, no obfuscated code, permissions that are the minimum the plugin needs; a plugin that reads everything, with `filesystem` or
`registry`, gets its web hosts checked most closely, and tokens belong in the SDK's `secrets`, not in
`/data`).

**One-time steps**

1. Edit `registry/meta.json` (name, one-line summary of at most 120 characters, description, tags,
   `kinds`) and replace `icon.svg` with your icon (square, at most 200 KB for the plugin icon).
   `npm run init` filled in what it knew.
2. Set the lowest Questkeep version that can run the plugin in `registry/min-app` (the first line;
   the registry's `minApp`). A store with `permissions.folders`, `filesystem`, `registry`, `launcher` or `login` needs 0.7.0.
3. Make the repository public before the first listing.
4. Decide how the pull request is made, see below. The first one adds the plugin to the registry and
   a maintainer reviews it; later releases only append a version.

**Per release**, three ways:

- **By hand:** copy the JSON entry at the end of the release notes (or the run summary) and append
  it to `plugins/<id>/versions.json` in a pull request there; on the first release also add
  `meta.json` and the icon.
- **With a token of yours (`REGISTRY_TOKEN`):** a personal access token of the account that owns
  your fork of `questkeep/plugins`. Fork the registry once, then create a token and add it as the
  repository secret `REGISTRY_TOKEN` (Settings, Secrets and variables, Actions):
  - fine-grained token: resource owner = your account, repository access = your fork of
    `plugins` only, permissions Contents: read and write and Pull requests: read and write;
  - or a classic token with the `public_repo` scope.

  The release workflow pushes a branch `<id>-vX.Y.Z` to your fork and opens the pull request
  against `questkeep/plugins`.
- **With the GitHub App** (repositories of the questkeep organization only): variable
  `PLUGIN_RELEASE_APP_ID` and secret `PLUGIN_RELEASE_APP_PRIVATE_KEY` of the organization's app
  (contents and pull requests write on `questkeep/plugins`). The workflow creates a short-lived
  token, pushes the branch to the registry itself and opens the pull request. If both are set, the
  app wins.

If neither is configured, or the step fails, the release still succeeds and says so in the log.

`registry/meta.json` and the icon are copied into `plugins/<id>/` by the same pull request on
every release, so edit them here, not in the registry. A listing's pull request is validated by the
registry's CI (`node scripts/validate.mjs`); it downloads the zip and checks the hash, the size and that
`plugin.json` has the same `id` and `version` as the entry.

## Without GitHub

<!-- @kind:store -->
`npm run build` (or `./build.sh` on Linux and macOS, `./build.ps1` on Windows) builds `provider.wasm`,
then
<!-- @end -->
`node scripts/pack.mjs` produces the same zip locally in `dist/`.
