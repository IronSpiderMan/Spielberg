use super::*;

pub fn install(c: &Connection) -> Result<(), String> {
    let _ = c.execute("ALTER TABLE media ADD COLUMN deleted_at TEXT", []);
    let _ = c.execute("ALTER TABLE media ADD COLUMN purged_at TEXT", []);
    c.execute_batch("CREATE INDEX IF NOT EXISTS media_active ON media(deleted_at,id);
    CREATE TABLE IF NOT EXISTS revisions(section TEXT PRIMARY KEY, version INTEGER NOT NULL DEFAULT 0);
    CREATE VIEW IF NOT EXISTS asset_usage AS
    SELECT design_media_id AS media_id,'role' AS kind,id AS target_id,name AS title,NULL AS episode_id,NULL AS episode_title,'角色主图' AS purpose FROM roles WHERE design_media_id IS NOT NULL
    UNION ALL SELECT rm.media_id,'role',r.id,r.name,NULL,NULL,'角色图片' FROM role_media rm JOIN roles r ON r.id=rm.role_id WHERE rm.media_id IS NOT r.design_media_id
    UNION ALL SELECT cover_media_id,'episode',id,title,id,title,'剧集封面' FROM episodes WHERE cover_media_id IS NOT NULL
    UNION ALL SELECT s.first_media_id,'scene',s.id,s.title,e.id,e.title,'场景首帧' FROM scenes s JOIN episodes e ON e.id=s.episode_id WHERE s.first_media_id IS NOT NULL
    UNION ALL SELECT s.last_media_id,'scene',s.id,s.title,e.id,e.title,'场景尾帧' FROM scenes s JOIN episodes e ON e.id=s.episode_id WHERE s.last_media_id IS NOT NULL
    UNION ALL SELECT s.reference_media_id,'scene',s.id,s.title,e.id,e.title,'场景参考图' FROM scenes s JOIN episodes e ON e.id=s.episode_id WHERE s.reference_media_id IS NOT NULL
    UNION ALL SELECT sv.media_id,'scene',s.id,s.title,e.id,e.title,CASE WHEN s.video_media_id=sv.media_id THEN '当前视频' ELSE '候选视频' END FROM scene_videos sv JOIN scenes s ON s.id=sv.scene_id JOIN episodes e ON e.id=s.episode_id;").map_err(|e| e.to_string())?;
    for (table, sections) in [
        ("media", vec!["media", "roles", "episodes"]), ("roles",vec!["roles"]),
        ("role_media",vec!["roles"]), ("episodes",vec!["episodes"]), ("scenes",vec!["episodes"]),
        ("scene_videos",vec!["episodes"]), ("scene_scripts",vec!["episodes"]),
        ("scene_options",vec!["episodes"]), ("prompts",vec!["prompts"]),
        ("settings",vec!["settings"]), ("background_jobs",vec!["jobs"]),
    ] {
        for section in &sections { c.execute("INSERT OR IGNORE INTO revisions(section) VALUES(?)",[section]).map_err(|e|e.to_string())?; }
        for event in ["INSERT", "UPDATE", "DELETE"] {
            let body = sections.iter().map(|section|format!("UPDATE revisions SET version=version+1 WHERE section='{section}';")).collect::<String>();
            c.execute_batch(&format!("CREATE TRIGGER IF NOT EXISTS revision_{table}_{event} AFTER {event} ON {table} BEGIN {body} END;")).map_err(|e|e.to_string())?;
        }
    }
    // Foreign keys also need to reject references to soft-deleted assets.
    for (table, columns) in [("roles",vec!["design_media_id"]),("role_media",vec!["media_id"]),("episodes",vec!["cover_media_id"]),("scenes",vec!["first_media_id","last_media_id","reference_media_id","video_media_id"]),("scene_videos",vec!["media_id"])] {
        for event in ["INSERT","UPDATE"] {
            for column in &columns {
                c.execute_batch(&format!("CREATE TRIGGER IF NOT EXISTS active_{table}_{column}_{event} BEFORE {event} ON {table} WHEN EXISTS(SELECT 1 FROM media WHERE id=NEW.{column} AND deleted_at IS NOT NULL) BEGIN SELECT RAISE(ABORT,'资产已在回收站，请先恢复'); END;")).map_err(|e|e.to_string())?;
            }
        }
    }
    Ok(())
}

pub fn revisions(c: &Connection) -> Result<Value,String> {
    let mut q=c.prepare("SELECT section,version FROM revisions").map_err(|e|e.to_string())?;
    let rows=q.query_map([],|r|Ok((r.get::<_,String>(0)?,r.get::<_,i64>(1)?))).map_err(|e|e.to_string())?;
    let mut result=json!({});
    for row in rows { let (key,value)=row.map_err(|e|e.to_string())?; result[key]=json!(value); }
    Ok(result)
}

pub fn usages(c:&Connection, id:i64)->Result<Vec<Value>,String> {
    let mut q=c.prepare("SELECT kind,target_id,title,episode_id,episode_title,purpose FROM asset_usage WHERE media_id=? ORDER BY kind,target_id,purpose").map_err(|e|e.to_string())?;
    let rows=q.query_map([id],|r|Ok(json!({"kind":r.get::<_,String>(0)?,"target_id":r.get::<_,i64>(1)?,"title":r.get::<_,String>(2)?,"episode_id":r.get::<_,Option<i64>>(3)?,"episode_title":r.get::<_,Option<String>>(4)?,"purpose":r.get::<_,String>(5)?}))).map_err(|e|e.to_string())?;
    rows.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())
}

