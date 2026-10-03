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
    match resource { "roles"=>Ok("roles"),"assets"=>Ok("media"),"episodes"=>Ok("episodes"),"scenes"=>Ok("scenes"),"prompts"=>Ok("prompts"),_=>Err(missing()) }
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
        let mut q=c.prepare("SELECT m.id FROM media m WHERE m.deleted_at IS NULL AND (m.id=? OR EXISTS(SELECT 1 FROM role_media r WHERE r.role_id=? AND r.media_id=m.id)) ORDER BY CASE WHEN m.id=? THEN 0 ELSE 1 END,m.id DESC").map_err(sql_error)?;
        let ids=q.query_map(params![opti(&value,"design_media_id"),id,opti(&value,"design_media_id")],|r|r.get::<_,i64>(0)).map_err(sql_error)?.collect::<Result<Vec<_>,_>>().map_err(sql_error)?;
        value["images"]=json!(ids.into_iter().filter_map(|id|media(c,Some(id))).collect::<Vec<_>>());
    } else if resource=="scenes" {
        for key in ["first","last","reference","video"] {value[format!("{key}_media")]=json!(media(c,opti(&value,&format!("{key}_media_id"))));}
        value["videos"]=json!(scene_videos(c,id)?);
        value["generation_options"]=scene_options(c,id)?;
        value["script"]=scene_script(c,id)?;
    } else if resource=="episodes" {
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
        "roles"=>&["name","description","design_media_id"],
        "episodes"=>&["title","description","cover_media_id"],
        "scenes"=>&["title","description","episode_id","first_media_id","last_media_id","reference_media_id","generation_options"],
        "prompts"=>&["name","content","category"],
        "assets"=>&["name","extension","data_base64","role_id"],_=>return Err(missing()),
    };
    for (key,item) in value.as_object().ok_or_else(||bad("JSON 必须是对象"))? {
        if ["project_id","id"].contains(&key.as_str()) {continue}
        if resource=="assets" && !create && key!="name" {return Err(bad("资产更新仅支持 name"))}
        if !fields.contains(&key.as_str()) {return Err(bad(&format!("不支持的字段：{key}")))}
        if ["name","title","description","content","category","extension","data_base64"].contains(&key.as_str()) && !item.is_string(){return Err(bad(&format!("{key} 必须是字符串")))}
        if ["name","title"].contains(&key.as_str()) && item.as_str().unwrap_or("").trim().is_empty(){return Err(bad("名称不能为空"))}
        if key.ends_with("_media_id") && !item.is_null() {
            let mid=item.as_i64().filter(|n|*n>0).ok_or_else(||bad("资产 ID 无效"))?;
            let m=media(c,Some(mid)).ok_or_else(||bad("引用的资产不存在或已删除"))?;
            if m["kind"]!="image" {return Err(bad("该字段必须引用图片资产"))}
        }
        if ["role_id","episode_id"].contains(&key.as_str()) && !item.as_i64().is_some_and(|n|n>0) {return Err(bad(&format!("{key} 必须是正整数")))}
        if key=="generation_options" && !item.is_object(){return Err(bad("generation_options 必须是对象"))}
    }
    if create {
        let name=if resource=="scenes" || resource=="episodes" {"title"} else {"name"};
        if value[name].as_str().unwrap_or("").trim().is_empty(){return Err(bad(&format!("缺少 {name}")))}
    }
    if resource=="scenes" && (create || value.get("episode_id").is_some()) {
        let id=value["episode_id"].as_i64().ok_or_else(||bad("缺少有效的 episode_id"))?;
        get(c,"episodes",id)?;
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
        let id=id.unwrap();let current=project(state,id)?;
        match method {
            "GET"=>Ok(current),
            "PATCH"=>{
                let name=value["name"].as_str().filter(|s|!s.trim().is_empty()).ok_or_else(||bad("项目名称不能为空"))?;
                let mut all=registry(state)?;let p=all.iter_mut().find(|p|p["id"]==id).ok_or_else(missing)?;p["name"]=json!(name.trim());p["updated_at"]=json!("刚刚");let result=p.clone();save_registry(state,&all)?;Ok(result)
            },
            "DELETE"=>{catalog::no_running_jobs(&db(state,id)?)?;let mut all=registry(state)?;all.retain(|p|p["id"]!=id);save_registry(state,&all)?;Ok(json!({"deleted":true,"data_retained":true}))},
            _=>Err(ApiError(StatusCode::METHOD_NOT_ALLOWED,"不支持的方法".into())),
        }
    } else {
        let (pid,resource,id)=if parts.first()==Some(&"projects") && parts.len()==5 && parts[2]=="episodes" && parts[4]=="scenes" {
            let episode_id=parts[3].parse::<i64>().ok().filter(|n|*n>0).ok_or_else(||bad("剧集 ID 无效"))?;
            if value.get("episode_id").is_some_and(|v|v.as_i64()!=Some(episode_id)) {return Err(bad("episode_id 与路径不一致"))}
            value["episode_id"]=json!(episode_id);
            (parts[1].to_string(),"scenes",None)
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
                        "roles"=>{update_role(state,&merged)?;},"episodes"=>{update_episode(state,&merged)?;},"scenes"=>{update_scene(state,&merged)?;},"prompts"=>{update_prompt(state,&merged)?;},"assets"=>{manage_media(state,&merged,false)?;},_=>unreachable!(),
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
                    let mut all=rows(&c,table,None)?;
                    if resource=="scenes" {if let Some(ep)=value.get("episode_id") {all.retain(|s|s["episode_id"]==*ep);}}
                    if resource=="episodes" || resource=="scenes" {all.sort_by_key(|s|s["sort_order"].as_i64().unwrap_or(0));}
                    all.into_iter().map(|v|enrich(&c,resource,v)).collect::<ApiResult<Vec<_>>>().map(|v|json!(v))
                },
                "POST"=>{
                    validate(&c,resource,&value,true)?;
                    let item=match resource {"roles"=>insert_role(state,&value)?,"episodes"=>insert_episode(state,&value)?,"scenes"=>insert_scene(state,&value)?,"prompts"=>insert_prompt(state,&value)?,"assets"=>{
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
    if !["png","jpg","jpeg","webp","gif","mp4","mov","webm","mkv"].contains(&ext.as_str()){return Err(bad("不支持的资产格式"))}Ok(ext)
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
    const ALLOWED:&[&str]=&["/project","/project/changes","/projects/open","/projects/backup","/projects/restore","/media/import","/media/export","/media/pose-reference","/media/thumbnail","/media/usage","/media/restore","/media/purge","/media/video-frame","/storage/scan","/storage/cleanup","/roles/media/add","/roles/media/delete","/scripts/load","/scripts/save","/scripts/publish","/tasks","/generations/image","/generations/video","/prompts/optimize","/scenes/reorder","/scenes/select-video","/scenes/delete-video","/episodes/reorder","/episodes/merge","/settings"];
    if !ALLOWED.contains(&path){return Err(missing())}
    Ok(dispatch(state,"POST".into(),path.into(),Some(value))?)
}
