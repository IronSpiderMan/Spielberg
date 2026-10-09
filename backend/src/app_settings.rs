use super::*;

pub(super) fn projects_directory(s: &AppState) -> Result<PathBuf, String> {
    let file = s.root.join("app-settings.json");
    if !file.exists() { return Ok(s.root.join("projects")); }
    let settings: Value = serde_json::from_str(&fs::read_to_string(file).map_err(|e| e.to_string())?)
        .map_err(|e| format!("读取项目路径配置失败：{e}"))?;
    let path = PathBuf::from(strv(&settings, "projects_directory")?);
    if !path.is_absolute() { return Err("项目存储路径必须是绝对路径".into()); }
    Ok(path)
}

pub(super) fn load(s: &AppState) -> Result<Value, String> {
    Ok(json!({"projects_directory": projects_directory(s)?}))
}

pub(super) fn save(s: &AppState, v: &Value) -> Result<Value, String> {
    let raw = strv(v, "projects_directory")?;
    let path = PathBuf::from(raw.trim());
    if raw.trim().is_empty() { return Err("请输入项目存储路径".into()); }
    if !path.is_absolute() { return Err("请输入完整的绝对路径".into()); }
    fs::create_dir_all(&path).map_err(|e| format!("无法创建项目存储目录：{e}"))?;
    let path = path.canonicalize().map_err(|e| e.to_string())?;
    let probe = path.join(format!(".spielberg-write-check-{}", Uuid::new_v4()));
    fs::write(&probe, b"").map_err(|e| format!("项目存储目录不可写：{e}"))?;
    fs::remove_file(probe).map_err(|e| e.to_string())?;
    let settings = json!({"projects_directory": path});
    let temporary = s.root.join("app-settings.json.tmp");
    fs::write(&temporary, serde_json::to_vec_pretty(&settings).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    fs::rename(temporary, s.root.join("app-settings.json")).map_err(|e| e.to_string())?;
    Ok(settings)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn project_directory_persists_and_applies_to_new_and_restored_projects() {
        let root = std::env::temp_dir().join(format!("spielberg-settings-{}", Uuid::new_v4()));
        storage::initialize_root(&root).unwrap();
        let state = AppState { root: root.clone(), guard: std::sync::Arc::new(Mutex::new(())) };
        let original = create_project(&state, &json!({"name":"Original"})).unwrap();
        assert_eq!(Path::new(original["path"].as_str().unwrap()).parent().unwrap(), root.join("projects"));
        let target = root.join("custom-projects");
        save(&state, &json!({"projects_directory":target})).unwrap();
        let restarted = AppState { root: root.clone(), guard: std::sync::Arc::new(Mutex::new(())) };
        let configured = projects_directory(&restarted).unwrap();
        assert_eq!(configured, target.canonicalize().unwrap());
        let created = create_project(&restarted, &json!({"name":"New"})).unwrap();
        assert_eq!(Path::new(created["path"].as_str().unwrap()).parent().unwrap(), configured);
        assert_eq!(project(&restarted, original["id"].as_str().unwrap()).unwrap()["path"], original["path"]);
        let backup = root.join("backup.spielberg-backup");
        project_backup::command(&restarted, &json!({"project_id":original["id"],"path":backup}), false).unwrap();
        let restored = project_backup::command(&restarted, &json!({"path":backup}), true).unwrap();
        assert_eq!(Path::new(restored["path"].as_str().unwrap()).parent().unwrap(), configured);
        for invalid in ["", "relative/path", original["path"].as_str().unwrap()] {
            let value = if invalid == original["path"].as_str().unwrap() {
                json!({"projects_directory":Path::new(invalid).join("spielberg.sqlite")})
            } else { json!({"projects_directory":invalid}) };
            assert!(save(&restarted, &value).is_err());
            assert_eq!(projects_directory(&restarted).unwrap(), configured);
        }
        fs::remove_dir_all(root).unwrap();
    }
}
