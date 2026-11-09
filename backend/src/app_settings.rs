use super::*;
use std::net::{IpAddr, SocketAddr, TcpListener};

fn read(root: &Path) -> Result<Value, String> {
    let contents = match fs::read(root.join("app-settings.json")) {
        Ok(contents) => contents,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(json!({})),
        Err(error) => return Err(error.to_string()),
    };
    let settings: Value = serde_json::from_slice(&contents)
        .map_err(|error| format!("读取工作室设置失败：{error}"))?;
    if !settings.is_object() { return Err("工作室设置必须是 JSON 对象".into()); }
    Ok(settings)
}

fn write(root: &Path, settings: &Value) -> Result<(), String> {
    let temporary = root.join(format!("app-settings-{}.tmp", Uuid::new_v4()));
    let contents = serde_json::to_vec_pretty(settings).map_err(|error| error.to_string())?;
    let result = fs::write(&temporary, contents)
        .and_then(|_| fs::rename(&temporary, root.join("app-settings.json")));
    if result.is_err() { let _ = fs::remove_file(&temporary); }
    result.map_err(|error| error.to_string())
}

pub(super) fn projects_directory(s: &AppState) -> Result<PathBuf, String> {
    let settings = read(&s.root)?;
    if settings.get("projects_directory").is_none() { return Ok(s.root.join("projects")); }
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
    let mut settings = read(&s.root)?;
    settings["projects_directory"] = json!(path);
    write(&s.root, &settings)?;
    Ok(json!({"projects_directory":path}))
}

fn parse_listener(value: &Value) -> Result<SocketAddr, String> {
    let host = value["host"].as_str().unwrap_or("").trim();
    let ip = if host.eq_ignore_ascii_case("localhost") {
        IpAddr::V4(std::net::Ipv4Addr::LOCALHOST)
    } else {
        host.parse::<IpAddr>()
            .or_else(|_| host.strip_prefix('[').and_then(|s| s.strip_suffix(']')).unwrap_or("").parse())
            .map_err(|_| "监听主机请输入 IPv4、IPv6 地址或 localhost".to_string())?
    };
    let port = value["port"].as_u64().and_then(|port| u16::try_from(port).ok())
        .filter(|&port| port != 0).ok_or("端口必须是 1 到 65535 之间的整数")?;
    Ok(SocketAddr::new(ip, port))
}

fn listener_address(settings: &Value) -> Result<Option<SocketAddr>, String> {
    settings.get("listener").map(parse_listener).transpose()
}

pub(super) fn configured_listener(root: &Path) -> Result<Option<SocketAddr>, String> {
    listener_address(&read(root)?)
}

#[derive(Clone, Copy)]
pub(super) struct ListenerSettings {
    pub active: SocketAddr,
    pub overridden: bool,
}

impl ListenerSettings {
    fn status(self, saved: SocketAddr) -> Value {
        json!({
            "host": saved.ip().to_string(), "port": saved.port(), "active": self.active.to_string(),
            "overridden": self.overridden, "restart_required": saved != self.active,
        })
    }

    pub fn load(self, root: &Path) -> Result<Value, String> {
        let saved = if self.overridden { self.active } else { configured_listener(root)?.unwrap_or(self.active) };
        Ok(self.status(saved))
    }

    pub fn save(self, root: &Path, requested: &Value) -> rest::ApiResult<Value> {
        use axum::http::StatusCode;
        if self.overridden {
            return Err(rest::ApiError(StatusCode::CONFLICT, "当前监听地址由启动参数指定".into()));
        }
        let address = parse_listener(requested).map_err(|error| rest::ApiError(StatusCode::BAD_REQUEST, error))?;
        if address != self.active {
            let probe = TcpListener::bind(address).or_else(|error| {
                // A wildcard and a specific interface can overlap while the current server is running.
                if error.kind() == std::io::ErrorKind::AddrInUse && address.port() == self.active.port()
                    && (address.ip().is_unspecified() || self.active.ip().is_unspecified()) {
                    TcpListener::bind(SocketAddr::new(address.ip(), 0))
                } else { Err(error) }
            });
            probe.map_err(|error| rest::ApiError(StatusCode::CONFLICT, format!("无法监听 {address}：{error}")))?;
        }
        let mut settings = read(root)?;
        settings["listener"] = json!({"host":address.ip().to_string(),"port":address.port()});
        write(root, &settings)?;
        Ok(self.status(address))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn listener_persists_independently_of_project_directory_and_rejects_invalid_updates() {
        let root = std::env::temp_dir().join(format!("spielberg-listener-{}", Uuid::new_v4()));
        storage::initialize_root(&root).unwrap();
        let state = AppState { root: root.clone(), guard: Default::default() };
        let socket = TcpListener::bind("127.0.0.1:0").unwrap();
        let active = socket.local_addr().unwrap();
        let listener = ListenerSettings { active, overridden: false };

        let saved = listener.save(&root, &json!({"host":"0.0.0.0", "port":active.port()})).unwrap();
        assert_eq!(saved["active"], active.to_string());
        assert_eq!(saved["restart_required"], true);
        assert_eq!(projects_directory(&state).unwrap(), root.join("projects"));
        let directory = root.join("other-projects");
        save(&state, &json!({"projects_directory":directory})).unwrap();
        assert_eq!(listener.load(&root).unwrap(), saved);

        let occupied = TcpListener::bind("127.0.0.1:0").unwrap();
        for (value, status) in [
            (json!({"host":"https://localhost", "port":8080}), axum::http::StatusCode::BAD_REQUEST),
            (json!({"host":"localhost", "port":65536}), axum::http::StatusCode::BAD_REQUEST),
            (json!({"host":"localhost", "port":occupied.local_addr().unwrap().port()}), axum::http::StatusCode::CONFLICT),
        ] {
            assert_eq!(listener.save(&root, &value).unwrap_err().0, status);
            assert_eq!(listener.load(&root).unwrap(), saved);
        }

        let next = configured_listener(&root).unwrap().unwrap();
        let restarted = ListenerSettings { active: next, overridden: false };
        assert_eq!(restarted.load(&root).unwrap()["restart_required"], false);
        assert_eq!(projects_directory(&state).unwrap(), directory.canonicalize().unwrap());
        fs::remove_dir_all(root).unwrap();
    }

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
