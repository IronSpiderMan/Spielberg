use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use std::{fs, path::{Path, PathBuf}, sync::Mutex};
use tauri::{Manager, State};
use uuid::Uuid;
use base64::Engine;

#[derive(Clone)]
struct AppState { root: PathBuf, guard: std::sync::Arc<Mutex<()>>, asset_scope: tauri::scope::fs::Scope }
fn now()->String { std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs().to_string() }
fn registry_path(s:&AppState)->PathBuf{s.root.join("projects.json")}
fn registry(s:&AppState)->Result<Vec<Value>,String>{let p=registry_path(s);if !p.exists(){return Ok(vec![])}serde_json::from_str(&fs::read_to_string(p).map_err(|e|e.to_string())?).map_err(|e|e.to_string())}
fn save_registry(s:&AppState,x:&[Value])->Result<(),String>{let temp=s.root.join("projects.json.tmp");fs::write(&temp,serde_json::to_string_pretty(x).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;fs::rename(temp,registry_path(s)).map_err(|e|e.to_string())}
fn project(s:&AppState,id:&str)->Result<Value,String>{registry(s)?.into_iter().find(|x|x["id"]==id).ok_or("项目不存在".into())}
fn migrate(c:&Connection)->Result<(),String>{c.execute_batch("PRAGMA foreign_keys=ON;
 CREATE TABLE IF NOT EXISTS media(id INTEGER PRIMARY KEY,name TEXT NOT NULL,path TEXT NOT NULL,kind TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS roles(id INTEGER PRIMARY KEY,name TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',design_media_id INTEGER REFERENCES media(id),created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS role_media(role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,PRIMARY KEY(role_id,media_id));
 CREATE TABLE IF NOT EXISTS episodes(id INTEGER PRIMARY KEY,title TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',sort_order INTEGER NOT NULL,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS scenes(id INTEGER PRIMARY KEY,episode_id INTEGER NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,title TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',sort_order INTEGER NOT NULL,first_media_id INTEGER REFERENCES media(id),last_media_id INTEGER REFERENCES media(id),reference_media_id INTEGER REFERENCES media(id),created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS prompts(id INTEGER PRIMARY KEY,name TEXT NOT NULL,content TEXT NOT NULL DEFAULT '',category TEXT NOT NULL DEFAULT '通用',created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS generations(id INTEGER PRIMARY KEY,operation TEXT NOT NULL,status TEXT NOT NULL,prompt TEXT NOT NULL,request_json TEXT NOT NULL,result_json TEXT,error TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);").map_err(|e|e.to_string())?;let _=c.execute("ALTER TABLE episodes ADD COLUMN cover_media_id INTEGER REFERENCES media(id)",[]);let _=c.execute("ALTER TABLE scenes ADD COLUMN video_media_id INTEGER REFERENCES media(id)",[]);c.execute_batch("CREATE TABLE IF NOT EXISTS scene_videos(scene_id INTEGER NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,media_id INTEGER NOT NULL REFERENCES media(id),PRIMARY KEY(scene_id,media_id));
CREATE TABLE IF NOT EXISTS background_jobs(id INTEGER PRIMARY KEY,operation TEXT NOT NULL,status TEXT NOT NULL,prompt TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,result_json TEXT,error TEXT);
CREATE TABLE IF NOT EXISTS scene_scripts(scene_id INTEGER PRIMARY KEY REFERENCES scenes(id) ON DELETE CASCADE,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS scene_options(scene_id INTEGER PRIMARY KEY REFERENCES scenes(id) ON DELETE CASCADE,value TEXT NOT NULL);
INSERT OR IGNORE INTO scene_videos SELECT id,video_media_id FROM scenes WHERE video_media_id IS NOT NULL;").map_err(|e|e.to_string())?;let _=c.execute("ALTER TABLE background_jobs ADD COLUMN resume_json TEXT",[]);let _=c.execute("ALTER TABLE background_jobs ADD COLUMN request_json TEXT",[]);Ok(())}
fn db(s:&AppState,id:&str)->Result<Connection,String>{let p=project(s,id)?["path"].as_str().ok_or("无效项目路径")?.to_string();let c=Connection::open(Path::new(&p).join("manju.sqlite")).map_err(|e|e.to_string())?;c.busy_timeout(std::time::Duration::from_secs(10)).map_err(|e|e.to_string())?;migrate(&c)?;Ok(c)}
fn strv(v:&Value,k:&str)->Result<String,String>{v.get(k).and_then(Value::as_str).map(str::to_string).ok_or(format!("缺少字段 {k}"))}
fn intv(v:&Value,k:&str)->Result<i64,String>{v.get(k).and_then(Value::as_i64).ok_or(format!("缺少字段 {k}"))}
fn opti(v:&Value,k:&str)->Option<i64>{v.get(k).and_then(Value::as_i64)}
fn touch(s:&AppState, id:&str) {
  if let Ok(mut items) = registry(s) {
    for item in &mut items {
      if item["id"] == id { item["updated_at"] = Value::String("刚刚".into()); }
    }
    let _ = save_registry(s, &items);
  }
}
fn media(c:&Connection,id:Option<i64>)->Option<Value>{id.and_then(|x|c.query_row("SELECT id,name,path,kind,created_at FROM media WHERE id=?",[x],|r|Ok(json!({"id":r.get::<_,i64>(0)?,"name":r.get::<_,String>(1)?,"path":r.get::<_,String>(2)?,"kind":r.get::<_,String>(3)?,"created_at":r.get::<_,String>(4)?}))).optional().ok().flatten())}
fn scene_videos(c:&Connection,id:i64)->Result<Vec<Value>,String>{let mut q=c.prepare("SELECT media_id FROM scene_videos WHERE scene_id=? ORDER BY media_id").map_err(|e|e.to_string())?;let ids=q.query_map([id],|r|r.get::<_,i64>(0)).map_err(|e|e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?;Ok(ids.into_iter().filter_map(|id|media(c,Some(id))).collect())}
fn scene_options(c:&Connection,id:i64)->Result<Value,String>{let raw=c.query_row("SELECT value FROM scene_options WHERE scene_id=?",[id],|r|r.get::<_,String>(0)).optional().map_err(|e|e.to_string())?;Ok(raw.and_then(|v|serde_json::from_str(&v).ok()).unwrap_or(json!({"first":true,"last":true,"reference":false,"duration":5,"aspect_ratio":"16:9"})))}
fn attach_video(c:&Connection,scene:i64,mid:i64)->Result<(),String>{c.execute("INSERT INTO scene_videos(scene_id,media_id) VALUES(?,?)",params![scene,mid]).map_err(|e|e.to_string())?;c.execute("UPDATE scenes SET video_media_id=COALESCE(video_media_id,?) WHERE id=?",params![mid,scene]).map_err(|e|e.to_string())?;Ok(())}
fn snapshot(s:&AppState,pid:&str)->Result<Value,String>{let p=project(s,pid)?;let c=db(s,pid)?;let media_items={let mut q=c.prepare("SELECT id,name,path,kind,created_at FROM media ORDER BY id DESC").map_err(|e|e.to_string())?;let rows=q.query_map([],|r|Ok(json!({"id":r.get::<_,i64>(0)?,"name":r.get::<_,String>(1)?,"path":r.get::<_,String>(2)?,"kind":r.get::<_,String>(3)?,"created_at":r.get::<_,String>(4)?}))).map_err(|e|e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?;rows};
 let mut roles=Vec::new();let mut qr=c.prepare("SELECT id,name,description,design_media_id FROM roles ORDER BY id DESC").map_err(|e|e.to_string())?;for x in qr.query_map([],|r|Ok((r.get::<_,i64>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,Option<i64>>(3)?))).map_err(|e|e.to_string())?{let(id,name,description,design)=x.map_err(|e|e.to_string())?;let mut qi=c.prepare("SELECT m.id,m.name,m.path,m.kind,m.created_at FROM role_media rm JOIN media m ON m.id=rm.media_id WHERE rm.role_id=?").map_err(|e|e.to_string())?;let images=qi.query_map([id],|r|Ok(json!({"id":r.get::<_,i64>(0)?,"name":r.get::<_,String>(1)?,"path":r.get::<_,String>(2)?,"kind":r.get::<_,String>(3)?,"created_at":r.get::<_,String>(4)?}))).map_err(|e|e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?;roles.push(json!({"id":id,"name":name,"description":description,"design_media_id":design,"images":images}));}
 let mut episodes=Vec::new();let mut qe=c.prepare("SELECT id,title,description FROM episodes ORDER BY sort_order,id").map_err(|e|e.to_string())?;for x in qe.query_map([],|r|Ok((r.get::<_,i64>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?))).map_err(|e|e.to_string())?{let(eid,title,description)=x.map_err(|e|e.to_string())?;let mut qs=c.prepare("SELECT id,title,description,sort_order,first_media_id,last_media_id,reference_media_id,video_media_id FROM scenes WHERE episode_id=? ORDER BY sort_order,id").map_err(|e|e.to_string())?;let mut scenes=Vec::new();for z in qs.query_map([eid],|r|Ok((r.get::<_,i64>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,i64>(3)?,r.get::<_,Option<i64>>(4)?,r.get::<_,Option<i64>>(5)?,r.get::<_,Option<i64>>(6)?,r.get::<_,Option<i64>>(7)?))).map_err(|e|e.to_string())?{let(id,t,d,o,f,l,rf,vid)=z.map_err(|e|e.to_string())?;scenes.push(json!({"id":id,"title":t,"description":d,"sort_order":o,"first_media_id":f,"last_media_id":l,"reference_media_id":rf,"video_media_id":vid,"first_media":media(&c,f),"last_media":media(&c,l),"reference_media":media(&c,rf),"video_media":media(&c,vid),"videos":scene_videos(&c,id)?,"generation_options":scene_options(&c,id)?,"script":scene_script(&c,id)?}));}episodes.push(json!({"id":eid,"title":title,"description":description,"scenes":scenes,"cover_media":media(&c,c.query_row("SELECT cover_media_id FROM episodes WHERE id=?",[eid],|r|r.get::<_,Option<i64>>(0)).map_err(|e|e.to_string())?)}));}
 let mut qp=c.prepare("SELECT id,name,content,category FROM prompts ORDER BY id DESC").map_err(|e|e.to_string())?;let prompts=qp.query_map([],|r|Ok(json!({"id":r.get::<_,i64>(0)?,"name":r.get::<_,String>(1)?,"content":r.get::<_,String>(2)?,"category":r.get::<_,String>(3)?}))).map_err(|e|e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?;let def=json!({"t2i":{"url":"","api_key":"","description":""},"i2i":{"url":"","api_key":"","description":""},"t2v":{"url":"","api_key":"","description":""},"i2v":{"url":"","api_key":"","description":""},"flf2v":{"url":"","api_key":"","description":""}});let settings=c.query_row("SELECT value FROM settings WHERE key='models'",[],|r|r.get::<_,String>(0)).optional().map_err(|e|e.to_string())?.and_then(|x|serde_json::from_str(&x).ok()).unwrap_or(def);Ok(json!({"project":p,"roles":roles,"prompts":prompts,"episodes":episodes,"media":media_items,"settings":settings}))}
fn create_project(s:&AppState,v:&Value)->Result<Value,String>{let name=strv(v,"name")?;let id=Uuid::new_v4().to_string();let path=s.root.join("projects").join(&id);fs::create_dir_all(path.join("assets")).map_err(|e|e.to_string())?;s.asset_scope.allow_directory(path.join("assets"),true).map_err(|e|e.to_string())?;migrate(&Connection::open(path.join("manju.sqlite")).map_err(|e|e.to_string())?)?;let p=json!({"id":id,"name":name,"path":path,"updated_at":"刚刚"});let mut all=registry(s)?;all.push(p.clone());save_registry(s,&all)?;Ok(p)}
#[tauri::command]
fn create_project_command(state:State<'_,AppState>, name:String)->Result<Value,String>{let _lock=state.guard.lock().map_err(|_|"本地数据锁不可用")?;create_project(&state,&json!({"name":name}))}
fn open_project(s:&AppState,v:&Value)->Result<Value,String>{let path=PathBuf::from(strv(v,"path")?);if !path.is_dir(){return Err("请选择有效的项目文件夹".into())}fs::create_dir_all(path.join("assets")).map_err(|e|e.to_string())?;s.asset_scope.allow_directory(path.join("assets"),true).map_err(|e|format!("无法授权项目图片预览：{e}"))?;migrate(&Connection::open(path.join("manju.sqlite")).map_err(|e|e.to_string())?)?;let mut all=registry(s)?;if let Some(p)=all.iter().find(|x|x["path"]==path.to_string_lossy().to_string()){return Ok(p.clone())}let p=json!({"id":Uuid::new_v4().to_string(),"name":path.file_name().unwrap_or_default().to_string_lossy(),"path":path,"updated_at":"刚刚"});all.push(p.clone());save_registry(s,&all)?;Ok(p)}
fn extract_video_frame(source: &Path, destination: &Path, last: bool) -> Result<(), String> {
    let binary = if Path::new("/opt/homebrew/bin/ffmpeg").exists() { "/opt/homebrew/bin/ffmpeg" } else { "ffmpeg" };
    let mut filter = "select=eq(n\\,0)".to_string();
    if last {
        let probe = if Path::new("/opt/homebrew/bin/ffprobe").exists() { "/opt/homebrew/bin/ffprobe" } else { "ffprobe" };
        let output = std::process::Command::new(probe).args(["-v", "error", "-select_streams", "v:0", "-count_frames", "-show_entries", "stream=nb_read_frames", "-of", "json"]).arg(source).output().map_err(|e|format!("读取尾帧需要 FFprobe：{e}"))?;
        if !output.status.success() { return Err("无法读取视频帧数".into()); }
        let info: Value = serde_json::from_slice(&output.stdout).map_err(|e|e.to_string())?;
        let count = info["streams"][0]["nb_read_frames"].as_str().and_then(|n|n.parse::<u64>().ok()).filter(|n|*n > 0).ok_or("视频没有可用画面")?;
        filter = format!("select=eq(n\\,{})", count - 1);
    }
    let output = std::process::Command::new(binary).args(["-nostdin", "-v", "error", "-y", "-i"]).arg(source).args(["-map", "0:v:0", "-vf", &filter, "-frames:v", "1", "-vsync", "0"]).arg(destination).output().map_err(|e|format!("提取画面需要 FFmpeg：{e}"))?;
    if !output.status.success() || !destination.is_file() { let _ = fs::remove_file(destination); return Err(format!("视频帧提取失败：{}", String::from_utf8_lossy(&output.stderr))); }
    Ok(())
}
fn video_frame(s: &AppState, v: &Value) -> Result<Value, String> {
    let pid = project_id(v)?;
    let c = db(s, &pid)?;
    let mid = intv(v, "media_id")?;
    let sid = intv(v, "scene_id")?;
    let frame = strv(v, "frame")?;
    if frame != "first" && frame != "last" { return Err("请选择首帧或尾帧".into()); }
    let belongs: bool = c.query_row("SELECT EXISTS(SELECT 1 FROM scene_videos WHERE scene_id=? AND media_id=?)", params![sid, mid], |r|r.get(0)).map_err(|e|e.to_string())?;
    if !belongs { return Err("该视频不属于所选场景".into()); }
    let video = media(&c, Some(mid)).ok_or("视频不存在")?;
    if video["kind"] != "video" { return Err("请选择视频素材".into()); }
    let name = format!("视频{}-{}.png", mid, if frame == "last" { "尾帧" } else { "首帧" });
    let dir = PathBuf::from(strv(&project(s, &pid)?, "path")?).join("assets/images");
    fs::create_dir_all(&dir).map_err(|e|e.to_string())?;
    let out = dir.join(format!("{}.png", Uuid::new_v4()));
    extract_video_frame(Path::new(&strv(&video, "path")?), &out, frame == "last")?;
    if let Err(e) = c.execute("INSERT INTO media(name,path,kind,created_at) VALUES(?,?,?,?)", params![name,out.to_string_lossy(),"image",now()]) { let _ = fs::remove_file(&out); return Err(e.to_string()); }
    { let _lock = s.guard.lock().map_err(|_|"本地数据锁不可用")?; touch(s, &pid); }
    media(&c, Some(c.last_insert_rowid())).ok_or("保存图片失败".into())
}

fn project_id(v:&Value)->Result<String,String>{strv(v,"project_id")}
fn insert_role(s:&AppState,v:&Value)->Result<Value,String>{let pid=project_id(v)?;let c=db(s,&pid)?;let name=strv(v,"name")?;let d=v.get("description").and_then(Value::as_str).unwrap_or("");c.execute("INSERT INTO roles(name,description,created_at) VALUES(?,?,?)",params![name,d,now()]).map_err(|e|e.to_string())?;touch(s,&pid);Ok(json!({"id":c.last_insert_rowid(),"name":name,"description":d,"design_media_id":null,"images":[]}))}
fn update_role(s:&AppState,v:&Value)->Result<Value,String>{let pid=project_id(v)?;db(s,&pid)?.execute("UPDATE roles SET name=?,description=?,design_media_id=? WHERE id=?",params![strv(v,"name")?,v.get("description").and_then(Value::as_str).unwrap_or(""),opti(v,"design_media_id"),intv(v,"id")?]).map_err(|e|e.to_string())?;touch(s,&pid);Ok(json!({"ok":true}))}
fn delete_role(s:&AppState,v:&Value)->Result<Value,String>{let pid=project_id(v)?;db(s,&pid)?.execute("DELETE FROM roles WHERE id=?",[intv(v,"id")?]).map_err(|e|e.to_string())?;touch(s,&pid);Ok(json!({"ok":true}))}
fn delete_role_media(s:&AppState,v:&Value)->Result<Value,String>{let pid=project_id(v)?;let role_id=intv(v,"role_id")?;let media_id=intv(v,"media_id")?;let mut c=db(s,&pid)?;let tx=c.transaction().map_err(|e|e.to_string())?;tx.execute("DELETE FROM role_media WHERE role_id=? AND media_id=?",params![role_id,media_id]).map_err(|e|e.to_string())?;tx.execute("UPDATE roles SET design_media_id=NULL WHERE id=? AND design_media_id=?",params![role_id,media_id]).map_err(|e|e.to_string())?;tx.commit().map_err(|e|e.to_string())?;touch(s,&pid);Ok(json!({"ok":true}))}
fn insert_episode(s:&AppState,v:&Value)->Result<Value,String>{let pid=project_id(v)?;let c=db(s,&pid)?;let n:i64=c.query_row("SELECT COUNT(*) FROM episodes",[],|r|r.get(0)).map_err(|e|e.to_string())?;let title=strv(v,"title")?;let d=v.get("description").and_then(Value::as_str).unwrap_or("");c.execute("INSERT INTO episodes(title,description,sort_order,created_at) VALUES(?,?,?,?)",params![title,d,n,now()]).map_err(|e|e.to_string())?;touch(s,&pid);Ok(json!({"id":c.last_insert_rowid(),"title":title,"description":d}))}
fn update_episode(s:&AppState,v:&Value)->Result<Value,String>{let pid=project_id(v)?;db(s,&pid)?.execute("UPDATE episodes SET title=?,description=?,cover_media_id=? WHERE id=?",params![strv(v,"title")?,v.get("description").and_then(Value::as_str).unwrap_or(""),opti(v,"cover_media_id"),intv(v,"id")?]).map_err(|e|e.to_string())?;touch(s,&pid);Ok(json!({"ok":true}))}
fn delete_episode(s:&AppState,v:&Value)->Result<Value,String>{let pid=project_id(v)?;db(s,&pid)?.execute("DELETE FROM episodes WHERE id=?",[intv(v,"id")?]).map_err(|e|e.to_string())?;touch(s,&pid);Ok(json!({"ok":true}))}
fn insert_scene(s:&AppState,v:&Value)->Result<Value,String>{let pid=project_id(v)?;let c=db(s,&pid)?;let ep=intv(v,"episode_id")?;let n:i64=c.query_row("SELECT COUNT(*) FROM scenes WHERE episode_id=?",[ep],|r|r.get(0)).map_err(|e|e.to_string())?;let title=strv(v,"title")?;let d=v.get("description").and_then(Value::as_str).unwrap_or("");c.execute("INSERT INTO scenes(episode_id,title,description,sort_order,created_at) VALUES(?,?,?,?,?)",params![ep,title,d,n,now()]).map_err(|e|e.to_string())?;touch(s,&pid);Ok(json!({"id":c.last_insert_rowid(),"title":title,"description":d,"sort_order":n,"first_media_id":null,"last_media_id":null,"reference_media_id":null}))}
fn update_scene(s:&AppState,v:&Value)->Result<Value,String>{let pid=project_id(v)?;let mut c=db(s,&pid)?;let tx=c.transaction().map_err(|e|e.to_string())?;let id=intv(v,"id")?;if tx.execute("UPDATE scenes SET title=?,description=?,first_media_id=?,last_media_id=?,reference_media_id=? WHERE id=?",params![strv(v,"title")?,strv(v,"description")?,opti(v,"first_media_id"),opti(v,"last_media_id"),opti(v,"reference_media_id"),id]).map_err(|e|e.to_string())?!=1{return Err("场景不存在".into())}if let Some(options)=v.get("generation_options"){tx.execute("INSERT INTO scene_options VALUES(?,?) ON CONFLICT(scene_id) DO UPDATE SET value=excluded.value",params![id,options.to_string()]).map_err(|e|e.to_string())?;}tx.commit().map_err(|e|e.to_string())?;touch(s,&pid);Ok(json!({"ok":true}))}
fn reorder_scenes(s:&AppState,v:&Value)->Result<Value,String>{let pid=project_id(v)?;let mut c=db(s,&pid)?;let tx=c.transaction().map_err(|e|e.to_string())?;let ep=intv(v,"episode_id")?;let ids=v["scene_ids"].as_array().ok_or("缺少场景顺序")?;let count:i64=tx.query_row("SELECT COUNT(*) FROM scenes WHERE episode_id=?",[ep],|r|r.get(0)).map_err(|e|e.to_string())?;let mut seen=std::collections::HashSet::new();if ids.len()!=count as usize{return Err("请提交完整场景顺序".into())}for (i,id) in ids.iter().enumerate(){let id=id.as_i64().ok_or("场景 ID 无效")?;if !seen.insert(id)||tx.execute("UPDATE scenes SET sort_order=? WHERE id=? AND episode_id=?",params![i as i64,id,ep]).map_err(|e|e.to_string())?!=1{return Err("场景顺序无效".into())}}tx.commit().map_err(|e|e.to_string())?;Ok(json!({"ok":true}))}
fn select_video(s:&AppState,v:&Value)->Result<Value,String>{
 let mut c=db(s,&project_id(v)?)?; let tx=c.transaction().map_err(|e|e.to_string())?;
 let id=intv(v,"scene_id")?;let mid=intv(v,"media_id")?;
 select_asset_video(&tx,id,mid)?;
 tx.commit().map_err(|e|e.to_string())?;Ok(json!({"ok":true}))
}
fn select_asset_video(tx:&Connection,id:i64,mid:i64)->Result<(),String>{
 if media(&tx,Some(mid)).map(|m|m["kind"]!="video").unwrap_or(true){return Err("请选择有效的视频资产".into())}
 tx.execute("INSERT OR IGNORE INTO scene_videos(scene_id,media_id) VALUES(?,?)",params![id,mid]).map_err(|e|e.to_string())?;
 if tx.execute("UPDATE scenes SET video_media_id=? WHERE id=?",params![mid,id]).map_err(|e|e.to_string())?!=1{return Err("场景不存在".into())}
 Ok(())
}
fn merge_video_files(paths:&[String],out:&Path)->Result<(),String>{
 if paths.is_empty(){return Err("没有可合并的视频".into())}
 let binary=if Path::new("/opt/homebrew/bin/ffmpeg").exists(){"/opt/homebrew/bin/ffmpeg"}else{"ffmpeg"};
 let probe=if Path::new("/opt/homebrew/bin/ffprobe").exists(){"/opt/homebrew/bin/ffprobe"}else{"ffprobe"};
 let mut cmd=std::process::Command::new(binary);cmd.args(["-nostdin","-v","error"]);
 let mut metadata=Vec::new();
 for path in paths{let output=std::process::Command::new(probe).args(["-v","error","-show_streams","-show_format","-of","json",path]).output().map_err(|e|format!("读取视频需要 FFprobe：{e}"))?;if !output.status.success(){return Err(format!("无法读取视频：{path}"))}let info:Value=serde_json::from_slice(&output.stdout).map_err(|e|e.to_string())?;let duration=info["format"]["duration"].as_str().and_then(|v|v.parse::<f64>().ok()).filter(|v|v.is_finite()&&*v>0.0).ok_or("无法读取视频时长")?;let audio=info["streams"].as_array().map(|xs|xs.iter().any(|x|x["codec_type"]=="audio")).unwrap_or(false);metadata.push((duration,audio));cmd.arg("-i").arg(path);}
 let mut filters=Vec::new();for (i,(duration,audio)) in metadata.iter().enumerate(){filters.push(format!("[{i}:v]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24,setpts=PTS-STARTPTS[v{i}]"));filters.push(if *audio{format!("[{i}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,apad,atrim=duration={duration},asetpts=PTS-STARTPTS[a{i}]")}else{format!("anullsrc=r=48000:cl=stereo,atrim=duration={duration},asetpts=PTS-STARTPTS[a{i}]")});}
 filters.push(format!("{}concat=n={}:v=1:a=1[outv][outa]",(0..paths.len()).map(|i|format!("[v{i}][a{i}]")).collect::<String>(),paths.len()));
 let result=cmd.args(["-filter_complex",&filters.join(";"),"-map","[outv]","-map","[outa]","-c:v","libx264","-preset","fast","-c:a","aac","-pix_fmt","yuv420p","-movflags","+faststart"]).arg(out).output().map_err(|e|format!("合并需要 FFmpeg：{e}"))?;
 if !result.status.success(){let _=fs::remove_file(out);return Err(format!("视频合并失败：{}",String::from_utf8_lossy(&result.stderr)))}Ok(())
}
fn merge_episode(s:&AppState,v:&Value)->Result<Value,String>{let pid=project_id(v)?;let c=db(s,&pid)?;let ep=intv(v,"episode_id")?;let mut q=c.prepare("SELECT m.path FROM scenes sc LEFT JOIN scene_videos sv ON sv.scene_id=sc.id AND sv.media_id=sc.video_media_id LEFT JOIN media m ON m.id=sv.media_id WHERE sc.episode_id=? ORDER BY sc.sort_order,sc.id").map_err(|e|e.to_string())?;let paths=q.query_map([ep],|r|r.get::<_,Option<String>>(0)).map_err(|e|e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?;if paths.is_empty()||paths.iter().any(Option::is_none){return Err("请为每个场景选择一个视频后合并".into())}let root=PathBuf::from(strv(&project(s,&pid)?,"path")?);let dir=root.join("assets/videos");fs::create_dir_all(&dir).map_err(|e|e.to_string())?;let out=dir.join(format!("episode-{}-{}.mp4",ep,Uuid::new_v4()));merge_video_files(&paths.into_iter().flatten().collect::<Vec<_>>(),&out)?;let name=format!("剧集{}-合并.mp4",ep);c.execute("INSERT INTO media(name,path,kind,created_at) VALUES(?,?,?,?)",params![name,out.to_string_lossy(),"video",now()]).map_err(|e|e.to_string())?;Ok(media(&c,Some(c.last_insert_rowid())).unwrap())}
fn insert_prompt(s:&AppState,v:&Value)->Result<Value,String>{let pid=project_id(v)?;let c=db(s,&pid)?;let name=strv(v,"name")?;let content=v.get("content").and_then(Value::as_str).unwrap_or("");let cat=v.get("category").and_then(Value::as_str).unwrap_or("通用");let t=now();c.execute("INSERT INTO prompts(name,content,category,created_at,updated_at) VALUES(?,?,?,?,?)",params![name,content,cat,t,t]).map_err(|e|e.to_string())?;touch(s,&pid);Ok(json!({"id":c.last_insert_rowid(),"name":name,"content":content,"category":cat}))}
fn update_prompt(s:&AppState,v:&Value)->Result<Value,String>{let pid=project_id(v)?;db(s,&pid)?.execute("UPDATE prompts SET name=?,content=?,category=?,updated_at=? WHERE id=?",params![strv(v,"name")?,v.get("content").and_then(Value::as_str).unwrap_or(""),v.get("category").and_then(Value::as_str).unwrap_or("通用"),now(),intv(v,"id")?]).map_err(|e|e.to_string())?;touch(s,&pid);Ok(json!({"ok":true}))}
fn save_settings(s:&AppState,v:&Value)->Result<Value,String>{let pid=project_id(v)?;db(s,&pid)?.execute("INSERT INTO settings(key,value) VALUES('models',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[v.get("settings").unwrap_or(&json!({})).to_string()]).map_err(|e|e.to_string())?;touch(s,&pid);Ok(json!({"ok":true}))}
fn import_media(s:&AppState,v:&Value)->Result<Value,String>{let pid=project_id(v)?;let source=PathBuf::from(strv(v,"source_path")?);if !source.is_file(){return Err("导入文件不存在".into())}let ext=source.extension().and_then(|x|x.to_str()).unwrap_or("png");let ext=ext.to_ascii_lowercase();let kind=match ext.as_str(){"mp4"|"mov"|"webm"|"mkv"=>"video","png"|"jpg"|"jpeg"|"webp"|"gif"=>"image",_=>return Err("不支持的资产格式".into())};if kind=="video"&&opti(v,"role_id").is_some(){return Err("角色素材必须是图片".into())}let root=PathBuf::from(project(s,&pid)?["path"].as_str().ok_or("无效项目路径")?);let dir=root.join("assets").join(if kind=="video"{"videos"}else{"images"});fs::create_dir_all(&dir).map_err(|e|e.to_string())?;let out=dir.join(format!("{}.{}",Uuid::new_v4(),ext));fs::copy(&source,&out).map_err(|e|e.to_string())?;let c=db(s,&pid)?;let name=source.file_name().unwrap_or_default().to_string_lossy().to_string();c.execute("INSERT INTO media(name,path,kind,created_at) VALUES(?,?,?,?)",params![name,out.to_string_lossy(),kind,now()]).map_err(|e|e.to_string())?;let id=c.last_insert_rowid();if let Some(role)=opti(v,"role_id"){c.execute("INSERT OR IGNORE INTO role_media(role_id,media_id) VALUES(?,?)",params![role,id]).map_err(|e|e.to_string())?;}touch(s,&pid);Ok(json!({"id":id,"name":name,"path":out,"kind":kind,"created_at":now()}))}
fn export_media(s:&AppState,v:&Value)->Result<Value,String>{let pid=project_id(v)?;let media_id=opti(v,"media_id").ok_or("缺少媒体 ID")?;let destination=PathBuf::from(strv(v,"destination_path")?);let c=db(s,&pid)?;let source:String=c.query_row("SELECT path FROM media WHERE id=?",params![media_id],|r|r.get(0)).map_err(|_|"媒体不存在".to_string())?;if !Path::new(&source).is_file(){return Err("媒体文件不存在".into())}fs::copy(source,&destination).map_err(|e|format!("保存媒体失败：{e}"))?;Ok(json!({"path":destination}))}
#[allow(dead_code)]
fn legacy_generate_image(s:&AppState,v:&Value)->Result<Value,String>{
 let pid=project_id(v)?;let prompt=strv(v,"prompt")?;if prompt.trim().is_empty(){return Err("请输入画面描述".into())}let c=db(s,&pid)?;let raw:String=c.query_row("SELECT value FROM settings WHERE key='models'",[],|r|r.get(0)).optional().map_err(|e|e.to_string())?.ok_or("请先配置图片生成服务")?;let settings:Value=serde_json::from_str(&raw).map_err(|e|e.to_string())?;let model=&settings["t2i"];let url=model["url"].as_str().unwrap_or("");if url.is_empty(){return Err("请先配置 t2i 服务地址".into())}let body=json!({"prompt":prompt,"aspect_ratio":v.get("aspect_ratio").and_then(Value::as_str).unwrap_or("16:9")});let client=reqwest::blocking::Client::builder().timeout(std::time::Duration::from_secs(600)).build().map_err(|e|e.to_string())?;let mut req=client.post(url).json(&body);if let Some(key)=model["api_key"].as_str().filter(|x|!x.is_empty()){req=req.bearer_auth(key)}let response=req.send().map_err(|e|format!("图片生成请求失败：{e}"))?;let status=response.status();let content_type=response.headers().get(reqwest::header::CONTENT_TYPE).and_then(|x|x.to_str().ok()).unwrap_or("").to_string();let bytes=response.bytes().map_err(|e|e.to_string())?;if !status.is_success(){return Err(format!("生成服务返回 {}：{}",status,String::from_utf8_lossy(&bytes)))}let (image,ext)=if bytes.starts_with(b"{"){let result:Value=serde_json::from_slice(&bytes).map_err(|e|format!("无法解析生成结果：{e}"))?;if let Some(encoded)=result.pointer("/data/0/b64_json").or_else(||result.pointer("/data/0/base64")).or_else(||result.get("b64_json")).or_else(||result.get("base64")).and_then(Value::as_str){(base64::engine::general_purpose::STANDARD.decode(encoded).map_err(|e|format!("图片数据解码失败：{e}"))?,"png".to_string())}else if let Some(remote)=result.pointer("/data/0/url").or_else(||result.get("url")).and_then(Value::as_str){let ext=Path::new(remote).extension().and_then(|x|x.to_str()).unwrap_or("png").to_string();let downloaded=client.get(remote).send().and_then(|r|r.error_for_status()).and_then(|r|r.bytes()).map_err(|e|format!("下载生成图片失败：{e}"))?;(downloaded.to_vec(),ext)}else{return Err("生成服务未返回图片 URL 或 base64 数据".into())}}else{(bytes.to_vec(),if content_type.contains("jpeg"){"jpg".into()}else if content_type.contains("webp"){"webp".into()}else{"png".into()})};let root=PathBuf::from(project(s,&pid)?["path"].as_str().ok_or("无效项目路径")?);let dir=root.join("assets").join("images");fs::create_dir_all(&dir).map_err(|e|e.to_string())?;let out=dir.join(format!("{}.{}",Uuid::new_v4(),ext));fs::write(&out,image).map_err(|e|e.to_string())?;let name=format!("t2i-{}.{}",now(),ext);c.execute("INSERT INTO media(name,path,kind,created_at) VALUES(?,?,?,?)",params![name,out.to_string_lossy(),"image",now()]).map_err(|e|e.to_string())?;let id=c.last_insert_rowid();touch(s,&pid);Ok(json!({"id":id,"name":name,"path":out,"kind":"image","created_at":now()}))
}
fn generate_image(s:&AppState,v:&Value)->Result<Value,String>{
 let pid=project_id(v)?;
 let operation=strv(v,"operation")?;
 if !["t2i","i2i"].contains(&operation.as_str()){return Err("不支持的图片生成方式".into())}
 let prompt=strv(v,"prompt")?;
 if prompt.trim().is_empty(){return Err("请输入画面描述".into())}
 let c=db(s,&pid)?;
 let reference_ids:Vec<i64>=v.get("image_media_ids").and_then(Value::as_array).map(|items|items.iter().filter_map(Value::as_i64).collect()).unwrap_or_default();
 if operation=="i2i"&&reference_ids.is_empty(){return Err("图生图请至少选择一张参考图".into())}
 let raw:String=c.query_row("SELECT value FROM settings WHERE key='models'",[],|r|r.get(0)).optional().map_err(|e|e.to_string())?.ok_or("请先配置图片生成服务")?;
 let settings:Value=serde_json::from_str(&raw).map_err(|e|e.to_string())?;
 let model=&settings[&operation];let url=model["url"].as_str().unwrap_or("");
 let provider=model["provider"].as_str().unwrap_or("cast");
 if provider!="openai"&&url.is_empty(){return Err(format!("请先配置 {} 服务地址",operation))}
 let images:Vec<String>=reference_ids.into_iter().filter_map(|id|media(&c,Some(id))).filter_map(|m|m["path"].as_str().map(str::to_string)).collect();
 let client=reqwest::blocking::Client::builder().timeout(std::time::Duration::from_secs(600)).build().map_err(|e|e.to_string())?;
 let api_key=model["api_key"].as_str().unwrap_or("");
 let request=if provider=="openai"{
  let base_url=model["base_url"].as_str().filter(|x|!x.trim().is_empty()).unwrap_or(url).trim_end_matches('/');
  if base_url.is_empty(){return Err(format!("请先配置 {} 的 OpenAI Base URL",operation))}
  let endpoint=if base_url.ends_with("/images/generations")||base_url.ends_with("/images/edits"){base_url.to_string()}else{format!("{}/images/{}",base_url,if operation=="i2i"{"edits"}else{"generations"})};
  let model_name=model["model"].as_str().filter(|x|!x.trim().is_empty()).unwrap_or("gpt-image-1");
  let size=match v.get("aspect_ratio").and_then(Value::as_str).unwrap_or("16:9"){"9:16"=>"1024x1536","1:1"=>"1024x1024",_=>"1536x1024"};
  let mut req=if operation=="i2i"{
   let mut form=reqwest::blocking::multipart::Form::new().text("model",model_name.to_string()).text("prompt",prompt.clone()).text("size",size.to_string());
   for image in &images{let part=reqwest::blocking::multipart::Part::file(image).map_err(|e|format!("无法读取参考图 {}：{e}",image))?;form=form.part("image[]",part);}
   client.post(endpoint).multipart(form)
  }else{
   client.post(endpoint).json(&json!({"model":model_name,"prompt":prompt,"size":size}))
  };
  if !api_key.is_empty(){req=req.bearer_auth(api_key)}
  req
 }else{
  let mut body=json!({"prompt":prompt,"aspect_ratio":v.get("aspect_ratio").and_then(Value::as_str).unwrap_or("16:9")});
  if operation=="i2i"{body["images"]=json!(images);if let Some(first)=body["images"].as_array().and_then(|x|x.first()).cloned(){body["image"]=first;}}
  let mut req=client.post(url).json(&body);if !api_key.is_empty(){req=req.bearer_auth(api_key)}req
 };
 let req=request;
 let response=req.send().map_err(|e|format!("图片生成请求失败：{e}"))?;let status=response.status();let content_type=response.headers().get(reqwest::header::CONTENT_TYPE).and_then(|x|x.to_str().ok()).unwrap_or("").to_string();let bytes=response.bytes().map_err(|e|e.to_string())?;
 if !status.is_success(){return Err(format!("生成服务返回 {}：{}",status,String::from_utf8_lossy(&bytes)))}
 let (image,ext)=if bytes.starts_with(b"{"){let result:Value=serde_json::from_slice(&bytes).map_err(|e|format!("无法解析生成结果：{e}"))?;if let Some(encoded)=result.pointer("/data/0/b64_json").or_else(||result.pointer("/data/0/base64")).or_else(||result.get("b64_json")).or_else(||result.get("base64")).and_then(Value::as_str){(base64::engine::general_purpose::STANDARD.decode(encoded).map_err(|e|format!("图片数据解码失败：{e}"))?,"png".to_string())}else if let Some(remote)=result.pointer("/data/0/url").or_else(||result.get("url")).and_then(Value::as_str){let ext=Path::new(remote).extension().and_then(|x|x.to_str()).unwrap_or("png").to_string();let downloaded=client.get(remote).send().and_then(|r|r.error_for_status()).and_then(|r|r.bytes()).map_err(|e|format!("下载生成图片失败：{e}"))?;(downloaded.to_vec(),ext)}else{return Err("生成服务未返回图片 URL 或 base64 数据".into())}}else{(bytes.to_vec(),if content_type.contains("jpeg"){"jpg".into()}else if content_type.contains("webp"){"webp".into()}else{"png".into()})};
 let root=PathBuf::from(project(s,&pid)?["path"].as_str().ok_or("无效项目路径")?);let dir=root.join("assets").join("images");fs::create_dir_all(&dir).map_err(|e|e.to_string())?;let out=dir.join(format!("{}.{}",Uuid::new_v4(),ext));fs::write(&out,image).map_err(|e|e.to_string())?;let name=format!("{}-{}.{}",operation,now(),ext);c.execute("INSERT INTO media(name,path,kind,created_at) VALUES(?,?,?,?)",params![name,out.to_string_lossy(),"image",now()]).map_err(|e|e.to_string())?;let id=c.last_insert_rowid();{let _guard=s.guard.lock().map_err(|_|"本地数据锁不可用")?;touch(s,&pid);}Ok(json!({"id":id,"name":name,"path":out,"kind":"image","created_at":now()}))
}
fn h3_dimensions(ratio:&str)->(i64,i64){match ratio{"9:16"=>(480,832),"1:1"=>(640,640),_=>(832,480)}}
fn h3_frames(seconds:i64)->i64{let requested=seconds.max(1)*24;((requested-5+16)/17)*17+5}
fn media_base64(c:&Connection,id:Option<i64>,label:&str)->Result<String,String>{let id=id.ok_or_else(||format!("{}不能为空",label))?;let item=media(c,Some(id)).ok_or_else(||format!("找不到{}",label))?;let path=item["path"].as_str().ok_or_else(||format!("{}路径无效",label))?;let data=fs::read(path).map_err(|e|format!("无法读取{}：{e}",label))?;Ok(base64::engine::general_purpose::STANDARD.encode(data))}
fn remote_comfy_url(configured_url:&str,result_url:&str)->String{let host=configured_url.split("://").nth(1).unwrap_or("").split('/').next().unwrap_or("").split(':').next().unwrap_or("");if host.is_empty(){result_url.into()}else{result_url.replace("127.0.0.1",host).replace("localhost",host)}}
fn generate_comfy_video(s:&AppState,c:&Connection,pid:&str,v:&Value,operation:&str,prompt:&str,url:&str,api_key:&str)->Result<Value,String>{
 let body=if v.get("_resume").is_some(){Value::Null}else {
 let (width,height)=h3_dimensions(v.get("aspect_ratio").and_then(Value::as_str).unwrap_or("16:9"));let mut body=json!({"prompt":prompt,"width":width,"height":height,"frames":h3_frames(v.get("duration").and_then(Value::as_i64).unwrap_or(5))});
 if operation=="i2v"{body["image"]=Value::String(media_base64(c,opti(v,"image_media_id").or_else(||opti(v,"first_media_id")).or_else(||opti(v,"last_media_id")),"输入图片")?)}
 for (key,field) in [("first_media_id","start_image"),("last_media_id","end_image"),("image_media_id","reference_image")]{if let Some(id)=opti(v,key){body[field]=Value::String(media_base64(c,Some(id),"输入图片")?);}}
 if operation=="flf2v"||operation=="fl2v"{body["start_image"]=Value::String(media_base64(c,opti(v,"first_media_id"),"首帧")?);body["end_image"]=Value::String(media_base64(c,opti(v,"last_media_id"),"尾帧")?)}
 body
 };
 let client=reqwest::blocking::Client::builder().timeout(std::time::Duration::from_secs(60)).build().map_err(|e|e.to_string())?;
 let (gid,submission)=if let Some(resume)=v.get("_resume") {
  (intv(resume,"generation_row_id")?,json!({"generation_id":strv(resume,"generation_id")?}))
 } else {
 let created=now();c.execute("INSERT INTO generations(operation,status,prompt,request_json,created_at,updated_at) VALUES(?,?,?,?,?,?)",params![operation,"running",prompt,body.to_string(),created,created]).map_err(|e|e.to_string())?;let gid=c.last_insert_rowid();
let mut request=client.post(url).json(&body);if !api_key.is_empty(){request=request.bearer_auth(api_key)}let response=request.send().map_err(|e|format!("视频生成请求失败（{}）：{e}",url))?;let status=response.status();let headers:Vec<String>=response.headers().iter().map(|(k,v)|format!("{}: {}",k,v.to_str().unwrap_or("?"))).collect();let response_body=response.text().map_err(|e|format!("无法读取生成服务响应：{e}"))?;eprintln!("[video-gen] status={} headers={:?} body_len={}",status,headers,response_body.len());if !status.is_success(){let detail=response_body.chars().take(1200).collect::<String>();let _=c.execute("UPDATE generations SET status='failed',error=?,updated_at=? WHERE id=?",params![format!("POST {}\n{}\n{}",url,status,detail),now(),gid]);return Err(format!("生成服务返回 {status}（{url}）：\n{}",detail))}let submission:Value=serde_json::from_str(&response_body).map_err(|_|format!("生成服务返回的不是 JSON（地址：{url}）：{}",response_body.chars().take(300).collect::<String>()))?;
 (gid,submission)
 };
 let generation_id=submission.get("generation_id").and_then(Value::as_str).ok_or("生成服务未返回 generation_id；请确认地址是 /v1/generations/t2v、i2v 或 fl2v")?;if let Some(job)=opti(v,"_job_id") {
  let resume=json!({"payload":v,"generation_row_id":gid,"generation_id":generation_id,"url":url,"operation":operation});
  c.execute("UPDATE background_jobs SET resume_json=?,updated_at=? WHERE id=?",params![resume.to_string(),now(),job]).map_err(|e|e.to_string())?;
 }
 let base=url.split("/v1/generations/").next().unwrap_or(url).trim_end_matches('/');let mut completed=None;
 for _ in 0..300{std::thread::sleep(std::time::Duration::from_secs(2));let item:Value=client.get(format!("{base}/v1/generations/{generation_id}")).bearer_auth(api_key).send().and_then(|r|r.error_for_status()).and_then(|r|r.json()).map_err(|e|format!("查询生成进度失败：{e}"))?;match item.get("status").and_then(Value::as_str){Some("completed")=>{completed=Some(item);break},Some("failed")|Some("cancelled")=>{let err=item.get("error").map(Value::to_string).unwrap_or_else(||"任务失败".into());let _=c.execute("UPDATE generations SET status='failed',error=?,updated_at=? WHERE id=?",params![err,now(),gid]);return Err(format!("视频生成失败：{err}"))},_=>{}}}
 let result=completed.ok_or("视频生成超时（10 分钟），任务仍可能在服务端继续运行")?;let output_url=result.get("result").and_then(Value::as_array).and_then(|x|x.first()).and_then(|x|x.get("url")).and_then(Value::as_str).ok_or("视频任务已完成，但未返回可下载的视频地址")?;let output_url=remote_comfy_url(url,output_url);let video=client.get(&output_url).send().and_then(|r|r.error_for_status()).and_then(|r|r.bytes()).map_err(|e|format!("下载生成视频失败：{e}"))?;
 let root=PathBuf::from(project(s,pid)?["path"].as_str().ok_or("无效项目路径")?);let dir=root.join("assets").join("videos");fs::create_dir_all(&dir).map_err(|e|e.to_string())?;let out=dir.join(format!("{}.mp4",Uuid::new_v4()));fs::write(&out,&video).map_err(|e|e.to_string())?;let tx=c.unchecked_transaction().map_err(|e|e.to_string())?;let name=format!("{}-{}.mp4",operation,gid);tx.execute("INSERT INTO media(name,path,kind,created_at) VALUES(?,?,?,?)",params![name,out.to_string_lossy(),"video",now()]).map_err(|e|e.to_string())?;let mid=tx.last_insert_rowid();if let Some(scene)=opti(v,"scene_id"){attach_video(&tx,scene,mid)?;}tx.execute("UPDATE generations SET status='completed',result_json=?,updated_at=? WHERE id=?",params![result.to_string(),now(),gid]).map_err(|e|e.to_string())?;let saved=json!({"id":mid,"name":name,"path":out,"kind":"video","created_at":now()});
 if let Some(job)=opti(v,"_job_id"){tx.execute("UPDATE background_jobs SET status='completed',result_json=?,error=NULL,updated_at=? WHERE id=?",params![saved.to_string(),now(),job]).map_err(|e|e.to_string())?;}
 tx.commit().map_err(|e|e.to_string())?;
 {let _guard=s.guard.lock().map_err(|_|"本地数据锁不可用")?;touch(s,pid);}Ok(json!({"id":mid,"name":name,"path":out,"kind":"video","created_at":now()}))
}
fn generate_video(s:&AppState,v:&Value)->Result<Value,String>{
 let pid=project_id(v)?;let operation=if opti(v,"first_media_id").is_some()&&opti(v,"last_media_id").is_some(){"flf2v"}else if opti(v,"image_media_id").is_some()||opti(v,"first_media_id").is_some()||opti(v,"last_media_id").is_some(){"i2v"}else{"t2v"}.to_string();let prompt=strv(v,"prompt")?;if prompt.trim().is_empty(){return Err("请输入视频画面描述".into())}
 let c=db(s,&pid)?;let scene=intv(v,"scene_id")?;c.query_row("SELECT id FROM scenes WHERE id=?",[scene],|r|r.get::<_,i64>(0)).map_err(|_|"场景不存在")?;for key in ["image_media_id","first_media_id","last_media_id"]{if let Some(id)=opti(v,key){if media(&c,Some(id)).map(|m|m["kind"]!="image").unwrap_or(true){return Err("所选媒体不存在".into())}}}let raw:String=c.query_row("SELECT value FROM settings WHERE key='models'",[],|r|r.get(0)).optional().map_err(|e|e.to_string())?.ok_or("请先在「模型与接口」中配置视频生成服务")?;let settings:Value=serde_json::from_str(&raw).map_err(|e|e.to_string())?;let model=if operation=="flf2v"&&settings["flf2v"]["url"].as_str().unwrap_or("").is_empty(){&settings["fl2v"]}else{&settings[&operation]};let url=model["url"].as_str().unwrap_or("");if url.is_empty(){return Err(format!("请先配置 {} 服务地址",operation))}if url.contains("/v1/generations/"){return generate_comfy_video(s,&c,&pid,v,&operation,&prompt,url,model["api_key"].as_str().unwrap_or(""))}
 let mut body=json!({"prompt":prompt,"duration":v.get("duration").and_then(Value::as_i64).unwrap_or(5),"aspect_ratio":v.get("aspect_ratio").and_then(Value::as_str).unwrap_or("16:9")});
 for (field,key) in [("image","image_media_id"),("first_image","first_media_id"),("last_image","last_media_id")] {if let Some(id)=opti(v,key){if let Some(m)=media(&c,Some(id)){body[field]=Value::String(m["path"].as_str().unwrap_or("").to_string());}}}
 let t=now();c.execute("INSERT INTO generations(operation,status,prompt,request_json,created_at,updated_at) VALUES(?,?,?,?,?,?)",params![operation,"running",prompt,body.to_string(),t,t]).map_err(|e|e.to_string())?;let gid=c.last_insert_rowid();
 let client=reqwest::blocking::Client::builder().timeout(std::time::Duration::from_secs(600)).build().map_err(|e|e.to_string())?;let mut req=client.post(url).json(&body);if let Some(key)=model["api_key"].as_str().filter(|x|!x.is_empty()){req=req.bearer_auth(key)}let response=req.send().map_err(|e|format!("视频生成请求失败：{e}"))?;let status=response.status();let content_type=response.headers().get(reqwest::header::CONTENT_TYPE).and_then(|x|x.to_str().ok()).unwrap_or("").to_string();let bytes=response.bytes().map_err(|e|e.to_string())?;if !status.is_success(){let err=String::from_utf8_lossy(&bytes).to_string();let _=c.execute("UPDATE generations SET status='failed',error=?,updated_at=? WHERE id=?",params![err,now(),gid]);return Err(format!("生成服务返回 {}：{}",status,err))}
 let (video,ext,result):(Vec<u8>,String,Value)=if bytes.starts_with(b"{"){let result:Value=serde_json::from_slice(&bytes).map_err(|e|format!("无法解析生成结果：{e}"))?;let encoded=result.pointer("/data/0/b64_json").or_else(||result.pointer("/data/0/base64")).or_else(||result.get("b64_json")).or_else(||result.get("base64")).and_then(Value::as_str).map(str::to_string);if let Some(encoded)=encoded{(base64::engine::general_purpose::STANDARD.decode(encoded).map_err(|e|format!("视频数据解码失败：{e}"))?,"mp4".into(),result)}else if let Some(remote)=result.pointer("/data/0/url").or_else(||result.get("url")).and_then(Value::as_str).map(str::to_string){let ext=Path::new(&remote).extension().and_then(|x|x.to_str()).unwrap_or("mp4").to_string();let downloaded=client.get(&remote).send().and_then(|r|r.error_for_status()).and_then(|r|r.bytes()).map_err(|e|format!("下载生成视频失败：{e}"))?;(downloaded.to_vec(),ext,result)}else{return Err("生成服务未返回视频 URL 或 base64 数据".into())}}else{(bytes.to_vec(),if content_type.contains("webm"){"webm".into()}else{"mp4".into()},json!({"binary":true}))};
 let root=PathBuf::from(project(s,&pid)?["path"].as_str().ok_or("无效项目路径")?);let dir=root.join("assets").join("videos");fs::create_dir_all(&dir).map_err(|e|e.to_string())?;let out=dir.join(format!("{}.{}",Uuid::new_v4(),ext));fs::write(&out,video).map_err(|e|e.to_string())?;let name=format!("{}-{}.{}",operation,gid,ext);c.execute("INSERT INTO media(name,path,kind,created_at) VALUES(?,?,?,?)",params![name,out.to_string_lossy(),"video",now()]).map_err(|e|e.to_string())?;let mid=c.last_insert_rowid();if let Some(scene)=opti(v,"scene_id"){attach_video(&c,scene,mid)?;}c.execute("UPDATE generations SET status='completed',result_json=?,updated_at=? WHERE id=?",params![result.to_string(),now(),gid]).map_err(|e|e.to_string())?;{let _guard=s.guard.lock().map_err(|_|"本地数据锁不可用")?;touch(s,&pid);}Ok(json!({"id":mid,"name":name,"path":out,"kind":"video","created_at":now()}))
}
fn delete_scene_video(s:&AppState,v:&Value)->Result<Value,String>{
 let mut c=db(s,&project_id(v)?)?;remove_scene_video(&mut c,intv(v,"scene_id")?,intv(v,"media_id")?)?;Ok(json!({"ok":true}))
}
fn remove_scene_video(c:&mut Connection,scene:i64,mid:i64)->Result<(),String>{
 let tx=c.transaction().map_err(|e|e.to_string())?;
 tx.execute("DELETE FROM scene_videos WHERE scene_id=? AND media_id=?",params![scene,mid]).map_err(|e|e.to_string())?;
 tx.execute("UPDATE scenes SET video_media_id=(SELECT MIN(media_id) FROM scene_videos WHERE scene_id=?) WHERE id=? AND video_media_id=?",params![scene,scene,mid]).map_err(|e|e.to_string())?;
 tx.commit().map_err(|e|e.to_string())?;Ok(())
}
fn list_jobs(s:&AppState)->Result<Value,String>{
 let mut items=Vec::new();for p in registry(s)? {let pid=strv(&p,"id")?;let c=db(s,&pid)?;
 let mut q=c.prepare("SELECT id,operation,status,prompt,created_at,updated_at,result_json,error,request_json FROM background_jobs ORDER BY id DESC").map_err(|e|e.to_string())?;
 let rows=q.query_map([],|r|{let request=r.get::<_,Option<String>>(8)?.and_then(|s|serde_json::from_str::<Value>(&s).ok());Ok(json!({"id":r.get::<_,i64>(0)?,"operation":r.get::<_,String>(1)?,"status":r.get::<_,String>(2)?,"prompt":r.get::<_,String>(3)?,"created_at":r.get::<_,String>(4)?,"updated_at":r.get::<_,String>(5)?,"result":r.get::<_,Option<String>>(6)?.and_then(|s|serde_json::from_str::<Value>(&s).ok()),"error":r.get::<_,Option<String>>(7)?,"scene_id":request.as_ref().and_then(|v|opti(v,"scene_id")),"project_id":pid,"project_name":p["name"]}))}).map_err(|e|e.to_string())?;
 for row in rows{items.push(row.map_err(|e|e.to_string())?);}}
 items.sort_by(|a,b|b["created_at"].as_str().cmp(&a["created_at"].as_str()));Ok(json!(items))
}
fn tracked_generation(s:&AppState,path:&str,v:&Value)->Result<Value,String>{
 let c=db(s,&project_id(v)?)?;let t=now();
 c.execute("INSERT INTO background_jobs(operation,status,prompt,created_at,updated_at,request_json) VALUES(?,'running',?,?,?,?)",params![path,v["prompt"].as_str().unwrap_or("剧集合并"),t,t,v.to_string()]).map_err(|e|e.to_string())?;let id=c.last_insert_rowid();
 let mut payload=v.clone();payload["_job_id"]=json!(id);let v=&payload;
 let result=match path {"/generations/image"=>generate_image(s,v),"/generations/video"=>generate_video(s,v),_=>merge_episode(s,v)};
 let (status,output,error)=match &result{Ok(value)=>("completed",Some(value.to_string()),None),Err(error)=>("failed",None,Some(error.clone()))};
 c.execute("UPDATE background_jobs SET status=?,result_json=?,error=?,updated_at=? WHERE id=?",params![status,output,error,now(),id]).map_err(|e|e.to_string())?;result
}
fn recover_jobs(s:&AppState,pid:&str,c:&Connection)->Result<(),String>{
 let rows={let mut q=c.prepare("SELECT id,resume_json FROM background_jobs WHERE status IN ('running','interrupted')").map_err(|e|e.to_string())?;
 let rows=q.query_map([],|r|Ok((r.get::<_,i64>(0)?,r.get::<_,Option<String>>(1)?))).map_err(|e|e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?;rows};
 for (id,raw) in rows {
  let Some(resume)=raw.and_then(|r|serde_json::from_str::<Value>(&r).ok()) else {
   c.execute("UPDATE background_jobs SET status='interrupted',error='缺少远程任务编号，无法自动恢复查询；服务端任务可能仍在执行，请勿重复提交',updated_at=? WHERE id=?",params![now(),id]).map_err(|e|e.to_string())?;continue;
  };
  c.execute("UPDATE background_jobs SET status='running',error=NULL,updated_at=? WHERE id=?",params![now(),id]).map_err(|e|e.to_string())?;
  let state=s.clone();let pid=pid.to_string();
  std::thread::spawn(move || {
   let result=(||->Result<Value,String>{
    let c=db(&state,&pid)?;let mut payload=resume["payload"].clone();payload["_job_id"]=json!(id);payload["_resume"]=resume.clone();
    let operation=strv(&resume,"operation")?;
    let raw:String=c.query_row("SELECT value FROM settings WHERE key='models'",[],|r|r.get(0)).map_err(|e|e.to_string())?;
    let settings:Value=serde_json::from_str(&raw).map_err(|e|e.to_string())?;
    let model=if operation=="flf2v"&&settings["flf2v"]["url"].as_str().unwrap_or("").is_empty(){&settings["fl2v"]}else{&settings[&operation]};
    generate_comfy_video(&state,&c,&pid,&payload,&operation,&strv(&payload,"prompt")?,&strv(&resume,"url")?,model["api_key"].as_str().unwrap_or(""))
   })();
   if let Err(error)=result {if let Ok(c)=db(&state,&pid){let _=c.execute("UPDATE background_jobs SET status='failed',error=?,updated_at=? WHERE id=? AND status='running'",params![error,now(),id]);}}
  });
 }
 Ok(())
}

fn scene_script(c:&Connection,id:i64)->Result<Value,String>{
 let raw=c.query_row("SELECT value FROM scene_scripts WHERE scene_id=?",[id],|r|r.get::<_,String>(0)).optional().map_err(|e|e.to_string())?;
 Ok(raw.and_then(|v|serde_json::from_str(&v).ok()).unwrap_or(json!({})))
}
fn script_command(s:&AppState,v:&Value,action:&str)->Result<Value,String>{
 let mut c=db(s,&project_id(v)?)?;
 if action=="load"{let raw=c.query_row("SELECT value FROM settings WHERE key='script_draft'",[],|r|r.get::<_,String>(0)).optional().map_err(|e|e.to_string())?;return Ok(raw.and_then(|v|serde_json::from_str(&v).ok()).unwrap_or(Value::Null))}
 let draft=v.get("draft").ok_or("缺少脚本")?;
 let title=strv(draft,"title")?;let scenes=draft["scenes"].as_array().ok_or("缺少场景")?;
 let tx=c.transaction().map_err(|e|e.to_string())?;
 tx.execute("INSERT INTO settings(key,value) VALUES('script_draft',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[draft.to_string()]).map_err(|e|e.to_string())?;
 let mut result=json!({"ok":true});
 if action=="publish"{
  result=publish_script(&tx,draft)?;
 }
 let _=(title,scenes);
 tx.commit().map_err(|e|e.to_string())?;Ok(result)
}
fn publish_script(c:&Connection,draft:&Value)->Result<Value,String>{
 let title=strv(draft,"title")?;let scenes=draft["scenes"].as_array().ok_or("缺少场景")?;
 if title.trim().is_empty()||scenes.is_empty()||scenes.iter().any(|scene|scene["description"].as_str().unwrap_or("").trim().is_empty()){return Err("请填写剧集标题和每个场景的描述".into())}
 let previous=c.query_row("SELECT value FROM settings WHERE key='script_publication'",[],|r|r.get::<_,String>(0)).optional().map_err(|e|e.to_string())?.and_then(|v|serde_json::from_str::<Value>(&v).ok());
 if let Some(previous)=previous{if previous["draft"]==*draft{let id=intv(&previous,"episode_id")?;if c.query_row("SELECT id FROM episodes WHERE id=?",[id],|r|r.get::<_,i64>(0)).optional().map_err(|e|e.to_string())?.is_some(){return Ok(json!({"episode_id":id}))}}}
 c.execute("INSERT INTO episodes(title,description,sort_order,created_at) VALUES(?,'',(SELECT COALESCE(MAX(sort_order),-1)+1 FROM episodes),?)",params![title,now()]).map_err(|e|e.to_string())?;let eid=c.last_insert_rowid();
 for (i,scene) in scenes.iter().enumerate(){
  c.execute("INSERT INTO scenes(episode_id,title,description,sort_order,created_at) VALUES(?,?,?,?,?)",params![eid,format!("scene{:03}",i+1),strv(scene,"description")?,i as i64,now()]).map_err(|e|e.to_string())?;let id=c.last_insert_rowid();
  let script=json!({"first":scene["first"].as_str().unwrap_or(""),"last":scene["last"].as_str().unwrap_or(""),"reference":scene["reference"].as_str().unwrap_or("")});
  c.execute("INSERT INTO scene_scripts VALUES(?,?)",params![id,script.to_string()]).map_err(|e|e.to_string())?;
 }
 c.execute("INSERT INTO settings(key,value) VALUES('script_publication',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[json!({"draft":draft,"episode_id":eid}).to_string()]).map_err(|e|e.to_string())?;Ok(json!({"episode_id":eid}))
}
fn manage_media(s:&AppState,v:&Value,delete:bool)->Result<Value,String>{
 let mut c=db(s,&project_id(v)?)?;let tx=c.transaction().map_err(|e|e.to_string())?;let id=intv(v,"id")?;
 if media(&tx,Some(id)).is_none(){return Err("资产不存在".into())}
 if delete{
  let used:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM roles WHERE design_media_id=?1 UNION ALL SELECT 1 FROM role_media WHERE media_id=?1 UNION ALL SELECT 1 FROM episodes WHERE cover_media_id=?1 UNION ALL SELECT 1 FROM scenes WHERE first_media_id=?1 OR last_media_id=?1 OR reference_media_id=?1 OR video_media_id=?1 UNION ALL SELECT 1 FROM scene_videos WHERE media_id=?1)",[id],|r|r.get(0)).map_err(|e|e.to_string())?;
  if used{return Err("资产仍被角色或场景引用，请先解除关联".into())}
  tx.execute("DELETE FROM media WHERE id=?",[id]).map_err(|e|e.to_string())?;
 }else{let name=strv(v,"name")?;if name.trim().is_empty(){return Err("名称不能为空".into())}tx.execute("UPDATE media SET name=? WHERE id=?",params![name.trim(),id]).map_err(|e|e.to_string())?;}
 tx.commit().map_err(|e|e.to_string())?;Ok(json!({"ok":true}))
}
#[tauri::command]
async fn api_request(state:State<'_,AppState>,method:String,path:String,payload:Option<Value>)->Result<Value,String>{let handle=state.inner().clone();tauri::async_runtime::spawn_blocking(move || {let state=&handle;let v=payload.unwrap_or(Value::Null);if method=="POST" && ["/generations/image","/generations/video","/episodes/merge"].contains(&path.as_str()){return tracked_generation(state,&path,&v)}if method=="POST" && path=="/media/video-frame" {return video_frame(state,&v)}let _lock=state.guard.lock().map_err(|_|"本地数据锁不可用")?;match(method.as_str(),path.as_str()){("GET","/tasks")=>list_jobs(state),("POST","/scripts/load")=>script_command(state,&v,"load"),("POST","/scripts/save")=>script_command(state,&v,"save"),("POST","/scripts/publish")=>script_command(state,&v,"publish"),("POST","/media/rename")=>manage_media(state,&v,false),("POST","/media/delete")=>manage_media(state,&v,true),("POST","/scenes/delete")=>{db(state,&project_id(&v)?)?.execute("DELETE FROM scenes WHERE id=?",[intv(&v,"id")?]).map_err(|e|e.to_string())?;Ok(json!({"ok":true}))},("POST","/scenes/delete-video")=>delete_scene_video(state,&v),("GET","/projects")=>Ok(Value::Array(registry(&state)?)),("POST","/project")=>snapshot(&state,v.get("id").and_then(Value::as_str).ok_or("缺少项目 ID")?),("POST","/projects")=>create_project(&state,&v),("POST","/projects/open")=>open_project(&state,&v),("POST","/media/import")=>import_media(&state,&v),("POST","/media/export")=>export_media(&state,&v),("POST","/generations/image")=>generate_image(&state,&v),("POST","/generations/video")=>generate_video(&state,&v),("POST","/roles")=>insert_role(&state,&v),("POST","/roles/update")=>update_role(&state,&v),("POST","/roles/delete")=>delete_role(&state,&v),("POST","/roles/media/delete")=>delete_role_media(&state,&v),("POST","/episodes")=>insert_episode(&state,&v),("POST","/episodes/update")=>update_episode(&state,&v),("POST","/episodes/delete")=>delete_episode(&state,&v),("POST","/scenes")=>insert_scene(&state,&v),("POST","/scenes/update")=>update_scene(&state,&v),("POST","/scenes/reorder")=>reorder_scenes(&state,&v),("POST","/scenes/select-video")=>select_video(&state,&v),("POST","/episodes/merge")=>merge_episode(&state,&v),("POST","/prompts")=>insert_prompt(&state,&v),("POST","/prompts/update")=>update_prompt(&state,&v),("POST","/settings")=>save_settings(&state,&v),_=>Err(format!("未实现的本地命令：{method} {path}"))}}).await.map_err(|e|e.to_string())?}
pub fn run(){tauri::Builder::default().plugin(tauri_plugin_dialog::init()).setup(|app|{let root=app.path().app_data_dir()?;fs::create_dir_all(root.join("projects"))?;let asset_scope=app.asset_protocol_scope();let state=AppState{root,guard:std::sync::Arc::new(Mutex::new(())),asset_scope};for item in registry(&state).unwrap_or_default(){if let Some(pid)=item["id"].as_str(){if let Ok(c)=db(&state,pid){recover_jobs(&state,pid,&c).map_err(std::io::Error::other)?;}}if let Some(path)=item["path"].as_str(){let _=state.asset_scope.allow_directory(Path::new(path).join("assets"),true);}}app.manage(state);Ok(())}).invoke_handler(tauri::generate_handler![api_request,create_project_command]).run(tauri::generate_context!()).expect("启动戏梦失败");}

#[cfg(test)]
mod video_tests {
    use super::*;
    #[test]
    fn scripts_preserve_prompts_order_and_avoid_duplicate_publication() {
        let mut c=Connection::open_in_memory().unwrap();migrate(&c).unwrap();
        let draft=json!({"title":"第一集","scenes":[{"description":"开场","first":"@主角 在雨中","last":"远景","reference":"水彩风格"},{"description":"结束","first":"","last":"","reference":""}]});
        let tx=c.transaction().unwrap();let result=publish_script(&tx,&draft).unwrap();tx.commit().unwrap();
        let id=result["episode_id"].as_i64().unwrap();
        assert_eq!(publish_script(&c,&draft).unwrap()["episode_id"],id);
        assert_eq!(c.query_row("SELECT COUNT(*) FROM episodes",[],|r|r.get::<_,i64>(0)).unwrap(),1);
        let first=c.query_row("SELECT id FROM scenes WHERE episode_id=? ORDER BY sort_order LIMIT 1",[id],|r|r.get::<_,i64>(0)).unwrap();
        assert_eq!(scene_script(&c,first).unwrap()["first"],"@主角 在雨中");
        assert_eq!(scene_script(&c,first).unwrap()["reference"],"水彩风格");
        let invalid=json!({"title":"无效","scenes":[{"description":"有效"},{"description":"  "}]});
        let tx=c.transaction().unwrap();assert!(publish_script(&tx,&invalid).is_err());drop(tx);
        assert_eq!(c.query_row("SELECT COUNT(*) FROM scenes",[],|r|r.get::<_,i64>(0)).unwrap(),2);
        c.execute("DELETE FROM episodes WHERE id=?",[id]).unwrap();
        assert_eq!(scene_script(&c,first).unwrap(),json!({}));
        assert!(publish_script(&c,&draft).is_ok());
    }
    #[test]
    fn library_video_can_be_reused_but_images_cannot() {
        let mut c=Connection::open_in_memory().unwrap();migrate(&c).unwrap();
        c.execute("INSERT INTO episodes(id,title,sort_order,created_at) VALUES(1,'Episode',0,'0')",[]).unwrap();
        c.execute("INSERT INTO scenes(id,episode_id,title,sort_order,created_at) VALUES(1,1,'one',0,'0'),(2,1,'two',1,'0')",[]).unwrap();
        c.execute("INSERT INTO media(id,name,path,kind,created_at) VALUES(1,'video','a.mp4','video','0'),(2,'image','a.png','image','0')",[]).unwrap();
        let tx=c.transaction().unwrap();select_asset_video(&tx,1,1).unwrap();select_asset_video(&tx,1,1).unwrap();select_asset_video(&tx,2,1).unwrap();
        assert!(select_asset_video(&tx,1,2).is_err());assert!(select_asset_video(&tx,1,999).is_err());assert!(select_asset_video(&tx,999,1).is_err());tx.commit().unwrap();
        assert_eq!(scene_videos(&c,1).unwrap().len(),1);assert_eq!(scene_videos(&c,2).unwrap().len(),1);
        assert_eq!(c.query_row("SELECT video_media_id FROM scenes WHERE id=1",[],|r|r.get::<_,i64>(0)).unwrap(),1);
    }
    #[test]
    fn extracts_actual_first_and_last_video_frames() {
        let binary = if Path::new("/opt/homebrew/bin/ffmpeg").exists() { "/opt/homebrew/bin/ffmpeg" } else { "ffmpeg" };
        let dir = std::env::temp_dir().join(format!("spielberg-frames-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let video = dir.join("colors.mp4");
        let output = std::process::Command::new(binary).args(["-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=32x32:r=10:d=0.3", "-f", "lavfi", "-i", "color=c=red:s=32x32:r=10:d=0.2", "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0", "-c:v", "libx264"]).arg(&video).output().unwrap();
        assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
        for last in [false, true] {
            let image = dir.join(if last { "last.png" } else { "first.png" });
            extract_video_frame(&video, &image, last).unwrap();
            let pixels = std::process::Command::new(binary).args(["-v", "error", "-i"]).arg(&image).args(["-f", "rawvideo", "-pix_fmt", "rgb24", "-"]).output().unwrap();
            assert!(pixels.status.success());
            assert_eq!(pixels.stdout.len(), 32 * 32 * 3);
            let rgb = &pixels.stdout[..3];
            if last { assert!(rgb[0] > 240 && rgb[2] < 10, "last frame should be red: {rgb:?}"); }
            else { assert!(rgb[2] > 240 && rgb[0] < 10, "first frame should be blue: {rgb:?}"); }
        }
        assert!(extract_video_frame(&dir.join("missing.mp4"), &dir.join("invalid.png"), false).is_err());
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn migrate_preserves_legacy_video_and_versions() {
        let c=Connection::open_in_memory().unwrap();
        migrate(&c).unwrap();
        c.execute("INSERT INTO episodes(id,title,sort_order,created_at) VALUES(1,'Episode',0,'0')",[]).unwrap();
        c.execute("INSERT INTO media(id,name,path,kind,created_at) VALUES(1,'v1','a.mp4','video','0'),(2,'v2','b.mp4','video','0')",[]).unwrap();
        c.execute("INSERT INTO scenes(id,episode_id,title,sort_order,created_at,video_media_id) VALUES(1,1,'Scene',0,'0',1)",[]).unwrap();
        migrate(&c).unwrap(); migrate(&c).unwrap();
        assert_eq!(scene_videos(&c,1).unwrap().len(),1);
        attach_video(&c,1,2).unwrap();
        assert_eq!(scene_videos(&c,1).unwrap().len(),2);
        let selected:i64=c.query_row("SELECT video_media_id FROM scenes WHERE id=1",[],|r|r.get(0)).unwrap();
        assert_eq!(selected,1,"Generating must preserve the user's chosen version");
        assert_eq!(scene_options(&c,1).unwrap()["first"],true);
        assert_eq!(scene_options(&c,1).unwrap()["last"],true);
        c.execute("DELETE FROM episodes WHERE id=1",[]).unwrap();
        assert!(scene_videos(&c,1).unwrap().is_empty());
        assert!(media(&c,Some(1)).is_some(),"Deleting a scene must not erase source assets");
    }
    #[test]
    fn deletion_keeps_selection_valid_and_does_not_resurrect_versions() {
        let mut c=Connection::open_in_memory().unwrap();migrate(&c).unwrap();
        c.execute("INSERT INTO episodes(id,title,sort_order,created_at) VALUES(1,'Episode',0,'0')",[]).unwrap();
        c.execute("INSERT INTO media(id,name,path,kind,created_at) VALUES(1,'v1','a.mp4','video','0'),(2,'v2','b.mp4','video','0')",[]).unwrap();
        c.execute("INSERT INTO scenes(id,episode_id,title,sort_order,created_at) VALUES(1,1,'Scene',0,'0')",[]).unwrap();
        attach_video(&c,1,1).unwrap();attach_video(&c,1,2).unwrap();
        remove_scene_video(&mut c,1,1).unwrap();migrate(&c).unwrap();
        assert_eq!(scene_videos(&c,1).unwrap().len(),1);
        assert_eq!(c.query_row("SELECT video_media_id FROM scenes WHERE id=1",[],|r|r.get::<_,i64>(0)).unwrap(),2);
        remove_scene_video(&mut c,1,2).unwrap();migrate(&c).unwrap();
        assert!(scene_videos(&c,1).unwrap().is_empty());
        assert_eq!(c.query_row("SELECT video_media_id FROM scenes WHERE id=1",[],|r|r.get::<_,Option<i64>>(0)).unwrap(),None);
        attach_video(&c,1,1).unwrap();
        c.execute("DELETE FROM scenes WHERE id=1",[]).unwrap();
        assert!(scene_videos(&c,1).unwrap().is_empty());
        assert!(media(&c,Some(1)).is_some());
        assert_eq!(c.query_row("SELECT COUNT(*) FROM episodes",[],|r|r.get::<_,i64>(0)).unwrap(),1);
    }
    #[test]
    fn merges_different_sizes_and_missing_audio() {
        let binary="/opt/homebrew/bin/ffmpeg";
        if !Path::new(binary).exists(){return}
        let dir=std::env::temp_dir().join(format!("spielberg-test-{}",Uuid::new_v4()));fs::create_dir_all(&dir).unwrap();
        let a=dir.join("with-audio.mp4");let b=dir.join("silent.mp4");let out=dir.join("merged.mp4");
        assert!(std::process::Command::new(binary).args(["-v","error","-f","lavfi","-i","color=c=blue:s=160x90:r=24:d=0.5","-f","lavfi","-i","sine=frequency=440:duration=0.5","-c:v","libx264","-c:a","aac","-shortest"]).arg(&a).status().unwrap().success());
        assert!(std::process::Command::new(binary).args(["-v","error","-f","lavfi","-i","color=c=red:s=90x160:r=30:d=0.5","-c:v","libx264"]).arg(&b).status().unwrap().success());
        merge_video_files(&[a.to_string_lossy().into(),b.to_string_lossy().into()],&out).unwrap();
        let info=std::process::Command::new("/opt/homebrew/bin/ffprobe").args(["-v","error","-show_streams","-show_format","-of","json"]).arg(&out).output().unwrap();let info:Value=serde_json::from_slice(&info.stdout).unwrap();
        assert!(info["streams"].as_array().unwrap().iter().any(|v|v["codec_type"]=="audio"));
        let duration:f64=info["format"]["duration"].as_str().unwrap().parse().unwrap();assert!(duration>0.9&&duration<1.3);
        fs::remove_dir_all(dir).unwrap();
    }
}
