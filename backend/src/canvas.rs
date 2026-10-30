use super::*;
use std::collections::HashSet;

// Legacy project board schema, retained only for migration. Keep IDs rather than file paths so backups remain portable.
pub fn install(c: &Connection) -> Result<(), String> {
    c.execute_batch("CREATE TABLE IF NOT EXISTS canvas_board(id INTEGER PRIMARY KEY CHECK(id=1),draft TEXT NOT NULL,revision INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS canvas_sources(media_id INTEGER PRIMARY KEY REFERENCES media(id));").map_err(|e| e.to_string())?;
    let sql: String = c.query_row("SELECT sql FROM sqlite_master WHERE type='view' AND name='asset_usage'", [], |r| r.get(0)).map_err(|e| e.to_string())?;
    if !sql.contains("canvas_sources") {
        c.execute_batch(&format!("DROP VIEW asset_usage; {sql} UNION ALL SELECT media_id,'canvas',0,'无限画布',NULL,NULL,'画布素材' FROM canvas_sources;")).map_err(|e| e.to_string())?;
    }
    Ok(())
}
fn empty() -> Value { json!({"version":1,"nodes":[],"edges":[],"viewport":{"x":80,"y":80,"zoom":1}}) }
pub fn install_scenes(c: &Connection) -> Result<(), String> {
    c.execute_batch("ALTER TABLE scenes ADD COLUMN creation_mode TEXT NOT NULL DEFAULT 'default' CHECK(creation_mode IN ('default','canvas'));
        CREATE TABLE scene_canvases(scene_id INTEGER PRIMARY KEY REFERENCES scenes(id) ON DELETE CASCADE,draft TEXT NOT NULL,revision INTEGER NOT NULL);
        CREATE TABLE scene_canvas_sources(scene_id INTEGER NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,media_id INTEGER NOT NULL REFERENCES media(id),PRIMARY KEY(scene_id,media_id));").map_err(|e|e.to_string())?;
    let sql:String=c.query_row("SELECT sql FROM sqlite_master WHERE type='view' AND name='asset_usage'",[],|r|r.get(0)).map_err(|e|e.to_string())?;
    c.execute_batch(&format!("DROP VIEW asset_usage; {sql} UNION ALL SELECT cs.media_id,'canvas',s.id,s.title,e.id,e.title,'画布素材' FROM scene_canvas_sources cs JOIN scenes s ON s.id=cs.scene_id JOIN episodes e ON e.id=s.episode_id;")).map_err(|e|e.to_string())?;
    // Preserve the previous project board as a canvas scene under the first episode.
    let old:Option<(String,i64)>=c.query_row("SELECT draft,revision FROM canvas_board WHERE id=1",[],|r|Ok((r.get(0)?,r.get(1)?))).optional().map_err(|e|e.to_string())?;
    if let Some((draft,revision))=old {
        let value:Value=serde_json::from_str(&draft).map_err(|e|e.to_string())?;
        if value["nodes"].as_array().is_some_and(|nodes|!nodes.is_empty()) {
            let ep:Option<i64>=c.query_row("SELECT id FROM episodes ORDER BY sort_order,id LIMIT 1",[],|r|r.get(0)).optional().map_err(|e|e.to_string())?;
            let ep=if let Some(id)=ep{id}else{c.execute("INSERT INTO episodes(title,sort_order,created_at) VALUES('画布创作',0,?)",[now()]).map_err(|e|e.to_string())?;c.last_insert_rowid()};
            c.execute("INSERT INTO scenes(episode_id,title,sort_order,created_at,creation_mode) SELECT ?,'原项目画布',COALESCE(MAX(sort_order),-1)+1,?,'canvas' FROM scenes WHERE episode_id=?",params![ep,now(),ep]).map_err(|e|e.to_string())?;
            let scene=c.last_insert_rowid();
            c.execute("INSERT INTO scene_canvases VALUES(?,?,?)",params![scene,draft,revision]).map_err(|e|e.to_string())?;
            c.execute("INSERT INTO scene_canvas_sources SELECT ?,media_id FROM canvas_sources",[scene]).map_err(|e|e.to_string())?;
        }
        c.execute_batch("DELETE FROM canvas_sources; DELETE FROM canvas_board;").map_err(|e|e.to_string())?;
    }
    Ok(())
}
fn load(c: &Connection, scene:i64) -> Result<Value, String> {
    c.query_row("SELECT draft,revision FROM scene_canvases WHERE scene_id=?", [scene], |r| Ok((r.get::<_,String>(0)?,r.get::<_,i64>(1)?)))
        .optional().map_err(|e|e.to_string())?.map(|(draft,revision)| Ok(json!({"draft":serde_json::from_str::<Value>(&draft).map_err(|e|e.to_string())?,"revision":revision})))
        .unwrap_or_else(|| Ok(json!({"draft":empty(),"revision":0})))
}
fn validate(c: &Connection, draft: &Value) -> Result<HashSet<i64>, String> {
    if draft["version"] != 1 { return Err("画布版本无效".into()); }
    let nodes=draft["nodes"].as_array().ok_or("缺少画布节点")?;
    let edges=draft["edges"].as_array().ok_or("缺少画布连线")?;
    if nodes.len()>500 || edges.len()>1000 || draft.to_string().len()>2_000_000 { return Err("画布超过大小限制（500 个节点 / 1000 条连线）".into()); }
    let number=|v:&Value| v.as_f64().is_some_and(|n|n.is_finite() && n.abs()<=1_000_000.0);
    let view=&draft["viewport"];
    if !number(&view["x"]) || !number(&view["y"]) || !view["zoom"].as_f64().is_some_and(|z|(0.2..=2.0).contains(&z)) { return Err("画布视角无效".into()); }
    let mut ids=HashSet::new(); let mut sources=HashSet::new();
    for node in nodes {
        let id=strv(node,"id")?;
        if id.is_empty() || id.len()>100 || !ids.insert(id) || !number(&node["x"]) || !number(&node["y"]) { return Err("画布节点 ID 或位置无效".into()); }
        match node["kind"].as_str() {
            Some("media"|"image"|"audio"|"video")=>{if let Some(mid)=node["ref_id"].as_i64() {
                let m=media(c,Some(mid)).ok_or("画布素材不存在或已被移除，请移除或替换对应素材")?;
                if node["kind"]!="media" && node["kind"]!=m["kind"] {return Err("节点与素材类型不符".into());}
                sources.insert(mid);
            } else if !node["ref_id"].is_null(){return Err("画布素材 ID 无效".into());}
            if let Some(prompt)=node.get("prompt"){if !prompt.as_str().is_some_and(|s|s.len()<=20_000){return Err("视频描述无效或过长".into());}}
            if let Some(duration)=node.get("duration"){if !duration.as_u64().is_some_and(|n|(1..=120).contains(&n)){return Err("视频时长无效".into());}}},
            Some("scene"|"role"|"prompt")=>{if !node["ref_id"].as_i64().is_some_and(|id|id>0){return Err("画布引用 ID 无效".into());}},
            Some("note")=>{if !node["text"].as_str().is_some_and(|t|t.len()<=20_000){return Err("便签内容无效或过长".into());}},
            _=>return Err("画布节点类型无效".into())
        }
    }
    let mut edge_ids=HashSet::new(); let mut pairs=HashSet::new();
    for edge in edges {
        let id=strv(edge,"id")?;let from=strv(edge,"from")?;let to=strv(edge,"to")?;
        if id.is_empty() || id.len()>100 || !edge_ids.insert(id) || from==to || !ids.contains(&from) || !ids.contains(&to) || !pairs.insert((from.clone(),to.clone())) {return Err("画布连线无效".into());}
        let source=nodes.iter().find(|n|n["id"]==from).unwrap();
        let target=nodes.iter().find(|n|n["id"]==to).unwrap();
        let typed=|n:&Value|matches!(n["kind"].as_str(),Some("image"|"audio"|"video"));
        if (typed(source)||typed(target)) && (!(typed(source)||source["kind"]=="note")||!(target["kind"]=="video" || (target["kind"]=="image" && (source["kind"]=="image" || source["kind"]=="note")))) {return Err("图片输入仅支持图片或便签，视频输入支持素材或便签".into());}
    }
    fn visit(id:&str,edges:&[Value],active:&mut HashSet<String>,done:&mut HashSet<String>)->bool {
        if done.contains(id){return true;} if !active.insert(id.into()){return false;}
        for edge in edges.iter().filter(|e|e["from"]==id) {if !visit(edge["to"].as_str().unwrap(),edges,active,done){return false;}}
        active.remove(id);done.insert(id.into());true
    }
    let mut done=HashSet::new();
    for node in nodes {if !visit(node["id"].as_str().unwrap(),edges,&mut HashSet::new(),&mut done){return Err("画布连接不能形成循环".into());}}
    Ok(sources)
}
pub fn command(s:&AppState,v:&Value,save:bool)->Result<Value,String> {
    let pid=project_id(v)?;let mut c=db(s,&pid)?;let scene=intv(v,"scene_id")?;
    let mode:Option<String>=c.query_row("SELECT creation_mode FROM scenes WHERE id=?",[scene],|r|r.get(0)).optional().map_err(|e|e.to_string())?;
    if mode.as_deref()!=Some("canvas"){return Err("画布场景不存在，请先创建画布场景".into());}
    if save {
        let draft=&v["draft"]; let sources=validate(&c,draft)?;
        let revision=intv(v,"revision")?;
        let tx=c.transaction().map_err(|e|e.to_string())?;
        let current:i64=tx.query_row("SELECT revision FROM scene_canvases WHERE scene_id=?",[scene],|r|r.get(0)).optional().map_err(|e|e.to_string())?.unwrap_or(0);
        if revision!=current {return Err("画布已在其他窗口更新，请重新加载后再编辑；当前草稿可先导出保存".into());}
        tx.execute("INSERT INTO scene_canvases VALUES(?,?,?) ON CONFLICT(scene_id) DO UPDATE SET draft=excluded.draft,revision=excluded.revision",params![scene,draft.to_string(),current+1]).map_err(|e|e.to_string())?;
        tx.execute("DELETE FROM scene_canvas_sources WHERE scene_id=?",[scene]).map_err(|e|e.to_string())?;
        for mid in sources {tx.execute("INSERT INTO scene_canvas_sources VALUES(?,?)",params![scene,mid]).map_err(|e|e.to_string())?;}
        tx.commit().map_err(|e|e.to_string())?;touch(s,&pid);
    }
    load(&c,scene)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> (AppState, Value, Value) {
        let root=std::env::temp_dir().join(format!("canvas-test-{}",Uuid::new_v4()));fs::create_dir_all(&root).unwrap();
        let state=AppState{root,guard:std::sync::Arc::new(Mutex::new(()))};
        let p=create_project(&state,&json!({"name":"Canvas QA"})).unwrap();
        let ep=insert_episode(&state,&json!({"project_id":p["id"],"title":"Episode"})).unwrap();
        (state,p,ep)
    }
    fn canvas_scene(s:&AppState,p:&Value,ep:&Value)->Value {
        insert_scene(s,&json!({"project_id":p["id"],"episode_id":ep["id"],"title":"Canvas","creation_mode":"canvas"})).unwrap()
    }
    #[test]
    fn legacy_project_board_migrates_to_scene_without_losing_layout() {
        let c=Connection::open_in_memory().unwrap();migrate(&c).unwrap();
        c.execute_batch("DROP VIEW asset_usage; DROP TABLE scene_canvas_sources; DROP TABLE scene_canvases; ALTER TABLE scenes DROP COLUMN creation_mode; PRAGMA user_version=9;").unwrap();
        catalog::install(&c).unwrap();install(&c).unwrap();
        c.execute("INSERT INTO media(id,name,path,kind,created_at) VALUES(1,'image','/image','image','1')",[]).unwrap();
        let mut draft=empty();draft["nodes"]=json!([{"id":"a","kind":"media","ref_id":1,"x":-50,"y":100}]);
        c.execute("INSERT INTO canvas_board VALUES(1,?,7)",[draft.to_string()]).unwrap();c.execute("INSERT INTO canvas_sources VALUES(1)",[]).unwrap();
        migrate(&c).unwrap();migrate(&c).unwrap();
        let id:i64=c.query_row("SELECT id FROM scenes WHERE creation_mode='canvas'",[],|r|r.get(0)).unwrap();
        assert_eq!(load(&c,id).unwrap(),json!({"draft":draft,"revision":7}));
        let uses=catalog::usages(&c,1).unwrap();assert_eq!(uses.len(),1);assert_eq!(uses[0]["target_id"],id);
        assert_eq!(c.query_row("SELECT COUNT(*) FROM canvas_board",[],|r|r.get::<_,i64>(0)).unwrap(),0);
        assert_eq!(c.query_row("PRAGMA user_version",[],|r|r.get::<_,i64>(0)).unwrap(),12);
    }
    #[test]
    fn only_media_to_video_and_acyclic_connections_are_valid() {
        let c=Connection::open_in_memory().unwrap();migrate(&c).unwrap();
        c.execute_batch("INSERT INTO media(id,name,path,kind,created_at) VALUES(1,'image','/i','image','1'),(2,'sound','/a','audio','1'),(3,'video','/v','video','1');").unwrap();
        let mut draft=empty();draft["nodes"]=json!([
            {"id":"i","kind":"image","ref_id":1,"x":0,"y":0},
            {"id":"a","kind":"audio","ref_id":2,"x":0,"y":200},
            {"id":"v","kind":"video","ref_id":3,"x":0,"y":400},
            {"id":"out","kind":"video","prompt":"Generate","duration":5,"x":400,"y":0}
        ]);
        draft["edges"]=json!([{"id":"e1","from":"i","to":"out"},{"id":"e2","from":"a","to":"out"},{"id":"e3","from":"v","to":"out"}]);
        assert_eq!(validate(&c,&draft).unwrap(),HashSet::from([1,2,3]));
        draft["nodes"].as_array_mut().unwrap().push(json!({"id":"image-out","kind":"image","prompt":"Generate image","x":400,"y":200}));
        draft["edges"]=json!([{"id":"image-edge","from":"i","to":"image-out"}]);assert!(validate(&c,&draft).is_ok());
        draft["edges"]=json!([{"id":"image-edge","from":"a","to":"image-out"}]);assert!(validate(&c,&draft).is_err());
        draft["edges"]=json!([{"id":"e","from":"v","to":"i"}]);assert!(validate(&c,&draft).is_err());
        draft["edges"]=json!([{"id":"e1","from":"v","to":"out"},{"id":"e2","from":"out","to":"v"}]);assert!(validate(&c,&draft).is_err());
        draft["nodes"].as_array_mut().unwrap().push(json!({"id":"text","kind":"note","text":"A scene","x":-400,"y":0}));
        draft["edges"]=json!([{"id":"text-edge","from":"text","to":"out"}]);assert!(validate(&c,&draft).is_ok());
        draft["edges"]=json!([]);draft["nodes"][0]["ref_id"]=json!(2);assert!(validate(&c,&draft).is_err());
    }
    #[test]
    fn scenes_are_isolated_and_copy_delete_preserve_reference_integrity() {
        let (s,p,ep)=fixture();let first=canvas_scene(&s,&p,&ep);let second=canvas_scene(&s,&p,&ep);let pid=p["id"].as_str().unwrap();
        let c=db(&s,pid).unwrap();c.execute("INSERT INTO media(id,name,path,kind,created_at) VALUES(1,'image','/image','image','1')",[]).unwrap();drop(c);
        let mut draft=empty();draft["nodes"]=json!([{"id":"image","kind":"image","ref_id":1,"x":0,"y":0}]);
        let request=json!({"project_id":pid,"scene_id":first["id"],"revision":0,"draft":draft});
        assert_eq!(command(&s,&request,true).unwrap()["revision"],1);assert!(command(&s,&request,true).is_err());
        assert_eq!(command(&s,&json!({"project_id":pid,"scene_id":second["id"]}),false).unwrap()["draft"],empty());
        let copy=duplicate_scene(&s,&json!({"project_id":pid,"id":first["id"]})).unwrap();
        assert_eq!(command(&s,&json!({"project_id":pid,"scene_id":copy["id"]}),false).unwrap()["draft"],draft);
        let c=db(&s,pid).unwrap();assert_eq!(catalog::usages(&c,1).unwrap().len(),2);assert!(catalog::trash(&c,1).is_err());
        c.execute("DELETE FROM scenes WHERE id IN (?,?)",params![first["id"].as_i64(),copy["id"].as_i64()]).unwrap();
        assert!(catalog::usages(&c,1).unwrap().is_empty());catalog::trash(&c,1).unwrap();drop(c);fs::remove_dir_all(s.root).unwrap();
    }
    #[test]
    fn http_creation_mode_and_canvas_scope_roundtrip() {
        let root=std::env::temp_dir().join(format!("canvas-http-{}",Uuid::new_v4()));let server=Backend::start(root.clone(),"127.0.0.1:0").unwrap();
        let client=reqwest::blocking::Client::new();
        let api=|path:&str,value:Value|->Value{client.post(format!("{}/api/v1{path}",server.url)).json(&value).send().unwrap().error_for_status().unwrap().json::<Value>().unwrap()["data"].clone()};
        let p=api("/projects",json!({"name":"HTTP canvas"}));let pid=p["id"].as_str().unwrap();
        let ep=api(&format!("/projects/{pid}/episodes"),json!({"title":"Episode"}));
        let path=format!("/projects/{pid}/episodes/{}/scenes",ep["id"]);
        let normal=api(&path,json!({"title":"Normal"}));assert_eq!(normal["creation_mode"],"default");
        let scene=api(&path,json!({"title":"Canvas","creation_mode":"canvas"}));assert_eq!(scene["creation_mode"],"canvas");
        let mut draft=empty();draft["nodes"]=json!([{"id":"video","kind":"video","x":0,"y":0,"prompt":"Video"}]);
        let body=json!({"project_id":pid,"scene_id":scene["id"],"revision":0,"draft":draft});
        assert_eq!(api("/actions/canvas/save",body.clone())["revision"],1);
        assert_eq!(api("/actions/canvas/load",json!({"project_id":pid,"scene_id":scene["id"]}))["draft"],draft);
        assert_eq!(client.post(format!("{}/api/v1/actions/canvas/save",server.url)).json(&body).send().unwrap().status(),reqwest::StatusCode::BAD_REQUEST);
        assert_eq!(client.post(format!("{}/api/v1/actions/canvas/load",server.url)).json(&json!({"project_id":pid,"scene_id":normal["id"]})).send().unwrap().status(),reqwest::StatusCode::NOT_FOUND);
        let snap=api("/actions/project",json!({"id":pid}));assert_eq!(snap["episodes"][0]["scenes"][1]["creation_mode"],"canvas");
        drop(server);fs::remove_dir_all(root).unwrap();
    }
}
