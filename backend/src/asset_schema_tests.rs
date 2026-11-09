use super::*;

#[test]
fn version_15_rename_preserves_assets_foreign_keys_views_and_triggers() {
    let c = Connection::open_in_memory().unwrap();
    c.execute_batch("PRAGMA foreign_keys=ON;
        CREATE TABLE media(id INTEGER PRIMARY KEY,name TEXT,path TEXT,kind TEXT,created_at TEXT);
        CREATE TABLE roles(id INTEGER PRIMARY KEY,name TEXT,description TEXT,design_media_id INTEGER REFERENCES media(id),created_at TEXT,enabled INTEGER,category TEXT);
        CREATE TABLE role_media(role_id INTEGER REFERENCES roles(id) ON DELETE CASCADE,media_id INTEGER REFERENCES media(id),PRIMARY KEY(role_id,media_id));
        CREATE TABLE role_audio(role_id INTEGER REFERENCES roles(id) ON DELETE CASCADE,media_id INTEGER REFERENCES media(id),name TEXT,PRIMARY KEY(role_id,media_id));
        CREATE TABLE revisions(section TEXT PRIMARY KEY,version INTEGER NOT NULL DEFAULT 0);
        INSERT INTO revisions VALUES('roles',6);
        CREATE VIEW asset_usage AS SELECT roles.id AS asset_id,roles.design_media_id AS media_id FROM roles;
        CREATE TRIGGER revision_roles_UPDATE AFTER UPDATE ON roles BEGIN UPDATE revisions SET version=version+1 WHERE section='roles'; END;
        INSERT INTO media VALUES(7,'主图','/image.png','image','1'),(8,'声音','/voice.wav','audio','1');
        INSERT INTO roles VALUES(42,'魏来','描述',7,'1',0,'person');
        INSERT INTO role_media VALUES(42,7);
        INSERT INTO role_audio VALUES(42,8,'平静');
        PRAGMA user_version=15;").unwrap();
    migrate_to(&c,16).unwrap();
    migrate_to(&c,16).unwrap();
    assert_eq!(c.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0)).unwrap(), 16);
    assert!(!c.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='roles')", [], |r| r.get::<_, bool>(0)).unwrap());
    let asset: (String,String,i64,bool,String) = c.query_row("SELECT name,description,design_media_id,enabled,category FROM assets WHERE id=42", [], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?))).unwrap();
    assert_eq!(asset, ("魏来".into(),"描述".into(),7,false,"person".into()));
    assert_eq!(c.query_row("SELECT media_id FROM asset_usage WHERE asset_id=42", [], |r| r.get::<_,i64>(0)).unwrap(),7);
    for table in ["role_media","role_audio"] {
        let targets = c.prepare(&format!("PRAGMA foreign_key_list({table})")).unwrap().query_map([], |r| r.get::<_,String>(2)).unwrap().collect::<Result<Vec<_>,_>>().unwrap();
        assert!(targets.contains(&"assets".to_string()));
        assert!(!targets.contains(&"roles".to_string()));
    }
    c.execute("UPDATE assets SET name='魏来新名' WHERE id=42", []).unwrap();
    assert_eq!(catalog::revisions(&c).unwrap()["assets"],7);
    c.execute("DELETE FROM assets WHERE id=42", []).unwrap();
    assert_eq!(c.query_row("SELECT COUNT(*) FROM role_media", [], |r| r.get::<_,i64>(0)).unwrap(),0);
    assert_eq!(c.query_row("SELECT COUNT(*) FROM role_audio", [], |r| r.get::<_,i64>(0)).unwrap(),0);
    assert_eq!(c.query_row("SELECT COUNT(*) FROM media", [], |r| r.get::<_,i64>(0)).unwrap(),2);
    assert!(!c.prepare("PRAGMA foreign_key_check").unwrap().exists([]).unwrap());
}

#[test]
fn failed_rename_rolls_back_schema_version_and_preserves_legacy_rows() {
    let c = Connection::open_in_memory().unwrap();
    c.execute_batch("CREATE TABLE roles(id INTEGER PRIMARY KEY,name TEXT); INSERT INTO roles VALUES(1,'原资产'); CREATE TABLE assets(id INTEGER PRIMARY KEY); PRAGMA user_version=15;").unwrap();
    assert!(migrate(&c).is_err());
    assert_eq!(c.query_row("PRAGMA user_version", [], |r| r.get::<_,i64>(0)).unwrap(),15);
    assert_eq!(c.query_row("SELECT name FROM roles WHERE id=1", [], |r| r.get::<_,String>(0)).unwrap(),"原资产");
    assert!(!c.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name='asset_relations')", [], |r| r.get::<_,bool>(0)).unwrap());
}

#[test]
fn agent_relationship_updates_are_visible_in_incremental_project_snapshots() {
    let root = std::env::temp_dir().join(format!("asset-agent-{}",Uuid::new_v4()));
    storage::initialize_root(&root).unwrap();
    let state = AppState { root: root.clone(), guard: std::sync::Arc::new(Mutex::new(())) };
    let project = create_project(&state,&json!({"name":"关系设定"})).unwrap();
    let pid = project["id"].as_str().unwrap();
    for name in ["魏来","魏宁"] {
        rest::crud(&state,"POST",&format!("projects/{pid}/assets"),json!({"name":name})).unwrap();
    }
    let args = json!({"resource":"asset-relations","method":"POST","data":{"source_asset_id":1,"target_asset_id":2,"label":"兄妹"}});
    let relation = agent_tools::execute(&state,pid,"app_request",&args,false,&json!({})).unwrap();
    let before = snapshot(&state,pid).unwrap();
    assert_eq!(before["asset_relations"][0],relation);
    let update = json!({"resource":"asset-relations","method":"PATCH","id":relation["id"],"data":{"description":"魏来是哥哥，魏宁是妹妹"}});
    agent_tools::execute(&state,pid,"app_request",&update,false,&json!({})).unwrap();
    let changed = snapshot_changes(&state,pid,&before["revisions"]).unwrap();
    assert_eq!(changed["asset_relations"][0]["description"],"魏来是哥哥，魏宁是妹妹");
    assert!(changed.get("assets").is_none());
    fs::remove_dir_all(root).unwrap();
}
