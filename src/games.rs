//! The catalogue of games this plugin lists, and the path rules around it. No SDK types in here:
//! everything is plain data and functions, so `cargo test` covers it natively. `lib.rs` is the thin
//! `Provider` that turns it into what Questkeep wants.

use serde::Deserialize;

/// One entry of `games.json`.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct CatalogEntry {
    /// Stable id of the game in this store (Questkeep's `sourceGameId`). Never change it later.
    pub id: String,
    pub name: String,
    /// The game's executable, relative to the folder the user chose (forward slashes).
    pub exe: String,
    pub description: Option<String>,
}

/// Reads the catalogue (the text of `games.json`).
pub fn parse_catalog(text: &str) -> Result<Vec<CatalogEntry>, String> {
    let entries: Vec<CatalogEntry> =
        serde_json::from_str(text).map_err(|e| format!("games.json is not valid: {e}"))?;
    let mut seen = std::collections::HashSet::new();
    for entry in &entries {
        if entry.id.trim().is_empty() || entry.name.trim().is_empty() {
            return Err("every game in games.json needs an id and a name".into());
        }
        if !seen.insert(entry.id.as_str()) {
            return Err(format!("games.json lists the id {:?} twice", entry.id));
        }
    }
    Ok(entries)
}

/// Joins a mount (`/games`) and a relative path into the **mount path** Questkeep understands:
/// `/games/Sample Adventure/adventure.exe`.
///
/// Questkeep translates a path that starts with the mount of a `permissions.folders` or
/// `permissions.read` entry to the real folder the user chose (`D:\Games\Sample Adventure\...`).
/// It never resolves `..`, so a path with such a part would stay as written and not work: this
/// returns `None` for anything that is not a plain relative path (absolute, drive letters,
/// backslashes, `..`, empty parts).
pub fn mount_path(mount: &str, relative: &str) -> Option<String> {
    let parts: Vec<&str> = relative.split('/').collect();
    let plain = !parts.is_empty()
        && parts
            .iter()
            .all(|p| !p.is_empty() && *p != "." && *p != ".." && !p.contains(['\\', ':']));
    plain.then(|| format!("{}/{relative}", mount.trim_end_matches('/')))
}

/// The folder part of a mount path: `/games/A/a.exe` gives `/games/A`.
pub fn parent_dir(path: &str) -> Option<&str> {
    path.rsplit_once('/')
        .map(|(dir, _)| dir)
        .filter(|d| !d.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_bundled_catalogue_is_valid() {
        let entries = parse_catalog(include_str!("../games.json")).unwrap();
        assert!(!entries.is_empty());
        for entry in &entries {
            assert!(mount_path("/games", &entry.exe).is_some(), "{}", entry.id);
        }
    }

    #[test]
    fn parses_entries_with_and_without_a_description() {
        let entries = parse_catalog(
            r#"[{"id":"a","name":"A","exe":"A/a.exe"},
                {"id":"b","name":"B","exe":"b.exe","description":"About B"}]"#,
        )
        .unwrap();
        assert_eq!(entries[0].description, None);
        assert_eq!(entries[1].description.as_deref(), Some("About B"));
    }

    #[test]
    fn rejects_broken_catalogues() {
        assert!(parse_catalog("not json").is_err());
        assert!(parse_catalog(r#"[{"id":"a","name":"A"}]"#).is_err());
        assert!(parse_catalog(r#"[{"id":" ","name":"A","exe":"a.exe"}]"#).is_err());
        let twice = r#"[{"id":"a","name":"A","exe":"a.exe"},{"id":"a","name":"B","exe":"b.exe"}]"#;
        assert!(parse_catalog(twice).unwrap_err().contains("twice"));
    }

    #[test]
    fn mount_paths_start_with_the_mount_and_never_contain_dotdot() {
        assert_eq!(
            mount_path("/games", "Sample Adventure/adventure.exe").as_deref(),
            Some("/games/Sample Adventure/adventure.exe")
        );
        assert_eq!(
            mount_path("/games/", "a.exe").as_deref(),
            Some("/games/a.exe")
        );
        for bad in [
            "",
            "/abs.exe",
            "../a.exe",
            "a/../b.exe",
            "a//b.exe",
            "./a.exe",
            "a\\b.exe",
            "C:/a.exe",
        ] {
            assert_eq!(mount_path("/games", bad), None, "{bad:?}");
        }
    }

    #[test]
    fn parent_dir_cuts_the_last_part() {
        assert_eq!(parent_dir("/games/A/a.exe"), Some("/games/A"));
        assert_eq!(parent_dir("/games/a.exe"), Some("/games"));
        assert_eq!(parent_dir("a.exe"), None);
    }
}
