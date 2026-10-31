use super::*;
use axum::{http::StatusCode, response::{IntoResponse, Response}, Json};

#[derive(Debug)]
pub(crate) struct ApiError(pub StatusCode, pub String);
pub(crate) type ApiResult<T> = Result<T, ApiError>;
impl From<String> for ApiError {
    fn from(message: String) -> Self {
        let status = if message.contains("不存在") { StatusCode::NOT_FOUND }
            else if message.contains("引用") || message.contains("后台任务") || message.contains("生成任务") || message.contains("FOREIGN KEY") { StatusCode::CONFLICT }
            else { StatusCode::BAD_REQUEST };
        Self(status, message)
    }
}
impl IntoResponse for ApiError {
    fn into_response(self) -> Response { (self.0, Json(json!({"error":self.1}))).into_response() }
}
fn bad(message: &str) -> ApiError { ApiError(StatusCode::BAD_REQUEST, message.into()) }
fn missing() -> ApiError { ApiError(StatusCode::NOT_FOUND, "资源不存在".into()) }
fn sql_error(error: rusqlite::Error) -> ApiError {
    if let rusqlite::Error::SqliteFailure(ref code, _) = error {
        if code.code == rusqlite::ErrorCode::ConstraintViolation { return ApiError(StatusCode::CONFLICT, error.to_string()); }
    }
    ApiError(StatusCode::INTERNAL_SERVER_ERROR, error.to_string())
}
fn table(resource: &str) -> ApiResult<&'static str> {
    match resource { "roles"=>Ok("roles"),"assets"=>Ok("media"),"episodes"=>Ok("episodes"),"scenes"=>Ok("scenes"),"prompts"=>Ok("prompts"),"screenplays"=>Ok("screenplays"),_=>Err(missing()) }
}
fn rows(c: &Connection, table: &str, id: Option<i64>) -> ApiResult<Vec<Value>> {
    // table is selected exclusively by table(), never interpolated from a request.
    let condition = if table == "media" { "deleted_at IS NULL AND purged_at IS NULL" } else { "1=1" };
    let mut q = c.prepare(&format!("SELECT * FROM {table} WHERE {condition} AND (?1 IS NULL OR id=?1) ORDER BY id" )).map_err(sql_error)?;
    let names: Vec<String> = q.column_names().iter().map(|v|v.to_string()).collect();
    let result = q.query_map([id], |row| {
        let mut value = json!({});
        for (i,name) in names.iter().enumerate() {
            value[name] = match row.get_ref(i)? {
                rusqlite::types::ValueRef::Null=>Value::Null,
                rusqlite::types::ValueRef::Integer(n)=>json!(n),
                rusqlite::types::ValueRef::Real(n)=>json!(n),
                rusqlite::types::ValueRef::Text(s)=>json!(String::from_utf8_lossy(s)),
                rusqlite::types::ValueRef::Blob(_)=>Value::Null,
            };
        }
        Ok(value)
    }).map_err(sql_error)?.collect::<Result<Vec<_>,_>>().map_err(sql_error);
    result
}
fn enrich(c: &Connection, resource: &str, mut value: Value) -> ApiResult<Value> {
    let id=value["id"].as_i64().unwrap();
    if resource=="roles" {
        value["enabled"]=json!(value["enabled"].as_i64().unwrap_or(1)!=0);
        value["audios"]=json!(role_audios(c,id)?);
        let mut q=c.prepare("SELECT m.id FROM media m WHERE m.deleted_at IS NULL AND (m.id=? OR EXISTS(SELECT 1 FROM role_media r WHERE r.role_id=? AND r.media_id=m.id)) ORDER BY CASE WHEN m.id=? THEN 0 ELSE 1 END,m.id DESC").map_err(sql_error)?;
        let ids=q.query_map(params![opti(&value,"design_media_id"),id,opti(&value,"design_media_id")],|r|r.get::<_,i64>(0)).map_err(sql_error)?.collect::<Result<Vec<_>,_>>().map_err(sql_error)?;
        value["images"]=json!(ids.into_iter().filter_map(|id|media(c,Some(id))).collect::<Vec<_>>());
    } else if resource=="scenes" {
        for key in ["first","last","reference","video"] {value[format!("{key}_media")]=json!(media(c,opti(&value,&format!("{key}_media_id"))));}
        value["videos"]=json!(scene_videos(c,id)?);
        value["generation_options"]=scene_options(c,id)?;
        value["script"]=scene_script(c,id)?;
    } else if resource=="episodes" {
        value["storyboard"]=storyboard::load(c,id)?;
        value["cover_media"]=json!(media(c,opti(&value,"cover_media_id")));
        value["scenes"]=json!(rows(c,"scenes",None)?.into_iter().filter(|s|s["episode_id"]==id).map(|s|enrich(c,"scenes",s)).collect::<ApiResult<Vec<_>>>()?);
        if let Some(scenes)=value["scenes"].as_array_mut() {scenes.sort_by_key(|s|s["sort_order"].as_i64().unwrap_or(0));}
    }
    Ok(value)
}
fn get(c: &Connection, resource: &str, id: i64) -> ApiResult<Value> {
    enrich(c,resource,rows(c,table(resource)?,Some(id))?.into_iter().next().ok_or_else(missing)?)
}
fn validate(c: &Connection, resource: &str, value: &Value, create: bool) -> ApiResult<()> {
    let fields: &[&str]=match resource {
        "roles"=>&["name","description","enabled","design_media_id"],
        "episodes"=>&["title","description","cover_media_id","storyboard"],
        "scenes"=>&["creation_mode","title","description","prompt","episode_id","first_media_id","last_media_id","reference_media_id","generation_options"],
        "prompts"=>&["name","content","category"],
        "screenplays"=>&["title","content","format","episode_id"],
        "assets"=>&["name","extension","data_base64","role_id"],_=>return Err(missing()),
    };
    for (key,item) in value.as_object().ok_or_else(||bad("JSON 必须是对象"))? {
        if ["project_id","id"].contains(&key.as_str()) {continue}
        if resource=="assets" && !create && key!="name" {return Err(bad("资产更新仅支持 name"))}
        if !fields.contains(&key.as_str()) {return Err(bad(&format!("不支持的字段：{key}")))}
        if ["name","title","description","content","format","category","extension","data_base64"].contains(&key.as_str()) && !item.is_string(){return Err(bad(&format!("{key} 必须是字符串")))}
        if ["name","title"].contains(&key.as_str()) && item.as_str().unwrap_or("").trim().is_empty(){return Err(bad("名称不能为空"))}
        if key=="enabled" && !item.is_boolean(){return Err(bad("enabled 必须是布尔值"))}
        if key.ends_with("_media_id") && !item.is_null() {
            let mid=item.as_i64().filter(|n|*n>0).ok_or_else(||bad("资产 ID 无效"))?;
            let m=media(c,Some(mid)).ok_or_else(||bad("引用的资产不存在或已删除"))?;
            if m["kind"]!="image" {return Err(bad("该字段必须引用图片资产"))}
        }
        if ["role_id","episode_id"].contains(&key.as_str()) && !item.as_i64().is_some_and(|n|n>0) {return Err(bad(&format!("{key} 必须是正整数")))}
        if key=="creation_mode" && !["default","canvas"].contains(&item.as_str().unwrap_or("")){return Err(bad("创建方式必须为 default 或 canvas"))}
        if key=="creation_mode" && !create && get(c,"scenes",value["id"].as_i64().unwrap_or(0))?["creation_mode"]!=*item{return Err(bad("场景创建方式不可更改"))}
        if key=="format" && !["markdown","csv"].contains(&item.as_str().unwrap_or("")) {return Err(bad("剧本格式必须为 markdown 或 csv"))}
        if key=="generation_options" && !item.is_object(){return Err(bad("generation_options 必须是对象"))}
    }
    if create {
        let name=if resource=="scenes" || resource=="episodes" || resource=="screenplays" {"title"} else {"name"};
        if value[name].as_str().unwrap_or("").trim().is_empty(){return Err(bad(&format!("缺少 {name}")))}
    }
    if ["scenes","screenplays"].contains(&resource) && (create || value.get("episode_id").is_some()) {
        let id=value["episode_id"].as_i64().ok_or_else(||bad("缺少有效的 episode_id"))?;
        get(c,"episodes",id)?;
    }
    if resource=="screenplays" {
        let current = if create { json!({}) } else { get(c,"screenplays",intv(value,"id")?)? };
        let episode_id = value["episode_id"].as_i64().or(current["episode_id"].as_i64()).ok_or_else(||bad("缺少有效的 episode_id"))?;
        let format = value["format"].as_str().or(current["format"].as_str()).unwrap_or("markdown");
        let duplicate: bool = c.query_row("SELECT EXISTS(SELECT 1 FROM screenplays WHERE episode_id=? AND format=? AND id!=?)",params![episode_id,format,value["id"].as_i64().unwrap_or(0)],|r|r.get(0)).map_err(sql_error)?;
        if duplicate { return Err(ApiError(StatusCode::CONFLICT,"本集已有同类型剧本，请直接编辑已有内容".into())); }
    }
    Ok(())
}

