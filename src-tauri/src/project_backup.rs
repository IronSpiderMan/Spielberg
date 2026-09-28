use super::*;
use std::collections::HashMap;

fn pack_directory(source:&Path,destination:&Path)->Result<(),String>{
    let file=fs::File::create(destination).map_err(|e|e.to_string())?;
    let encoder=flate2::write::GzEncoder::new(file,flate2::Compression::default());
    let mut archive=tar::Builder::new(encoder);
    let mut files=vec![source.join("manifest.json"),source.join("spielberg.sqlite")];
    files.extend(catalog::files_under(&source.join("assets"))?);
    for path in files {
        let name=path.strip_prefix(source).map_err(|e|e.to_string())?;
        archive.append_path_with_name(&path,name).map_err(|e|e.to_string())?;
    }
    archive.into_inner().map_err(|e|e.to_string())?.finish().map_err(|e|e.to_string())?;
    Ok(())
}

fn unpack_archive(source:&Path,destination:&Path)->Result<(),String>{
    let file=fs::File::open(source).map_err(|e|e.to_string())?;
    let decoder=flate2::read::GzDecoder::new(file);
    let mut archive=tar::Archive::new(decoder);
    fs::create_dir(destination).map_err(|e|e.to_string())?;
    let result=(||{
        for entry in archive.entries().map_err(|e|e.to_string())? {
            let mut entry=entry.map_err(|e|e.to_string())?;
            let path=entry.path().map_err(|e|e.to_string())?.into_owned();
            if path.components().any(|part|!matches!(part,std::path::Component::Normal(_))) {return Err("备份压缩包包含无效路径".into())}
            if !entry.header().entry_type().is_file(){return Err("备份压缩包包含非普通文件".into())}
            if path != Path::new("manifest.json") && path != Path::new("spielberg.sqlite") && !path.starts_with("assets/"){return Err("备份压缩包包含未知文件".into())}
            let target=destination.join(path);
            if target.exists(){return Err("备份压缩包包含重复文件".into())}
            fs::create_dir_all(target.parent().unwrap()).map_err(|e|e.to_string())?;
            std::io::copy(&mut entry,&mut fs::File::create(target).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
        }
        Ok(())
    })();
    if result.is_err(){let _=fs::remove_dir_all(destination);}
    result
}

fn rewrite(value:&mut Value, paths:&HashMap<String,String>, strip_secrets:bool) {
    match value {
        Value::String(text)=>{if let Some(next)=paths.get(text){*text=next.clone();}},
        Value::Array(items)=>for item in items {rewrite(item,paths,strip_secrets)},
        Value::Object(items)=>for (key,item) in items {
            if strip_secrets && ["api_key","apiKey","authorization","access_token"].contains(&key.as_str()) {*item=json!("")} else {rewrite(item,paths,strip_secrets)}
        },
        _=>{},
    }
}
fn rewrite_database(c:&Connection,paths:&HashMap<String,String>,strip_secrets:bool)->Result<(),String> {
    for (old,new) in paths { c.execute("UPDATE media SET path=? WHERE path=?",params![new,old]).map_err(|e|e.to_string())?; }
    for (table,key,columns) in [
        ("settings","key",vec!["value"]),("scene_scripts","scene_id",vec!["value"]),
        ("scene_options","scene_id",vec!["value"]),("generations","id",vec!["request_json","result_json"]),
        ("background_jobs","id",vec!["request_json","result_json","resume_json"]),
    ] {
        for column in columns {
            let mut q=c.prepare(&format!("SELECT CAST({key} AS TEXT),{column} FROM {table} WHERE {column} IS NOT NULL")).map_err(|e|e.to_string())?;
            let rows=q.query_map([],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?))).map_err(|e|e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?;
            for (id,raw) in rows {
                if let Ok(mut value)=serde_json::from_str::<Value>(&raw) {
                    rewrite(&mut value,paths,strip_secrets);
                    c.execute(&format!("UPDATE {table} SET {column}=? WHERE {key}=?"),params![value.to_string(),id]).map_err(|e|e.to_string())?;
                }
            }
        }
    }
    Ok(())
}

