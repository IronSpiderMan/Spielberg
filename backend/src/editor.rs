use super::*;
use std::process::Command;
fn binary(name: &str) -> String {
    let local = format!("/opt/homebrew/bin/{name}");
    if Path::new(&local).exists() { local } else { name.into() }
}
fn run(cmd: &mut Command) -> Result<std::process::Output, String> {
    let output = cmd.output().map_err(|e| format!("无法运行 FFmpeg/FFprobe，请确认已安装：{e}"))?;
    if !output.status.success() { return Err(format!("媒体处理失败：{}", String::from_utf8_lossy(&output.stderr).chars().take(1500).collect::<String>())); }
    Ok(output)
}
fn probe(path: &str) -> Result<Value, String> {
    let out = run(crate::background_command(binary("ffprobe")).args(["-v","error","-show_format","-show_streams","-of","json",path]))?;
    let v: Value = serde_json::from_slice(&out.stdout).map_err(|e| e.to_string())?;
    let duration = v["format"]["duration"].as_str().and_then(|s| s.parse::<f64>().ok()).filter(|n| n.is_finite() && *n > 0.0).ok_or("无法读取媒体时长")?;
    let streams = v["streams"].as_array().ok_or("媒体没有可用轨道")?;
    Ok(json!({"duration":duration,"video":streams.iter().any(|s|s["codec_type"]=="video"),"audio":streams.iter().any(|s|s["codec_type"]=="audio")}))
}
fn bounds(v: &Value, duration: f64) -> Result<(f64,f64,f64,f64),String> {
    let n = |key: &str| v[key].as_f64().filter(|n|n.is_finite()).ok_or_else(||format!("无效参数：{key}"));
    let (start,end,speed,volume)=(n("start")?,n("end")?,n("speed")?,n("volume")?);
    if start<0.0 || end>duration+0.05 || end-start<0.05 || !(0.5..=2.0).contains(&speed) || !(0.0..=1.0).contains(&volume) {return Err("裁剪范围、速度或音量超出允许范围".into());}
    Ok((start,end,speed,volume))
}
pub(super) fn projects(s: &AppState, v: &Value, save: bool) -> Result<Value,String> {
    let pid=project_id(v)?; let mut c=db(s,&pid)?;
    if save {
        let id=strv(v,"id")?; Uuid::parse_str(&id).map_err(|_|"剪辑项目 ID 无效")?;
        let name=strv(v,"name")?.trim().chars().take(100).collect::<String>();
        if name.is_empty(){return Err("请输入剪辑项目名称".into());}
        let mut draft=v["draft"].clone();
        let clips=draft["clips"].as_array_mut().ok_or("缺少剪辑草稿")?;
        if clips.len()>100{return Err("最多支持 100 个片段".into());}
        let mut sources=std::collections::HashSet::new();
        for clip in clips {
            let mid=intv(clip,"media_id")?;
            let m=media(&c,Some(mid)).ok_or("剪辑素材不存在")?;
            if m["kind"]!="video" && m["kind"]!="audio" {return Err("只能引用音视频素材".into());}
            bounds(clip,clip["duration"].as_f64().filter(|n|n.is_finite()&&*n>0.0).ok_or("时长无效")?)?;
            if clip["track"]=="audio" && !clip["at"].as_f64().is_some_and(|n|n.is_finite()&&n>=0.0){return Err("音轨位置无效".into());}
            if let Some(object)=clip.as_object_mut(){object.remove("path");object.remove("name");}
            sources.insert(mid);
        }
        let tx=c.transaction().map_err(|e|e.to_string())?;
        let stamp=now();
        tx.execute("INSERT INTO edit_projects(id,name,draft,status,created_at,updated_at) VALUES(?,?,?,'draft',?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,draft=excluded.draft,status=CASE WHEN edit_projects.draft=excluded.draft AND edit_projects.name=excluded.name THEN edit_projects.status ELSE 'draft' END,updated_at=excluded.updated_at",params![id,name,draft.to_string(),stamp,stamp]).map_err(|e|e.to_string())?;
        tx.execute("DELETE FROM edit_sources WHERE edit_id=?",[&id]).map_err(|e|e.to_string())?;
        for mid in sources {tx.execute("INSERT INTO edit_sources VALUES(?,?)",params![id,mid]).map_err(|e|e.to_string())?;}
        tx.commit().map_err(|e|e.to_string())?;
    }
    let mut q=c.prepare("SELECT id,name,draft,status,created_at,updated_at FROM edit_projects ORDER BY CAST(updated_at AS INTEGER) DESC,id").map_err(|e|e.to_string())?;
    let items=q.query_map([],|r|Ok(json!({"id":r.get::<_,String>(0)?,"name":r.get::<_,String>(1)?,"draft":serde_json::from_str::<Value>(&r.get::<_,String>(2)?).unwrap_or(json!({})),"status":r.get::<_,String>(3)?,"created_at":r.get::<_,String>(4)?,"updated_at":r.get::<_,String>(5)?}))).map_err(|e|e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?;
    let mut result=Vec::new();
    for mut item in items {
        let mut outputs=c.prepare("SELECT media_id FROM edit_outputs WHERE edit_id=? ORDER BY CAST(created_at AS INTEGER) DESC,media_id DESC").map_err(|e|e.to_string())?;
        let ids=outputs.query_map([item["id"].as_str().unwrap()],|r|r.get::<_,i64>(0)).map_err(|e|e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?;
        item["outputs"]=json!(ids.into_iter().filter_map(|id|media(&c,Some(id))).collect::<Vec<_>>());result.push(item);
    }
    Ok(json!(result))
}
pub(super) fn command(s: &AppState, v: &Value, export: bool) -> Result<Value,String> {
    let pid=project_id(v)?; let c=db(s,&pid)?;
    if !export {let item=media(&c,Some(intv(v,"media_id")?)).ok_or("素材不存在")?;return probe(item["path"].as_str().ok_or("素材路径无效")?);}
    if let Some(id)=v["edit_id"].as_str(){c.query_row("SELECT id FROM edit_projects WHERE id=?",[id],|r|r.get::<_,String>(0)).optional().map_err(|e|e.to_string())?.ok_or("剪辑项目不存在")?;}
    let clips=v["clips"].as_array().ok_or("缺少主轨道片段")?;
    let empty=vec![];
    let audios=match v.get("audio_clips") {None=>&empty,Some(value)=>value.as_array().ok_or("音轨参数必须是数组")?};
    if clips.len()+audios.len()==0||clips.len()+audios.len()>100{return Err("请添加 1 至 100 个片段".into());}
    let audio=match v["format"].as_str(){Some("mp3")=>true,Some("mp4")=>false,_=>return Err("不支持的导出格式".into())};
    let (width,height)=match v["ratio"].as_str(){Some("9:16")=>(720,1280),Some("1:1")=>(720,720),_=>(1280,720)};
    let mut canonical=v.clone();
    for key in ["clips","audio_clips"] {if let Some(clips)=canonical[key].as_array_mut(){for clip in clips {if let Some(object)=clip.as_object_mut(){object.retain(|key,_|["media_id","start","end","speed","volume","at"].contains(&key.as_str()));}}}}
    let request=canonical.to_string();
    if let Some(id)=v["edit_id"].as_str(){
        let existing:Option<i64>=c.query_row("SELECT media_id FROM edit_outputs WHERE edit_id=? AND request=? ORDER BY media_id DESC LIMIT 1",params![id,request],|r|r.get(0)).optional().map_err(|e|e.to_string())?;
        if let Some(item)=existing.and_then(|mid|media(&c,Some(mid))).filter(|m|m["path"].as_str().is_some_and(|path|Path::new(path).is_file())) {
            c.execute("UPDATE edit_projects SET status='exported' WHERE id=?",[id]).map_err(|e|e.to_string())?;return Ok(item);
        }
        c.execute("UPDATE edit_projects SET status='rendering' WHERE id=?",[id]).map_err(|e|e.to_string())?;
    }
    let root=PathBuf::from(strv(&project(s,&pid)?,"path")?);
    let work=root.join(format!(".editor-{}",Uuid::new_v4()));fs::create_dir_all(&work).map_err(|e|e.to_string())?;
    let result=(|| {
        // Render detached tracks separately; all offsets use output-timeline seconds.
        let mut audio_end:f64=0.0;
        let mut audio_offsets=Vec::new();
        for (i,clip) in audios.iter().enumerate() {
            let item=media(&c,Some(intv(clip,"media_id")?)).ok_or("音轨素材已被删除")?;
            let path=item["path"].as_str().ok_or("音轨路径无效")?;
            let info=probe(path)?;if info["audio"]!=true{return Err("该素材没有可分离的音轨".into());}
            let (start,end,speed,volume)=bounds(clip,info["duration"].as_f64().unwrap())?;
            let at=clip["at"].as_f64().filter(|x|x.is_finite()&&*x>=0.0).ok_or("音轨位置无效")?;
            let duration=(end-start)/speed;
            if at+duration>7200.0{return Err("音轨超出两小时限制".into());}
            audio_end=audio_end.max(at+duration);audio_offsets.push(at);
            let filter=format!("asetpts=PTS-STARTPTS,atempo={speed},volume={volume},aresample=48000,aformat=channel_layouts=stereo,apad,atrim=duration={duration}");
            run(crate::background_command(binary("ffmpeg")).args(["-v","error","-nostdin","-y","-ss",&start.to_string(),"-t",&(end-start).to_string(),"-i",path,"-vn","-af",&filter,"-c:a","pcm_s16le"]).arg(work.join(format!("audio-{i}.wav"))))?;
        }
        let mut total=0.0;
        for (i,clip) in clips.iter().enumerate() {
            let item=media(&c,Some(intv(clip,"media_id")?)).ok_or("时间线素材已被删除")?;
            if item["kind"]!="video" && item["kind"]!="audio" {return Err("只能剪辑音视频素材".into());}
            let path=item["path"].as_str().ok_or("素材路径无效")?;let info=probe(path)?;
            let (start,end,speed,volume)=bounds(clip,info["duration"].as_f64().unwrap())?;
            let duration=(end-start)/speed;total+=duration;if total>7200.0{return Err("简易剪辑单次导出最多支持两小时".into());}
            let mut cmd=crate::background_command(binary("ffmpeg"));cmd.args(["-v","error","-nostdin","-y","-ss",&start.to_string(),"-t",&(end-start).to_string(),"-i",path]);
            let has_audio=info["audio"]==true;let has_video=info["video"]==true;
            if !has_audio {cmd.args(["-f","lavfi","-i","anullsrc=r=48000:cl=stereo"]);}
            if !audio && !has_video {cmd.args(["-f","lavfi","-i",&format!("color=c=black:s={width}x{height}:r=30")]);}
            let ai=if has_audio {0}else{1};
            let af=format!("[{ai}:a:0]asetpts=PTS-STARTPTS,atempo={speed},volume={volume},aresample=48000,aformat=channel_layouts=stereo,apad,atrim=duration={duration}[a]");
            let filter=if audio {af}else{let vi=if has_video{0}else if has_audio{1}else{2};format!("{af};[{vi}:v:0]setpts=(PTS-STARTPTS)/{speed},scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p[v]")};
            cmd.args(["-filter_complex",&filter,"-map","[a]"]);
            if !audio {cmd.args(["-map","[v]","-c:v","libx264","-preset","veryfast","-crf","20"]);}
            cmd.args(["-c:a",if audio{"pcm_s16le"}else{"aac"},"-t",&duration.to_string()]);
            cmd.arg(work.join(format!("{i}.{}",if audio{"wav"}else{"mp4"})));run(&mut cmd)?;
        }
        let ext=if audio{"mp3"}else{"mp4"};
        let list=(0..clips.len()).map(|i|format!("file '{i}.{}'\n",if audio{"wav"}else{"mp4"})).collect::<String>();
        fs::write(work.join("list.txt"),list).map_err(|e|e.to_string())?;
        let dir=root.join(if audio{"assets/audio"}else{"assets/videos"});fs::create_dir_all(&dir).map_err(|e|e.to_string())?;
        let out=dir.join(format!("edit-{}.{}",Uuid::new_v4(),ext));
        let mut cmd=crate::background_command(binary("ffmpeg"));cmd.args(["-v","error","-nostdin","-y"]);
        let final_duration=total.max(audio_end);
        if clips.is_empty() {
            cmd.args(["-f","lavfi","-i","anullsrc=r=48000:cl=stereo"]);
            if !audio {cmd.args(["-f","lavfi","-i",&format!("color=c=black:s={width}x{height}:r=30")]);}
        } else {cmd.args(["-f","concat","-safe","1","-i"]).arg(work.join("list.txt"));}
        if audios.is_empty() {
            if audio{cmd.args(["-c:a","libmp3lame","-b:a","192k"]);}else{cmd.args(["-c","copy","-movflags","+faststart"]);}
        } else {
            let first_audio_input=if clips.is_empty()&&!audio{2}else{1};
            let mut filters=vec![format!("[0:a:0]apad,atrim=duration={final_duration}[base]")];
            let mut inputs=String::from("[base]");
            for (i,at) in audio_offsets.iter().enumerate() {
                cmd.arg("-i").arg(work.join(format!("audio-{i}.wav")));
                let delay=(at*48000.0).round() as u64;
                filters.push(format!("[{}:a:0]adelay={delay}S:all=1[a{i}]",first_audio_input+i));
                inputs.push_str(&format!("[a{i}]"));
            }
            filters.push(format!("{inputs}amix=inputs={}:duration=longest:normalize=0,atrim=duration={final_duration}[mixed]",audios.len()+1));
            if !audio {
                let vi=if clips.is_empty(){1}else{0};
                filters.push(format!("[{vi}:v:0]tpad=stop_mode=add:stop_duration={},trim=duration={final_duration}[picture]",(final_duration-total).max(0.0)));
            }
            cmd.args(["-filter_complex",&filters.join(";"),"-map","[mixed]","-c:a",if audio{"libmp3lame"}else{"aac"},"-b:a","192k"]);
            if !audio{cmd.args(["-map","[picture]","-c:v","libx264","-preset","veryfast","-crf","20","-pix_fmt","yuv420p","-movflags","+faststart"]);}
            cmd.args(["-t",&final_duration.to_string()]);
        }
        cmd.arg(&out);
        if let Err(e)=run(&mut cmd){let _=fs::remove_file(&out);return Err(e);}
        let name=format!("{}.{}",v["name"].as_str().filter(|s|!s.trim().is_empty()).unwrap_or("剪辑作品").chars().take(100).collect::<String>(),ext);
        if let Err(e)=c.execute("INSERT INTO media(name,path,kind,created_at) VALUES(?,?,?,?)",params![name,out.to_string_lossy(),if audio{"audio"}else{"video"},now()]) {let _=fs::remove_file(&out);return Err(e.to_string());}
        let mid=c.last_insert_rowid();
        if let Some(id)=v["edit_id"].as_str(){
            c.execute("INSERT INTO edit_outputs(edit_id,media_id,created_at,request) VALUES(?,?,?,?)",params![id,mid,now(),request]).map_err(|e|e.to_string())?;
            c.execute("UPDATE edit_projects SET status='exported',updated_at=? WHERE id=?",params![now(),id]).map_err(|e|e.to_string())?;
        }
        Ok(media(&c,Some(mid)).unwrap())
    })();
    let _=fs::remove_dir_all(&work);
    if result.is_err(){if let Some(id)=v["edit_id"].as_str(){let _=c.execute("UPDATE edit_projects SET status='failed' WHERE id=?",[id]);}}
    result
}
#[cfg(test)] mod tests {
    use super::*;
    #[test] fn exports_mixed_media() {
        let root=std::env::temp_dir().join(format!("editor-test-{}",Uuid::new_v4()));fs::create_dir_all(&root).unwrap();
        let s=AppState{root:root.clone(),guard:std::sync::Arc::new(Mutex::new(()))};
        let result=(|| -> Result<(),String> {
            let p=create_project(&s,&json!({"name":"Editor test"}))?;let pid=p["id"].as_str().unwrap();
            let video=root.join("silent.mp4");let audio=root.join("tone.wav");
            run(crate::background_command(binary("ffmpeg")).args(["-v","error","-f","lavfi","-i","color=c=red:s=160x120:r=30","-t","1","-c:v","libx264"]).arg(&video))?;
            run(crate::background_command(binary("ffmpeg")).args(["-v","error","-f","lavfi","-i","sine=frequency=440","-t","1"]).arg(&audio))?;
            let a=import_media(&s,&json!({"project_id":pid,"source_path":video}))?;let b=import_media(&s,&json!({"project_id":pid,"source_path":audio}))?;
            let clips=json!([{"media_id":a["id"],"duration":1,"start":0.2,"end":0.8,"speed":2,"volume":0},{"media_id":b["id"],"duration":1,"start":0,"end":0.6,"speed":0.5,"volume":0.5}]);
            for format in ["mp4","mp3"] {
                let out=command(&s,&json!({"project_id":pid,"clips":clips,"format":format,"ratio":"9:16"}),true)?;
                let info=probe(out["path"].as_str().unwrap())?;
                assert!((info["duration"].as_f64().unwrap()-1.5).abs()<0.15,"{info}");assert_eq!(info["audio"],true);assert_eq!(info["video"],format=="mp4");
            }
            let edit_id=Uuid::new_v4().to_string();
            let saved=projects(&s,&json!({"project_id":pid,"id":edit_id,"name":"First cut","draft":{"clips":clips,"format":"mp4","ratio":"9:16"}}),true)?;
            assert_eq!(saved[0]["draft"]["clips"][0]["media_id"],a["id"]);
            let c=db(&s,pid)?;
            assert!(catalog::trash(&c,a["id"].as_i64().unwrap()).is_err(),"Referenced footage must be protected");
            let request=json!({"project_id":pid,"edit_id":edit_id,"clips":clips,"format":"mp4","ratio":"9:16","name":"First cut"});
            let first=command(&s,&request,true)?;
            let second=command(&s,&request,true)?;
            assert_eq!(first["id"],second["id"],"Unchanged exports must reuse the output file");
            let restored=projects(&s,&json!({"project_id":pid}),false)?;
            assert_eq!(restored[0]["status"],"exported");assert_eq!(restored[0]["outputs"].as_array().unwrap().len(),1);
            projects(&s,&json!({"project_id":pid,"id":Uuid::new_v4().to_string(),"name":"Second cut","draft":{"clips":[]}}),true)?;
            assert_eq!(projects(&s,&json!({"project_id":pid}),false)?.as_array().unwrap().len(),2);
            let invalid=json!({"project_id":pid,"clips":[{"media_id":a["id"],"start":0,"end":20,"speed":1,"volume":1}],"format":"mp4"});
            assert!(command(&s,&invalid,true).is_err());
            assert!(!fs::read_dir(p["path"].as_str().unwrap()).unwrap().any(|e|e.unwrap().file_name().to_string_lossy().starts_with(".editor-")));
            Ok(())
        })();let _=fs::remove_dir_all(&root);result.unwrap();
    }
    #[test] fn detached_tracks_mix_at_timeline_offsets() {
        let root=std::env::temp_dir().join(format!("editor-audio-test-{}",Uuid::new_v4()));fs::create_dir_all(&root).unwrap();
        let s=AppState{root:root.clone(),guard:std::sync::Arc::new(Mutex::new(()))};
        let result=(|| -> Result<(),String> {
            let p=create_project(&s,&json!({"name":"Audio test"}))?;let pid=p["id"].as_str().unwrap();
            let source=root.join("tone.mp4");
            run(crate::background_command(binary("ffmpeg")).args(["-v","error","-f","lavfi","-i","color=c=red:s=160x120:r=30","-f","lavfi","-i","sine=frequency=440:sample_rate=48000","-t","1","-c:v","libx264","-c:a","aac"]).arg(&source))?;
            let m=import_media(&s,&json!({"project_id":pid,"source_path":source}))?;
            let base=json!([{"media_id":m["id"],"start":0,"end":1,"speed":1,"volume":0}]);
            let tracks=json!([{"media_id":m["id"],"start":0.1,"end":0.7,"speed":2,"volume":0.5,"at":1.2}]);
            for format in ["mp4","mp3"] {
                for main in [base.clone(),json!([])] {
                    let out=command(&s,&json!({"project_id":pid,"clips":main,"audio_clips":tracks,"format":format}),true)?;
                    let path=out["path"].as_str().unwrap();let info=probe(path)?;
                    assert!((info["duration"].as_f64().unwrap()-1.5).abs()<0.15,"{info}");
                    let pcm=run(crate::background_command(binary("ffmpeg")).args(["-v","error","-i",path,"-vn","-ac","1","-ar","48000","-f","f32le","pipe:1"]))?;
                    let samples:Vec<f32>=pcm.stdout.chunks_exact(4).map(|x|f32::from_le_bytes(x.try_into().unwrap())).collect();
                    let rms=|from:usize,to:usize| (samples[from..to].iter().map(|x|x*x).sum::<f32>()/(to-from) as f32).sqrt();
                    assert!(rms(4800,48000)<0.001,"Original video must be muted");
                    assert!(rms(62400,67200)>0.01,"Detached track must play at its delayed position");
                }
            }
            let mut invalid=tracks.clone();invalid[0]["at"]=json!(-1);
            assert!(command(&s,&json!({"project_id":pid,"clips":base,"audio_clips":invalid,"format":"mp4"}),true).is_err());
            Ok(())
        })();let _=fs::remove_dir_all(root);result.unwrap();
    }
    #[test] fn upgrades_existing_version_six_projects() {
        let c=Connection::open_in_memory().unwrap();migrate(&c).unwrap();
        c.execute_batch("INSERT INTO media VALUES(1,'original.mp4','/original.mp4','video','1',NULL,NULL);
            INSERT INTO prompts(name,content,created_at,updated_at) VALUES('原有提示词','保留内容','1','1');
            DROP VIEW asset_usage; DROP TABLE edit_outputs; DROP TABLE edit_sources; DROP TABLE edit_projects;
            CREATE VIEW asset_usage AS SELECT id AS media_id,'role' AS kind,id AS target_id,name AS title,NULL AS episode_id,NULL AS episode_title,'旧用途' AS purpose FROM roles;
            DROP TABLE scene_canvas_sources; DROP TABLE scene_canvases; ALTER TABLE scenes DROP COLUMN prompt; ALTER TABLE scenes DROP COLUMN creation_mode;
            PRAGMA user_version=6;").unwrap();
        migrate(&c).unwrap();migrate(&c).unwrap();
        assert_eq!(c.query_row("PRAGMA user_version",[],|r|r.get::<_,i64>(0)).unwrap(),14);
        assert_eq!(c.query_row("SELECT content FROM prompts",[],|r|r.get::<_,String>(0)).unwrap(),"保留内容");
        c.execute("INSERT INTO edit_projects VALUES('cut','剪辑','{}','draft','1','1')",[]).unwrap();
        c.execute("INSERT INTO edit_sources VALUES('cut',1)",[]).unwrap();
        assert!(catalog::usages(&c,1).unwrap().iter().any(|u|u["purpose"]=="剪辑素材"));
        assert!(catalog::trash(&c,1).is_err());
        c.execute("INSERT INTO edit_outputs(edit_id,media_id,created_at,request) VALUES('cut',1,'1','request')",[]).unwrap();
        migrate(&c).unwrap();
        assert_eq!(c.query_row("SELECT COUNT(*) FROM edit_projects",[],|r|r.get::<_,i64>(0)).unwrap(),1);
    }
    #[test] fn validates_trim_parameters(){
        let valid=json!({"start":0,"end":5,"speed":1,"volume":1});assert!(bounds(&valid,5.0).is_ok());
        for (key,value) in [("start",-1.0),("end",6.0),("speed",0.0),("volume",2.0)] {let mut v=valid.clone();v[key]=json!(value);assert!(bounds(&v,5.0).is_err());}
    }
}