pub fn list(c:&Connection,v:&Value)->Result<Value,String> {
    let filter=v["usage"].as_str().unwrap_or("all");
    let kind=v["kind"].as_str().unwrap_or("all");
    let search=v["query"].as_str().unwrap_or("").to_lowercase();
    let page=v["page"].as_i64().unwrap_or(1).max(1);
    let limit=v["limit"].as_i64().unwrap_or(24).clamp(1,60);
    let condition="m.purged_at IS NULL AND (?1='all' OR m.kind=?1) AND instr(lower(m.name),?2)>0 AND ((?3='trash' AND m.deleted_at IS NOT NULL) OR (?3!='trash' AND m.deleted_at IS NULL)) AND (?3 NOT IN ('used','unused') OR (?3='used' AND EXISTS(SELECT 1 FROM asset_usage u WHERE u.media_id=m.id)) OR (?3='unused' AND NOT EXISTS(SELECT 1 FROM asset_usage u WHERE u.media_id=m.id)))";
    let total:i64=c.query_row(&format!("SELECT COUNT(*) FROM media m WHERE {condition}"),params![kind,search,filter],|r|r.get(0)).map_err(|e|e.to_string())?;
    let mut q=c.prepare(&format!("SELECT m.id,m.name,m.path,m.kind,m.created_at,m.deleted_at,(SELECT COUNT(*) FROM asset_usage u WHERE u.media_id=m.id) FROM media m WHERE {condition} ORDER BY m.id DESC LIMIT ?4 OFFSET ?5")).map_err(|e|e.to_string())?;
    let items=q.query_map(params![kind,search,filter,limit,(page-1).saturating_mul(limit)],|r|Ok(json!({"id":r.get::<_,i64>(0)?,"name":r.get::<_,String>(1)?,"path":r.get::<_,String>(2)?,"kind":r.get::<_,String>(3)?,"created_at":r.get::<_,String>(4)?,"deleted_at":r.get::<_,Option<String>>(5)?,"usage_count":r.get::<_,i64>(6)?}))).map_err(|e|e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?;
    Ok(json!({"items":items,"total":total}))
}

pub fn no_running_jobs(c:&Connection)->Result<(),String> {
    let running:bool=c.query_row("SELECT EXISTS(SELECT 1 FROM background_jobs WHERE status='running')",[],|r|r.get(0)).map_err(|e|e.to_string())?;
    if running { return Err("请等待后台任务结束后再操作".into()); }
    Ok(())
}

pub fn trash(c:&Connection,id:i64)->Result<(),String> {
    // A generating task may be reading an unassigned input asset.
    no_running_jobs(c)?;
    if !usages(c,id)?.is_empty() { return Err("资产仍被使用，请在用途明细中查看并解除引用".into()); }
    if c.execute("UPDATE media SET deleted_at=? WHERE id=? AND deleted_at IS NULL",params![now(),id]).map_err(|e|e.to_string())? != 1 { return Err("资产不存在或已在回收站".into()); }
    Ok(())
}

pub fn owned_file(root:&Path,path:&Path)->Result<PathBuf,String> {
    let project=root.canonicalize().map_err(|e|e.to_string())?;
    let base=root.join("assets").canonicalize().map_err(|e|e.to_string())?;
    if !base.starts_with(&project){return Err("素材目录不能指向项目之外".into())}
    let resolved=path.canonicalize().map_err(|e|e.to_string())?;
    if !resolved.starts_with(&base) || !resolved.is_file() || fs::symlink_metadata(path).map_err(|e|e.to_string())?.file_type().is_symlink() { return Err("仅允许操作本项目 assets 目录中的普通文件".into()); }
    Ok(resolved)
}

pub fn purge(c:&Connection,root:&Path,id:i64)->Result<(),String> {
    no_running_jobs(c)?;
    let path:String=c.query_row("SELECT path FROM media WHERE id=? AND deleted_at IS NOT NULL AND purged_at IS NULL",[id],|r|r.get(0)).map_err(|_|"仅允许永久删除回收站资产".to_string())?;
    if !usages(c,id)?.is_empty() { return Err("资产仍被引用".into()); }
    if Path::new(&path).exists() {
        let owned=owned_file(root,Path::new(&path))?;
        let mut q=c.prepare("SELECT path FROM media WHERE id!=? AND purged_at IS NULL").map_err(|e|e.to_string())?;
        let others=q.query_map([id],|r|r.get::<_,String>(0)).map_err(|e|e.to_string())?;
        let mut shared=false;
        for other in others {if Path::new(&other.map_err(|e|e.to_string())?).canonicalize().ok().as_ref()==Some(&owned){shared=true;break}}
        if !shared{fs::remove_file(owned).map_err(|e|e.to_string())?;}
    }
    // Keep the ID reserved so an old generation result cannot refer to a new asset.
    c.execute("UPDATE media SET purged_at=? WHERE id=?",params![now(),id]).map_err(|e|e.to_string())?;
    Ok(())
}

pub fn files_under(dir:&Path)->Result<Vec<PathBuf>,String> {
    let mut result=vec![];
    if !dir.exists(){return Ok(result)}
    if fs::symlink_metadata(dir).map_err(|e|e.to_string())?.file_type().is_symlink(){return Err("不能扫描符号链接目录".into())}
    for entry in fs::read_dir(dir).map_err(|e|e.to_string())? {
        let entry=entry.map_err(|e|e.to_string())?;
        let kind=entry.file_type().map_err(|e|e.to_string())?;
        if kind.is_symlink(){continue}
        if kind.is_dir(){result.extend(files_under(&entry.path())?)}else if kind.is_file(){result.push(entry.path())}
    }
    Ok(result)
}

pub fn disk_scan(c:&Connection,root:&Path)->Result<Value,String> {
    no_running_jobs(c)?;
    let mut q=c.prepare("SELECT path FROM media WHERE purged_at IS NULL").map_err(|e|e.to_string())?;
    let known=q.query_map([],|r|r.get::<_,String>(0)).map_err(|e|e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?;
    let known:std::collections::HashSet<_>=known.iter().map(|p|Path::new(p).canonicalize().unwrap_or_else(|_|PathBuf::from(p))).collect();
    let mut files=vec![];
    for path in files_under(&root.join("assets"))? {
        if !known.contains(&path.canonicalize().map_err(|e|e.to_string())?) {
            let size=fs::metadata(&path).map_err(|e|e.to_string())?.len();
            files.push(json!({"path":path,"size":size}));
        }
    }
    let cache=root.join(".cache/thumbnails");
    if cache.exists() && !cache.canonicalize().map_err(|e|e.to_string())?.starts_with(root.canonicalize().map_err(|e|e.to_string())?){return Err("缓存目录不能指向项目之外".into())}
    let cache_bytes:u64=files_under(&cache)?.iter().filter_map(|p|fs::metadata(p).ok().map(|m|m.len())).sum();
    Ok(json!({"files":files,"cache_bytes":cache_bytes}))
}

pub fn cleanup(c:&Connection,root:&Path,v:&Value)->Result<Value,String> {
    let scan=disk_scan(c,root)?;
    let requested=v["files"].as_array().cloned().unwrap_or_default();
    let allowed=scan["files"].as_array().unwrap();
    let mut count=0;
    for file in requested {
        let path=file.as_str().ok_or("清理文件无效")?;
        if !allowed.iter().any(|item|item["path"]==path){continue}
        let source=owned_file(root,Path::new(path))?;
        let name=source.file_name().unwrap_or_default().to_string_lossy();
        let kind=match source.extension().and_then(|e|e.to_str()).unwrap_or("").to_ascii_lowercase().as_str(){"mp4"|"mov"|"webm"|"mkv"=>"video","png"|"jpg"|"jpeg"|"webp"|"gif"=>"image",_=>"file"};
        c.execute("INSERT INTO media(name,path,kind,created_at,deleted_at) VALUES(?,?,?,?,?)",params![name,path,kind,now(),now()]).map_err(|e|e.to_string())?;
        count+=1;
    }
    if v["clear_cache"].as_bool().unwrap_or(false) {
        for path in files_under(&root.join(".cache/thumbnails"))? { fs::remove_file(path).map_err(|e|e.to_string())?; }
    }
    Ok(json!({"recycled":count}))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture()->Connection {
        let c=Connection::open_in_memory().unwrap();migrate(&c).unwrap();
        c.execute_batch("INSERT INTO media(id,name,path,kind,created_at) VALUES(1,'hero','/hero.png','image','1'),(2,'clip','/clip.mp4','video','1');
        INSERT INTO roles(id,name,design_media_id,created_at) VALUES(1,'Hero',1,'1');
        INSERT INTO role_media VALUES(1,1);
        INSERT INTO episodes(id,title,sort_order,created_at,cover_media_id) VALUES(1,'Episode',0,'1',1);
        INSERT INTO scenes(id,episode_id,title,sort_order,created_at,first_media_id,last_media_id,reference_media_id,video_media_id) VALUES(1,1,'Scene',0,'1',1,1,1,2);
        INSERT INTO scene_videos VALUES(1,2);").unwrap();c
    }
    #[test]
    fn usage_covers_all_references_and_deletion_is_guarded() {
        let c=fixture();
        let image=usages(&c,1).unwrap();
        assert_eq!(image.len(),5); // Main image is not duplicated as a gallery image.
        assert!(image.iter().any(|u|u["purpose"]=="剧集封面"));
        assert!(image.iter().any(|u|u["episode_title"]=="Episode"&&u["purpose"]=="场景参考图"));
        assert_eq!(usages(&c,2).unwrap()[0]["purpose"],"当前视频");
        assert!(trash(&c,1).is_err());assert!(trash(&c,2).is_err());
        c.execute_batch("UPDATE scenes SET video_media_id=NULL;").unwrap();
        assert_eq!(usages(&c,2).unwrap()[0]["purpose"],"候选视频");
        c.execute_batch("DELETE FROM scene_videos;").unwrap();trash(&c,2).unwrap();
        assert!(media(&c,Some(2)).is_none());
        assert!(select_asset_video(&c,1,2).is_err());
        assert!(c.execute("UPDATE scenes SET video_media_id=2 WHERE id=1",[]).is_err());
        c.execute("UPDATE media SET deleted_at=NULL WHERE id=2",[]).unwrap();
        select_asset_video(&c,1,2).unwrap();
    }
    #[test]
    fn filters_apply_before_pagination_and_revisions_track_only_changes() {
        let c=fixture();let before=revisions(&c).unwrap();
        assert_eq!(list(&c,&json!({"usage":"used"})).unwrap()["total"],2);
        assert_eq!(revisions(&c).unwrap(),before);
        for id in 3..=60 {c.execute("INSERT INTO media(id,name,path,kind,created_at) VALUES(?,'unused','/file','image','1')",[id]).unwrap();}
        trash(&c,60).unwrap();
        let page=list(&c,&json!({"usage":"unused","kind":"image","page":2,"limit":24})).unwrap();
        assert_eq!(page["total"],57);assert_eq!(page["items"].as_array().unwrap().len(),24);assert_eq!(page["items"][0]["id"],35);
        assert_eq!(list(&c,&json!({"usage":"trash"})).unwrap()["items"][0]["id"],60);
        assert_eq!(list(&c,&json!({"query":"%' OR 1=1 --"})).unwrap()["total"],0);
        let after=revisions(&c).unwrap();assert_eq!(after["settings"],before["settings"]);assert_ne!(after["media"],before["media"]);
        c.execute("INSERT INTO background_jobs(operation,status,prompt,created_at,updated_at) VALUES('image','running','','1','1')",[]).unwrap();
        assert!(trash(&c,59).is_err());
    }
    #[test]
    fn cleanup_is_reversible_and_purge_cannot_delete_external_files() {
        let root=std::env::temp_dir().join(Uuid::new_v4().to_string());fs::create_dir_all(root.join("assets")).unwrap();
        let file=root.join("assets/orphan.png");fs::write(&file,b"test").unwrap();
        let c=Connection::open_in_memory().unwrap();migrate(&c).unwrap();
        let scan=disk_scan(&c,&root).unwrap();assert_eq!(scan["files"].as_array().unwrap().len(),1);
        cleanup(&c,&root,&json!({"files":[file]})).unwrap();
        assert!(file.exists());assert_eq!(list(&c,&json!({"usage":"trash"})).unwrap()["total"],1);
        assert_eq!(disk_scan(&c,&root).unwrap()["files"].as_array().unwrap().len(),0);
        let id=c.last_insert_rowid();purge(&c,&root,id).unwrap();assert!(!file.exists());
        assert_eq!(list(&c,&json!({"usage":"trash"})).unwrap()["total"],0);
        // Purging reserves its ID, and never unlinks a file shared by another record.
        fs::write(&file,b"shared").unwrap();
        c.execute("INSERT INTO media(name,path,kind,created_at) VALUES('active',?,'image','1')",[file.to_string_lossy().as_ref()]).unwrap();
        assert!(c.last_insert_rowid()>id);
        let alias=root.join("assets/./orphan.png");
        c.execute("INSERT INTO media(name,path,kind,created_at,deleted_at) VALUES('alias',?,'image','1','1')",[alias.to_string_lossy().as_ref()]).unwrap();
        purge(&c,&root,c.last_insert_rowid()).unwrap();assert!(file.exists());
        let external=root.join("outside.png");fs::write(&external,b"keep").unwrap();
        c.execute("INSERT INTO media(name,path,kind,created_at,deleted_at) VALUES('external',?,'image','1','1')",[external.to_string_lossy().as_ref()]).unwrap();
        assert!(purge(&c,&root,c.last_insert_rowid()).is_err());assert!(external.exists());
        fs::remove_dir_all(root).unwrap();
    }
}
