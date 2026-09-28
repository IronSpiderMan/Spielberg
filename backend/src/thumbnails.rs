use super::*;
use std::hash::{Hash, Hasher};
static GENERATION:Mutex<()>=Mutex::new(());

pub fn get(s:&AppState,v:&Value)->Result<Value,String> {
    let pid=project_id(v)?;
    let c=db(s,&pid)?;
    let source:String=c.query_row("SELECT path FROM media WHERE id=? AND purged_at IS NULL",[intv(v,"id")?],|r|r.get(0)).map_err(|e|e.to_string())?;
    let path=Path::new(&source);
    let root=PathBuf::from(strv(&project(s,&pid)?,"path")?);
    let dir=root.join(".cache/thumbnails");
    let cache=root.join(".cache");
    if cache.exists() && !cache.canonicalize().map_err(|e|e.to_string())?.starts_with(root.canonicalize().map_err(|e|e.to_string())?){return Err("缓存目录不能指向项目之外".into())}
    fs::create_dir_all(&dir).map_err(|e|e.to_string())?;
    if !dir.canonicalize().map_err(|e|e.to_string())?.starts_with(root.canonicalize().map_err(|e|e.to_string())?){return Err("缓存目录不能指向项目之外".into())}
    Ok(json!({"path":cached(path,&dir)?}))
}

fn cached(path:&Path,dir:&Path)->Result<PathBuf,String> {
    let metadata=fs::metadata(path).map_err(|e|e.to_string())?;
    let mut hash=std::collections::hash_map::DefaultHasher::new();
    path.hash(&mut hash);metadata.len().hash(&mut hash);metadata.modified().ok().hash(&mut hash);
    let output=dir.join(format!("{:x}.jpg",hash.finish()));
    let _lock=GENERATION.lock().map_err(|_|"缩略图缓存不可用")?;
    if !output.is_file() {
        let temporary=dir.join(format!("{}.jpg",Uuid::new_v4()));
        let binary=if Path::new("/opt/homebrew/bin/ffmpeg").exists(){"/opt/homebrew/bin/ffmpeg"}else{"ffmpeg"};
        let result=std::process::Command::new(binary).args(["-nostdin","-v","error","-i"]).arg(path).args(["-vf","scale=480:320:force_original_aspect_ratio=decrease","-frames:v","1","-threads","1","-q:v","4"]).arg(&temporary).output().map_err(|e|format!("缩略图需要 FFmpeg：{e}"))?;
        if !result.status.success(){let _=fs::remove_file(temporary);return Err("无法生成缩略图".into())}
        fs::rename(temporary,&output).map_err(|e|e.to_string())?;
    }
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn creates_reusable_thumbnails_and_invalidates_changed_sources() {
        let root=std::env::temp_dir().join(Uuid::new_v4().to_string());
        fs::create_dir_all(&root).unwrap();
        let source=root.join("source.png");
        fs::copy(Path::new(env!("CARGO_MANIFEST_DIR")).join("../public/spielberg-logo-s.png"),&source).unwrap();
        let first=cached(&source,&root).unwrap();
        assert!(first.is_file());
        let modified=fs::metadata(&first).unwrap().modified().unwrap();
        assert_eq!(cached(&source,&root).unwrap(),first);
        assert_eq!(fs::metadata(&first).unwrap().modified().unwrap(),modified);
        // Change source bytes (PNG permits trailing bytes) to exercise cache invalidation.
        let mut content=fs::read(&source).unwrap();content.push(0);fs::write(&source,content).unwrap();
        assert_ne!(cached(&source,&root).unwrap(),first);
        fs::remove_dir_all(root).unwrap();
    }
}