// All CRUD operations share the same lock as the existing generation and storage services.
pub(crate) fn crud(state: &AppState, method: &str, path: &str, mut value: Value) -> ApiResult<Value> {
    let parts:Vec<_>=path.trim_matches('/').split('/').collect();
    let _lock=state.guard.lock().map_err(|_|ApiError(StatusCode::INTERNAL_SERVER_ERROR,"数据锁不可用".into()))?;
    if parts.first()==Some(&"projects") && parts.len()<=2 {
        let id=parts.get(1).copied();
        if id.is_none() {
            return match method {
                "GET"=>Ok(json!(registry(state)?)),
                "POST"=>{if value["name"].as_str().unwrap_or("").trim().is_empty(){return Err(bad("项目名称不能为空"))}Ok(create_project(state,&value)?)},
                _=>Err(ApiError(StatusCode::METHOD_NOT_ALLOWED,"集合支持 GET/POST".into())),
            };
        }
        let id=id.unwrap();project(state,id)?;
        match method {
            "GET"=>Ok(snapshot(state,id)?["project"].clone()),
            "PATCH"=>{
                let fields=value.as_object().ok_or_else(||bad("JSON 必须是对象"))?;
                for key in fields.keys() {if !["name","outline","agents_md","documents"].contains(&key.as_str()){return Err(bad("不支持的项目字段"))}}
                if let Some(name)=value.get("name") {if name.as_str().map_or(true,|s|s.trim().is_empty()){return Err(bad("项目名称不能为空"))}}
                if value.get("outline").is_some_and(|v|!v.is_string()){return Err(bad("大纲必须是文本"))}
                if value.get("agents_md").is_some_and(|v|!v.is_string()){return Err(bad("AGENTS.md 必须是文本"))}
                if let Some(docs)=value.get("documents") {
                    let docs=docs.as_array().ok_or_else(||bad("文档必须是数组"))?;
                    let mut ids=std::collections::HashSet::new();
                    for doc in docs {
                        let id=doc["id"].as_str().filter(|s|!s.trim().is_empty()).ok_or_else(||bad("文档 ID 无效"))?;
                        if !ids.insert(id) || doc["title"].as_str().map_or(true,|s|s.trim().is_empty()) || !doc["content"].is_string(){return Err(bad("文档需要唯一 ID、标题和正文"))}
                    }
                }
                let c=db(state,id)?;
                let raw:Option<String>=c.query_row("SELECT value FROM settings WHERE key='project_config'",[],|r|r.get(0)).optional().map_err(sql_error)?;
                let mut config:Value=raw.and_then(|s|serde_json::from_str(&s).ok()).unwrap_or(json!({"outline":"","documents":[]}));
                for key in ["outline","agents_md","documents"] {if let Some(v)=value.get(key){config[key]=v.clone();}}
                c.execute("INSERT INTO settings(key,value) VALUES('project_config',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[config.to_string()]).map_err(sql_error)?;
                let mut all=registry(state)?;let p=all.iter_mut().find(|p|p["id"]==id).ok_or_else(missing)?;
                if let Some(name)=value["name"].as_str(){p["name"]=json!(name.trim());}
                p["updated_at"]=json!("刚刚");let mut result=p.clone();save_registry(state,&all)?;
                result["agents_md"]=config.get("agents_md").cloned().unwrap_or(json!(""));result["outline"]=config["outline"].clone();result["documents"]=config["documents"].clone();Ok(result)
            },
            "DELETE"=>{catalog::no_running_jobs(&db(state,id)?)?;let mut all=registry(state)?;all.retain(|p|p["id"]!=id);save_registry(state,&all)?;Ok(json!({"deleted":true,"data_retained":true}))},
            _=>Err(ApiError(StatusCode::METHOD_NOT_ALLOWED,"不支持的方法".into())),
        }
    } else {
        let (pid,resource,id)=if parts.first()==Some(&"projects") && parts.len()==5 && parts[2]=="episodes" && ["scenes","screenplays"].contains(&parts[4]) {
            let episode_id=parts[3].parse::<i64>().ok().filter(|n|*n>0).ok_or_else(||bad("剧集 ID 无效"))?;
            if value.get("episode_id").is_some_and(|v|v.as_i64()!=Some(episode_id)) {return Err(bad("episode_id 与路径不一致"))}
            value["episode_id"]=json!(episode_id);
            (parts[1].to_string(),parts[4],None)
        } else if parts.first()==Some(&"projects") && (3..=4).contains(&parts.len()) {
            (parts[1].to_string(),parts[2],parts.get(3).copied())
        } else if parts.len()<=2 {
            (strv(&value,"project_id")?,parts[0],parts.get(1).copied())
        } else {return Err(missing())};
        let table=table(resource)?;
        value["project_id"]=json!(pid);
        let c=db(state,&pid)?;
        let id=id.map(|id|id.parse::<i64>().ok().filter(|n|*n>0).ok_or_else(||bad("资源 ID 无效"))).transpose()?;
        if let Some(id)=id {
            let current=get(&c,resource,id)?;
            value["id"]=json!(id);
            match method {
                "GET"=>Ok(current),
                "PATCH"=>{
                    validate(&c,resource,&value,false)?;
                    if resource=="scenes" && value.get("episode_id").is_some() && value["episode_id"]!=current["episode_id"] {return Err(bad("场景不能跨剧集移动，请使用场景排序接口"))}
                    let mut merged=current;
                    for (key,item) in value.as_object().unwrap() {merged[key]=item.clone();}
                    match resource {
                        "screenplays"=>{screenplays::update(state,&merged)?;},"roles"=>{update_role(state,&merged)?;},"episodes"=>{update_episode(state,&merged)?;},"scenes"=>{update_scene(state,&merged)?;},"prompts"=>{update_prompt(state,&merged)?;},"assets"=>{manage_media(state,&merged,false)?;},_=>unreachable!(),
                    }
                    get(&c,resource,id)
                },
                "DELETE"=>{
                    if resource=="assets" {manage_media(state,&value,true)?;} else {
                        c.execute(&format!("DELETE FROM {table} WHERE id=?"),[id]).map_err(sql_error)?;
                    }
                    touch(state,&pid);Ok(json!({"deleted":true}))
                },
                _=>Err(ApiError(StatusCode::METHOD_NOT_ALLOWED,"资源支持 GET/PATCH/DELETE".into())),
            }
        } else {
            match method {
                "GET"=>{
                    if resource=="assets" {return Ok(catalog::list(&c,&value)?)}
                    if let Some(ep)=value.get("episode_id") { if ["scenes","screenplays"].contains(&resource) { get(&c,"episodes",ep.as_i64().ok_or_else(||bad("剧集 ID 无效"))?)?; } }
                    let mut all=rows(&c,table,None)?;
                    if ["scenes","screenplays"].contains(&resource) {if let Some(ep)=value.get("episode_id") {all.retain(|s|s["episode_id"]==*ep);}}
                    if resource=="episodes" || resource=="scenes" {all.sort_by_key(|s|s["sort_order"].as_i64().unwrap_or(0));}
                    all.into_iter().map(|v|enrich(&c,resource,v)).collect::<ApiResult<Vec<_>>>().map(|v|json!(v))
                },
                "POST"=>{
                    validate(&c,resource,&value,true)?;
                    let item=match resource {"screenplays"=>screenplays::insert(state,&value)?,"roles"=>insert_role(state,&value)?,"episodes"=>insert_episode(state,&value)?,"scenes"=>insert_scene(state,&value)?,"prompts"=>insert_prompt(state,&value)?,"assets"=>{
                        let bytes=base64::engine::general_purpose::STANDARD.decode(strv(&value,"data_base64")?).map_err(|_|bad("Base64 数据无效"))?;
                        if bytes.len()>100*1024*1024{return Err(ApiError(StatusCode::PAYLOAD_TOO_LARGE,"资产不能超过 100 MB".into()))}
                        let ext=strv(&value,"extension")?;
                        let temp=state.root.join(format!(".upload-{}.{}",Uuid::new_v4(),safe_extension(&ext)?));
                        fs::write(&temp,bytes).map_err(|e|ApiError(StatusCode::INTERNAL_SERVER_ERROR,e.to_string()))?;
                        let result=import_uploaded(state,&pid,&temp,&strv(&value,"name")?,opti(&value,"role_id"));let _=fs::remove_file(&temp);result?
                    },_=>unreachable!()};
                    let id=item["id"].as_i64().unwrap();
                    // Apply optional create-time references using the same validation as PATCH.
                    let mut merged=get(&c,resource,id)?;
                    for (key,item) in value.as_object().unwrap(){merged[key]=item.clone();}
                    match resource {"roles"=>{update_role(state,&merged)?;},"episodes"=>{update_episode(state,&merged)?;},"scenes"=>{update_scene(state,&merged)?;},_=>{}}
                    get(&c,resource,id)
                },
                _=>Err(ApiError(StatusCode::METHOD_NOT_ALLOWED,"集合支持 GET/POST".into())),
            }
        }
    }
}
pub(crate) fn safe_extension(ext: &str)->ApiResult<String>{
    let ext=ext.trim_start_matches('.').to_ascii_lowercase();
    if !["png","jpg","jpeg","webp","gif","mp4","mov","webm","mkv","mp3","wav","m4a","aac","ogg","flac"].contains(&ext.as_str()){return Err(bad("不支持的资产格式"))}Ok(ext)
}
pub(crate) fn import_uploaded(state:&AppState,pid:&str,path:&Path,name:&str,role:Option<i64>)->ApiResult<Value>{
    if name.trim().is_empty(){return Err(bad("资产名称不能为空"))}
    let c=db(state,pid)?;
    if let Some(role)=role {get(&c,"roles",role)?;}
    let item=import_media(state,&json!({"project_id":pid,"source_path":path,"role_id":role}))?;
    c.execute("UPDATE media SET name=? WHERE id=?",params![name,item["id"].as_i64().unwrap()]).map_err(sql_error)?;
    get(&c,"assets",item["id"].as_i64().unwrap())
}

pub(crate) fn action(state:&AppState,path:&str,value:Value)->ApiResult<Value>{
    if let Some(action)=path.strip_prefix("/skills/") {
        return Ok(skills::command(state, action, &value)?);
    }
    if ["/agent/config", "/agent/config/save", "/agent/sessions", "/agent/create", "/agent/session", "/agent/run", "/agent/cancel", "/agent/delete"].contains(&path) {
        return Ok(agent::command(state, path, &value)?);
    }
    const ALLOWED:&[&str]=&["/canvas/load","/canvas/save","/editor/projects","/editor/save","/editor/probe","/editor/export","/app/settings/load","/app/settings/save","/project","/project/changes","/projects/open","/projects/migrate","/projects/backup","/projects/restore","/media/import","/media/export","/media/pose-reference","/media/thumbnail","/media/usage","/media/restore","/media/purge","/media/video-frame","/storage/scan","/storage/cleanup","/roles/media/add","/roles/media/delete","/scripts/load","/scripts/save","/scripts/publish","/tasks","/generations/image","/generations/video","/prompts/optimize","/storyboard/generate","/storyboard/plan","/storyboard/validate","/scenes/reorder","/scenes/duplicate","/scenes/select-video","/scenes/delete-video","/episodes/reorder","/episodes/merge","/settings"];
    if !ALLOWED.contains(&path){return Err(missing())}
    Ok(dispatch(state,"POST".into(),path.into(),Some(value))?)
}

#[cfg(test)]
mod project_config_tests {
    use super::*;
    #[test]
    fn configuration_survives_reload_and_rejects_invalid_documents() {
        let root=Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap().join("tmp-codex-diagnostics").join(format!("project-config-{}",Uuid::new_v4()));
        storage::initialize_root(&root).unwrap();
        let state=AppState{root:root.clone(),guard:std::sync::Arc::new(Mutex::new(()))};
        let created=crud(&state,"POST","projects",json!({"name":"Original"})).unwrap();
        let pid=created["id"].as_str().unwrap();let path=format!("projects/{pid}");
        let documents=json!([{"id":"world","title":"世界观","content":"# 雨夜\n故事背景"}]);
        crud(&state,"PATCH",&path,json!({"name":"新项目","outline":"起因、转折、结局","agents_md":"# 工作规范\n保持人物设定一致","documents":documents})).unwrap();
        let reopened=AppState{root:root.clone(),guard:std::sync::Arc::new(Mutex::new(()))};
        let saved=crud(&reopened,"GET",&path,json!({})).unwrap();
        assert_eq!(saved["agents_md"],"# 工作规范\n保持人物设定一致");
        assert_eq!(saved["name"],"新项目");assert_eq!(saved["outline"],"起因、转折、结局");assert_eq!(saved["documents"],documents);
        let backup=root.join("config.spielberg-backup");
        project_backup::command(&reopened,&json!({"project_id":pid,"path":backup}),false).unwrap();
        let restored=project_backup::command(&reopened,&json!({"path":backup}),true).unwrap();
        let restored_pid=restored["id"].as_str().unwrap();
        let restored_config=snapshot(&reopened,restored_pid).unwrap();
        assert_eq!(restored_config["project"]["outline"],"起因、转折、结局");
        assert_eq!(restored_config["project"]["documents"],documents);
        assert_eq!(restored_config["project"]["agents_md"],saved["agents_md"]);
        crud(&reopened,"PATCH",&path,json!({"name":"Rename only"})).unwrap();
        assert_eq!(snapshot(&reopened,pid).unwrap()["project"]["documents"],documents);
        assert!(crud(&reopened,"PATCH",&path,json!({"documents":[{"id":"bad","title":"","content":""}]})).is_err());
        assert!(crud(&reopened,"PATCH",&path,json!({"outline":123})).is_err());
        assert!(crud(&reopened,"PATCH",&path,json!({"agents_md":123})).is_err());
        assert_eq!(snapshot(&reopened,pid).unwrap()["project"]["agents_md"],saved["agents_md"]);
        crud(&reopened,"PATCH",&path,json!({"agents_md":""})).unwrap();
        assert_eq!(snapshot(&reopened,pid).unwrap()["project"]["agents_md"],"");
        assert_eq!(crud(&reopened,"GET",&path,json!({})).unwrap()["documents"],documents);
        crud(&reopened,"PATCH",&path,json!({"outline":"","documents":[]})).unwrap();
        assert_eq!(snapshot(&reopened,pid).unwrap()["project"]["documents"],json!([]));
        assert_eq!(snapshot(&reopened,restored_pid).unwrap()["project"]["documents"],documents);
        fs::remove_dir_all(root).unwrap();
    }
}
