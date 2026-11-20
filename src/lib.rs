//! A Questkeep store plugin: the template's sample store. It lists the few games of `games.json`
//! (compiled in) and shows what a store does with a folder the user chooses.
//!
//! * Parsing and path rules live in [`games`], free of SDK types and tested natively.
//! * This file is the thin [`Provider`] on top: it asks the sandbox which files exist and turns the
//!   catalogue into [`ImportedGame`]s.
//!
//! # The folder the user chooses
//!
//! `plugin.json` declares one folder under `permissions.folders` (key `games`, mounted at
//! `/games`). Questkeep mounts the folder the user picked in Settings > Plugins (or the default)
//! read-only at that path, and only when it exists. Paths this plugin reports start with the
//! mount path (`/games/Sample Adventure/adventure.exe`); Questkeep translates them to the real
//! paths on the PC. Never build a path with a `..` part: it is not translated.
//!
//! To make the store work **without** a folder, delete the `folders` entry from `plugin.json`,
//! `GAMES_MOUNT`, `installed_path` and the `scan_installed` loop that uses them, and report games
//! from `games.json` alone (or from the web: declare hosts in `permissions.http` and use
//! `questkeep_plugin_sdk::http`).
//!
//! # Not implemented on purpose: `launcher()`
//!
//! A store can also offer its own launcher program (`Provider::launcher`), which Questkeep lists in
//! the title bar's "Open launcher" menu. Return `Some(PlayAction::file("/mount/Launcher.exe"))` from
//! a mount that holds the program (the BSManager plugin is a complete example); this sample has no
//! launcher, so it keeps the default of `None`.
#![cfg_attr(test, allow(clippy::unwrap_used))]

pub mod games;

use std::path::Path;

use questkeep_plugin_sdk::model::{GameMetadata, ImportedGame, PlayAction};
use questkeep_plugin_sdk::{Provider, ProviderError, export_provider, log};

use games::{CatalogEntry, mount_path, parent_dir, parse_catalog};

/// The provider's id. It must be the plugin's id (`plugin.json`) or start with it and a dash.
/// `npm run init` sets it.
const ID: &str = "my-plugin";
/// The store's name in Questkeep. `npm run init` sets it.
const NAME: &str = "My Plugin";
/// `plugin.json` mounts the user's games folder here (`permissions.folders[0].as`).
const GAMES_MOUNT: &str = "/games";
/// The store's icon in Questkeep: one colour (`currentColor`), so it follows the theme.
const ICON: &str = include_str!("../store-icon.svg");
/// The games this store knows. Replace it with what your store reads from files or the web.
const CATALOG: &str = include_str!("../games.json");

/// The catalogue. A failure here is a bug of the plugin, not of the user's setup.
fn catalog() -> Result<Vec<CatalogEntry>, ProviderError> {
    parse_catalog(CATALOG).map_err(ProviderError::Parse)
}

/// The mount path of the game's executable, when the file is really there (one `is_file` check:
/// cheap, and it tells installed from merely owned).
fn installed_path(entry: &CatalogEntry) -> Option<String> {
    let path = mount_path(GAMES_MOUNT, &entry.exe)?;
    Path::new(&path).is_file().then_some(path)
}

/// What Questkeep gets for a game. `exe` is the mount path when the game is installed.
fn to_game(entry: &CatalogEntry, exe: Option<String>) -> ImportedGame {
    let mut game = ImportedGame::installed(&entry.id, &entry.name);
    game.installed = exe.is_some();
    if let Some(exe) = exe {
        game.install_dir = parent_dir(&exe).map(str::to_string);
        game.play_action = Some(PlayAction {
            working_dir: game.install_dir.clone(),
            ..PlayAction::file(exe)
        });
    }
    game
}

#[derive(Default)]
struct MyStore;

impl Provider for MyStore {
    fn id(&self) -> String {
        ID.into()
    }

    fn name(&self) -> String {
        NAME.into()
    }

    fn icon_svg(&self) -> String {
        ICON.into()
    }

    /// There is no store client to look for: the games come from a file and a folder.
    fn is_installed(&self) -> bool {
        true
    }

    /// The games found on this PC: those whose executable is in the user's games folder.
    fn scan_installed(&self) -> Result<Vec<ImportedGame>, ProviderError> {
        let mut games = Vec::new();
        for entry in catalog()? {
            if let Some(exe) = installed_path(&entry) {
                games.push(to_game(&entry, Some(exe)));
            }
        }
        log::info(format!("found {} installed games", games.len()));
        Ok(games)
    }

    fn can_scan_owned(&self) -> bool {
        true
    }

    /// Every game of the catalogue, installed or not.
    fn scan_owned(&self, _config: &serde_json::Value) -> Result<Vec<ImportedGame>, ProviderError> {
        Ok(catalog()?
            .iter()
            .map(|entry| to_game(entry, installed_path(entry)))
            .collect())
    }

    fn metadata(&self, source_game_id: &str) -> Result<Option<GameMetadata>, ProviderError> {
        Ok(catalog()?
            .into_iter()
            .find(|entry| entry.id == source_game_id)
            .and_then(|entry| entry.description)
            .map(|description| GameMetadata {
                description: Some(description),
                ..GameMetadata::default()
            }))
    }
}

export_provider!(MyStore);

#[cfg(test)]
mod tests {
    use super::*;

    fn entry() -> CatalogEntry {
        CatalogEntry {
            id: "a".into(),
            name: "Game A".into(),
            exe: "Game A/a.exe".into(),
            description: Some("About A".into()),
        }
    }

    #[test]
    fn an_installed_game_launches_through_its_mount_path() {
        let game = to_game(&entry(), Some("/games/Game A/a.exe".into()));
        assert!(game.installed);
        assert_eq!(game.source_game_id, "a");
        assert_eq!(game.install_dir.as_deref(), Some("/games/Game A"));
        let action = game.play_action.unwrap();
        assert_eq!(action.target, "/games/Game A/a.exe");
        assert_eq!(action.working_dir.as_deref(), Some("/games/Game A"));
    }

    #[test]
    fn a_game_without_files_is_owned_but_not_installed() {
        let game = to_game(&entry(), None);
        assert!(!game.installed);
        assert!(game.play_action.is_none() && game.install_dir.is_none());
    }

    #[test]
    fn the_provider_describes_itself() {
        let store = MyStore;
        assert_eq!(store.id(), ID);
        assert_eq!(store.name(), NAME);
        assert!(store.icon_svg().contains("currentColor"));
        assert!(store.launcher().is_none());
        assert!(catalog().is_ok());
        // Natively there is no /games mount, so nothing is installed but everything is owned.
        assert!(store.scan_installed().unwrap().is_empty());
        let owned = store.scan_owned(&serde_json::Value::Null).unwrap();
        assert_eq!(owned.len(), catalog().unwrap().len());
        assert!(owned.iter().all(|g| !g.installed));
        let metadata = store.metadata("sample-adventure").unwrap().unwrap();
        assert!(metadata.description.is_some());
        assert!(store.metadata("nope").unwrap().is_none());
    }
}
