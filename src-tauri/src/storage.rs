use rusqlite::Connection;
use std::{fs, io, path::Path};

// Historical names are kept only to discover existing installations.
const LEGACY_IDENTIFIER: &str = "com.manju.studio";
const LEGACY_DATABASE: &str = "manju.sqlite";

pub fn initialize_root(root: &Path) -> io::Result<()> {
    fs::create_dir_all(root.join("projects"))?;
    let registry = root.join("projects.json");
    if !registry.exists() {
        if let Some(parent) = root.parent() {
            let legacy = parent.join(LEGACY_IDENTIFIER).join("projects.json");
            if legacy.is_file() {
                let contents = fs::read(&legacy)?;
                serde_json::from_slice::<Vec<serde_json::Value>>(&contents)
                    .map_err(io::Error::other)?;
                // Preserve absolute project/media paths; do not move user assets.
                let temporary = root.join("projects.json.tmp");
                fs::write(&temporary, contents)?;
                fs::rename(temporary, registry)?;
            }
        }
    }
    Ok(())
}

pub fn is_project(path:&Path)->bool {path.join("spielberg.sqlite").is_file() || path.join(LEGACY_DATABASE).is_file()}

pub fn open_database(project: &Path) -> rusqlite::Result<Connection> {
    let destination = project.join("spielberg.sqlite");
    let legacy = project.join(LEGACY_DATABASE);
    if !destination.exists() && legacy.is_file() {
        let source = Connection::open(&legacy)?;
        source.busy_timeout(std::time::Duration::from_secs(10))?;
        // SQLite creates a consistent snapshot, including committed WAL data.
        // Keep the old database as a backup, and publish only a completed copy.
        let temporary = project.join(format!("spielberg-migration-{}.sqlite", uuid::Uuid::new_v4()));
        if let Err(error) = source.execute("VACUUM INTO ?1", [temporary.to_string_lossy().as_ref()]) {
            let _ = fs::remove_file(&temporary);
            return Err(error);
        }
        fs::rename(&temporary, &destination)
            .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
    }
    Connection::open(destination)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preserves_registry_paths_and_does_not_overwrite_new_registry() {
        let base = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        let legacy = base.join(LEGACY_IDENTIFIER);
        let root = base.join("com.spielberg.studio");
        fs::create_dir_all(&legacy).unwrap();
        let contents = r#"[{"id":"existing","path":"/original/project"}]"#;
        fs::write(legacy.join("projects.json"), contents).unwrap();
        initialize_root(&root).unwrap();
        assert_eq!(fs::read_to_string(root.join("projects.json")).unwrap(), contents);
        fs::write(root.join("projects.json"), "[]").unwrap();
        initialize_root(&root).unwrap();
        assert_eq!(fs::read_to_string(root.join("projects.json")).unwrap(), "[]");
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn migrates_wal_data_and_keeps_new_database_authoritative() {
        let project = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        fs::create_dir_all(&project).unwrap();
        let legacy = Connection::open(project.join(LEGACY_DATABASE)).unwrap();
        legacy.execute_batch("PRAGMA journal_mode=WAL; CREATE TABLE sample(value TEXT); INSERT INTO sample VALUES('saved');").unwrap();
        let current = open_database(&project).unwrap();
        assert_eq!(current.query_row("SELECT value FROM sample", [], |row| row.get::<_, String>(0)).unwrap(), "saved");
        current.execute("UPDATE sample SET value='updated'", []).unwrap();
        drop(current);
        let reopened = open_database(&project).unwrap();
        assert_eq!(reopened.query_row("SELECT value FROM sample", [], |row| row.get::<_, String>(0)).unwrap(), "updated");
        assert!(project.join(LEGACY_DATABASE).exists());
        drop(reopened);
        drop(legacy);
        fs::remove_dir_all(project).unwrap();
    }
}