pub fn export(c:&Connection,root:&Path,destination:&Path,name:&str,include_secrets:bool)->Result<Value,String> {
    catalog::no_running_jobs(c)?;
    if destination.exists(){return Err("备份目标已存在，请选择新的文件名称".into())}
    let parent=destination.parent().ok_or("备份目标无效")?.canonicalize().map_err(|e|e.to_string())?;
    if parent.starts_with(root.canonicalize().map_err(|e|e.to_string())?) {return Err("请选择项目目录之外的位置保存备份".into())}
    let staging=parent.join(format!(".spielberg-backup-{}",Uuid::new_v4()));
    fs::create_dir(&staging).map_err(|e|e.to_string())?;
    let result=(||{
        let database=staging.join("spielberg.sqlite");
        c.execute("VACUUM INTO ?",[database.to_string_lossy().as_ref()]).map_err(|e|e.to_string())?;
        let copy=Connection::open(&database).map_err(|e|e.to_string())?;
        let mut paths=HashMap::new();
        // Include unregistered files too, so a full project backup is lossless.
        for source in catalog::files_under(&root.join("assets"))? {
            let relative=source.strip_prefix(root).map_err(|e|e.to_string())?;
            let target=staging.join(relative);
            fs::create_dir_all(target.parent().unwrap()).map_err(|e|e.to_string())?;
            fs::copy(&source,target).map_err(|e|e.to_string())?;
            paths.insert(source.to_string_lossy().to_string(),relative.to_string_lossy().replace('\\',"/"));
        }
        let mut q=copy.prepare("SELECT id,path FROM media WHERE purged_at IS NULL").map_err(|e|e.to_string())?;
        let assets=q.query_map([],|r|Ok((r.get::<_,i64>(0)?,r.get::<_,String>(1)?))).map_err(|e|e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?;
        for (id,path) in assets {
            if paths.contains_key(&path){continue}
            let source=Path::new(&path);
            if !source.is_file(){return Err(format!("素材文件缺失，备份未完成：{path}"))}
            let ext=source.extension().and_then(|e|e.to_str()).unwrap_or("bin");
            let relative=format!("assets/imported/{}-{id}.{ext}",Uuid::new_v4());
            let target=staging.join(&relative);
            fs::create_dir_all(target.parent().unwrap()).map_err(|e|e.to_string())?;
            fs::copy(source,target).map_err(|e|e.to_string())?;
            paths.insert(path,relative);
        }
        rewrite_database(&copy,&paths,!include_secrets)?;
        // Remove free pages containing the previous absolute paths or omitted keys.
        copy.execute_batch("VACUUM").map_err(|e|e.to_string())?;
        drop(q);drop(copy);
        let manifest=json!({"format":"spielberg-project","version":1,"name":name,"created_at":now(),"includes_api_keys":include_secrets});
        fs::write(staging.join("manifest.json"),serde_json::to_vec_pretty(&manifest).unwrap()).map_err(|e|e.to_string())?;
        let temporary=parent.join(format!(".spielberg-backup-{}",Uuid::new_v4()));
        let packed=pack_directory(&staging,&temporary);
        if packed.is_err(){let _=fs::remove_file(&temporary);packed?;}
        if let Err(error)=fs::rename(&temporary,destination){let _=fs::remove_file(&temporary);return Err(error.to_string())}
        fs::remove_dir_all(&staging).map_err(|e|e.to_string())?;
        Ok(json!({"path":destination}))
    })();
    if result.is_err(){let _=fs::remove_dir_all(&staging);}
    result
}

fn restore_directory(source:&Path,destination:&Path)->Result<String,String> {
    let manifest:Value=serde_json::from_slice(&fs::read(source.join("manifest.json")).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
    if manifest["format"]!="spielberg-project" || manifest["version"]!=1 {return Err("不支持的 Spielberg 备份格式".into())}
    if destination.exists(){return Err("恢复目标已存在".into())}
    let source=source.canonicalize().map_err(|e|e.to_string())?;
    let database=source.join("spielberg.sqlite");
    if fs::symlink_metadata(&database).map_err(|e|e.to_string())?.file_type().is_symlink(){return Err("备份数据库不能是符号链接".into())}
    fs::create_dir_all(destination.join("assets")).map_err(|e|e.to_string())?;
    let result=(||{
        fs::copy(database,destination.join("spielberg.sqlite")).map_err(|e|e.to_string())?;
        let c=Connection::open(destination.join("spielberg.sqlite")).map_err(|e|e.to_string())?;
        let integrity:String=c.query_row("PRAGMA integrity_check",[],|r|r.get(0)).map_err(|e|e.to_string())?;
        if integrity!="ok"{return Err("备份数据库校验失败".into())}
        migrate(&c)?;
        let mut q=c.prepare("SELECT path FROM media WHERE purged_at IS NULL").map_err(|e|e.to_string())?;
        let media_paths=q.query_map([],|r|r.get::<_,String>(0)).map_err(|e|e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?;
        let mut paths=HashMap::new();
        for relative in media_paths {
            let path=Path::new(&relative);
            if path.is_absolute() || !path.starts_with("assets") || path.components().any(|part|!matches!(part,std::path::Component::Normal(_))) {return Err("备份包含无效素材路径".into())}
            let resolved=source.join(path).canonicalize().map_err(|_|format!("备份缺少素材：{relative}"))?;
            if !resolved.starts_with(&source) || !resolved.is_file(){return Err("备份素材超出备份目录".into())}
            paths.insert(relative.clone(),destination.join(path).to_string_lossy().to_string());
        }
        for file in catalog::files_under(&source.join("assets"))? {
            let relative=file.strip_prefix(&source).map_err(|e|e.to_string())?;
            let target=destination.join(relative);
            fs::create_dir_all(target.parent().unwrap()).map_err(|e|e.to_string())?;
            fs::copy(&file,target).map_err(|e|e.to_string())?;
        }
        for next in paths.values() {if !Path::new(next).is_file(){return Err("备份包含无法恢复的素材链接".into())}}
        rewrite_database(&c,&paths,false)?;
        c.execute("UPDATE background_jobs SET status='interrupted',resume_json=NULL,error='从备份恢复，请确认服务端任务状态后重新生成' WHERE status IN ('running','interrupted')",[]).map_err(|e|e.to_string())?;
        let invalid:bool=c.query_row("SELECT EXISTS(SELECT 1 FROM pragma_foreign_key_check)",[],|r|r.get(0)).map_err(|e|e.to_string())?;
        if invalid{return Err("备份中的素材引用校验失败".into())}
        Ok(manifest["name"].as_str().unwrap_or("恢复的项目").to_string())
    })();
    if result.is_err(){let _=fs::remove_dir_all(destination);}
    result
}

pub fn restore(source:&Path,destination:&Path)->Result<String,String>{
    if source.is_dir(){return restore_directory(source,destination)}
    let parent=destination.parent().ok_or("恢复目标无效")?;
    fs::create_dir_all(parent).map_err(|e|e.to_string())?;
    let unpacked=parent.join(format!(".spielberg-restore-{}",Uuid::new_v4()));
    unpack_archive(source,&unpacked)?;
    let result=restore_directory(&unpacked,destination);
    let _=fs::remove_dir_all(unpacked);
    result
}

pub fn command(s:&AppState,v:&Value,restore_backup:bool)->Result<Value,String> {
    if restore_backup {
        let id=Uuid::new_v4().to_string();
        let destination=s.root.join("projects").join(&id);
        let name=restore(Path::new(&strv(v,"path")?),&destination)?;
        let p=json!({"id":id,"name":format!("{name} · 恢复"),"path":destination,"updated_at":"刚刚"});
        s.allow_assets(&destination.join("assets"))?;
        let mut all=registry(s)?;all.push(p.clone());save_registry(s,&all)?;
        Ok(p)
    } else {
        let pid=project_id(v)?;
        let p=project(s,&pid)?;
        export(&db(s,&pid)?,Path::new(&strv(&p,"path")?),Path::new(&strv(v,"path")?),&strv(&p,"name")?,v["include_api_keys"].as_bool().unwrap_or(false))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn backup_roundtrip_preserves_files_relations_trash_and_remaps_history() {
        let base=std::env::temp_dir().join(Uuid::new_v4().to_string());let root=base.join("original");
        fs::create_dir_all(root.join("assets")).unwrap();
        let file=root.join("assets/portrait.png");fs::write(&file,b"image content").unwrap();
        fs::write(root.join("assets/unregistered.txt"),b"also backed up").unwrap();
        let c=Connection::open(root.join("spielberg.sqlite")).unwrap();migrate(&c).unwrap();
        c.execute("INSERT INTO media(id,name,path,kind,created_at) VALUES(1,'hero',?,'image','1'),(2,'trash',?,'image','1')",params![file.to_string_lossy(),file.to_string_lossy()]).unwrap();
        c.execute_batch("UPDATE media SET deleted_at='1' WHERE id=2;INSERT INTO roles(id,name,design_media_id,created_at) VALUES(1,'Hero',1,'1');").unwrap();
        c.execute("INSERT INTO settings VALUES('models',?)",[json!({"t2i":{"api_key":"secret-value","url":"http://model.local"}}).to_string()]).unwrap();
        c.execute("INSERT INTO background_jobs(operation,status,prompt,created_at,updated_at,result_json) VALUES('image','completed','','1','1',?)",[json!({"id":1,"path":file,"kind":"image"}).to_string()]).unwrap();
        let backup=base.join("portable.spielberg-backup");export(&c,&root,&backup,"Test",false).unwrap();
        let extracted=base.join("extracted");unpack_archive(&backup,&extracted).unwrap();
        let copy=Connection::open(extracted.join("spielberg.sqlite")).unwrap();
        let raw:String=copy.query_row("SELECT value FROM settings WHERE key='models'",[],|r|r.get(0)).unwrap();assert!(!raw.contains("secret-value"));
        assert_eq!(c.query_row("SELECT value FROM settings WHERE key='models'",[],|r|r.get::<_,String>(0)).unwrap().contains("secret-value"),true);
        assert!(!fs::read(extracted.join("spielberg.sqlite")).unwrap().windows(12).any(|bytes|bytes==b"secret-value"));
        let restored=base.join("restored");assert_eq!(restore(&backup,&restored).unwrap(),"Test");
        let restored_db=Connection::open(restored.join("spielberg.sqlite")).unwrap();
        assert_eq!(catalog::usages(&restored_db,1).unwrap().len(),1);
        assert_eq!(catalog::list(&restored_db,&json!({"usage":"trash"})).unwrap()["total"],1);
        let path:String=restored_db.query_row("SELECT path FROM media WHERE id=1",[],|r|r.get(0)).unwrap();assert!(Path::new(&path).starts_with(&restored));assert_eq!(fs::read(path).unwrap(),b"image content");
        let history:String=restored_db.query_row("SELECT result_json FROM background_jobs",[],|r|r.get(0)).unwrap();assert!(!history.contains(root.to_string_lossy().as_ref()));assert!(history.contains(restored.to_string_lossy().as_ref()));
        assert!(restored.join("assets/unregistered.txt").is_file());
        let full=base.join("private.spielberg-backup");export(&c,&root,&full,"Test",true).unwrap();
        let full_extracted=base.join("full-extracted");unpack_archive(&full,&full_extracted).unwrap();
        let full_db=Connection::open(full_extracted.join("spielberg.sqlite")).unwrap();assert!(full_db.query_row("SELECT value FROM settings WHERE key='models'",[],|r|r.get::<_,String>(0)).unwrap().contains("secret-value"));
        drop(full_db);drop(copy);drop(c);drop(restored_db);fs::remove_dir_all(base).unwrap();
    }
    #[test]
    fn missing_assets_or_unsafe_restore_paths_fail_without_partial_project() {
        let base=std::env::temp_dir().join(Uuid::new_v4().to_string());let root=base.join("original");fs::create_dir_all(root.join("assets")).unwrap();
        let c=Connection::open(root.join("spielberg.sqlite")).unwrap();migrate(&c).unwrap();
        c.execute("INSERT INTO media(name,path,kind,created_at) VALUES('missing','/does-not-exist','image','1')",[]).unwrap();
        let backup=base.join("backup.spielberg-backup");assert!(export(&c,&root,&backup,"Test",false).is_err());assert!(!backup.exists());
        c.execute("DELETE FROM media",[]).unwrap();export(&c,&root,&backup,"Test",false).unwrap();
        let extracted=base.join("extracted");unpack_archive(&backup,&extracted).unwrap();
        let tampered=Connection::open(extracted.join("spielberg.sqlite")).unwrap();tampered.execute("INSERT INTO media(name,path,kind,created_at) VALUES('bad','assets/../../outside','image','1')",[]).unwrap();drop(tampered);
        let target=base.join("restore");assert!(restore(&extracted,&target).is_err());assert!(!target.exists());
        drop(c);fs::remove_dir_all(base).unwrap();
    }
}
