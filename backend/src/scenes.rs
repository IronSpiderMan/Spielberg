use super::*;
use std::collections::{HashMap, HashSet};

const SQL: &str = "
CREATE TABLE scenes(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    episode_id INTEGER NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    shared_prompt TEXT NOT NULL DEFAULT '',
    reference_media_ids TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(reference_media_ids)),
    reference_audio_media_ids TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(reference_audio_media_ids)),
    generation_mode TEXT NOT NULL DEFAULT 'clips' CHECK(generation_mode IN ('clips','one_take')),
    generation_options TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(generation_options)),
    video_media_id INTEGER REFERENCES media(id),
    created_at TEXT NOT NULL
);
CREATE TABLE scene_videos(
    scene_id INTEGER NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
    media_id INTEGER NOT NULL REFERENCES media(id),
    PRIMARY KEY(scene_id,media_id)
);
ALTER TABLE clips ADD COLUMN scene_id INTEGER REFERENCES scenes(id) ON DELETE CASCADE;
INSERT INTO scenes(id,episode_id,title,created_at) SELECT id,episode_id,title,created_at FROM clips;
UPDATE clips SET scene_id=id;
CREATE INDEX clips_episode_order ON clips(episode_id,sort_order,id);
CREATE INDEX clips_scene_order ON clips(scene_id,sort_order,id);
CREATE INDEX scenes_episode ON scenes(episode_id);
CREATE TABLE clip_sequence(id INTEGER NOT NULL);
INSERT INTO clip_sequence SELECT COALESCE(MAX(id),0) FROM clips;
CREATE TRIGGER clip_sequence_insert AFTER INSERT ON clips WHEN NEW.id > (SELECT id FROM clip_sequence)
BEGIN UPDATE clip_sequence SET id=NEW.id; END;
CREATE TRIGGER clip_requires_scene_insert BEFORE INSERT ON clips
WHEN NOT EXISTS(SELECT 1 FROM scenes WHERE id=NEW.scene_id AND episode_id=NEW.episode_id)
BEGIN SELECT RAISE(ABORT,'片段必须属于同一剧集的场景'); END;
CREATE TRIGGER clip_requires_scene_update BEFORE UPDATE OF scene_id,episode_id ON clips
WHEN NOT EXISTS(SELECT 1 FROM scenes WHERE id=NEW.scene_id AND episode_id=NEW.episode_id)
BEGIN SELECT RAISE(ABORT,'片段必须属于同一剧集的场景'); END;
CREATE TRIGGER remove_empty_scene AFTER DELETE ON clips
WHEN NOT EXISTS(SELECT 1 FROM clips WHERE scene_id=OLD.scene_id)
BEGIN DELETE FROM scenes WHERE id=OLD.scene_id; END;
";

pub(super) fn migrate(c: &Connection) -> Result<(), String> {
    c.execute_batch("BEGIN IMMEDIATE").map_err(|e| e.to_string())?;
    let result = (|| {
        let version: i64 = c.query_row("PRAGMA user_version", [], |r| r.get(0)).map_err(|e| e.to_string())?;
        if version < 17 {
            c.execute_batch("DROP VIEW IF EXISTS asset_usage;").map_err(|e| e.to_string())?;
            for table in ["scenes", "scene_videos", "scene_options", "scene_scripts"] {
                for event in ["INSERT", "UPDATE", "DELETE"] {
                    c.execute_batch(&format!("DROP TRIGGER IF EXISTS revision_{table}_{event};")).map_err(|e| e.to_string())?;
                }
            }
            for (table, fields) in [("scenes", &["first_media_id", "last_media_id", "reference_media_id", "video_media_id"][..]), ("scene_videos", &["media_id"][..])] {
                for field in fields {
                    for event in ["INSERT", "UPDATE"] {
                        c.execute_batch(&format!("DROP TRIGGER IF EXISTS active_{table}_{field}_{event};")).map_err(|e| e.to_string())?;
                    }
                }
            }
            c.execute_batch("ALTER TABLE scenes RENAME TO clips;").map_err(|e| e.to_string())?;
            for suffix in ["videos", "scripts", "options", "canvases", "canvas_sources"] {
                c.execute_batch(&format!("ALTER TABLE scene_{suffix} RENAME TO clip_{suffix}; ALTER TABLE clip_{suffix} RENAME COLUMN scene_id TO clip_id;"))
                    .map_err(|e| e.to_string())?;
            }
            c.execute_batch(SQL).map_err(|e| e.to_string())?;
            catalog::install(c)?;
            migrate_payloads(c)?;
            c.execute_batch("UPDATE revisions SET version=version+1 WHERE section IN ('episodes','jobs'); PRAGMA user_version=17;")
                .map_err(|e| e.to_string())?;
        }
        c.execute_batch("COMMIT").map_err(|e| e.to_string())
    })();
    if result.is_err() { let _ = c.execute_batch("ROLLBACK"); }
    result
}

fn migrate_payloads(c: &Connection) -> Result<(), String> {
    // Move structured identifiers only. User-written text and old @ aliases stay readable.
    fn rename(value: &mut Value, from: &str, to: &str) {
        if let Some(object) = value.as_object_mut() {
            if let Some(value) = object.remove(from) { object.entry(to).or_insert(value); }
        }
    }
    fn draft(value: &mut Value) {
        rename(value, "scenes", "clips");
        if let Some(clips) = value.get_mut("clips").and_then(Value::as_array_mut) {
            for clip in clips { rename(clip, "scene_id", "clip_id"); }
        }
    }
    fn rewrite(c: &Connection, table: &str, key: &str, column: &str, filter: &str, change: impl Fn(&mut Value)) -> Result<(), String> {
        let mut query = c.prepare(&format!("SELECT CAST({key} AS TEXT),{column} FROM {table} WHERE {column} IS NOT NULL AND ({filter})"))
            .map_err(|e| e.to_string())?;
        let rows = query.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))).map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
        for (id, raw) in rows {
            if let Ok(mut value) = serde_json::from_str::<Value>(&raw) {
                let old = value.clone();
                change(&mut value);
                if value != old {
                    c.execute(&format!("UPDATE {table} SET {column}=? WHERE {key}=?"), params![value.to_string(), id]).map_err(|e| e.to_string())?;
                }
            }
        }
        Ok(())
    }
    rewrite(c, "episodes", "id", "storyboard", "storyboard != 'null'", draft)?;
    rewrite(c, "settings", "key", "value", "key='script_draft' OR key GLOB 'script_draft_episode_*'", draft)?;
    rewrite(c, "settings", "key", "value", "key='script_publication'", |value| {
        if let Some(d) = value.get_mut("draft") { draft(d); }
    })?;
    rewrite(c, "clip_canvases", "clip_id", "draft", "1", canvas::normalize_asset_nodes)?;
    for table in ["background_jobs", "generations"] {
        rewrite(c, table, "id", "request_json", "1", |value| rename(value, "scene_id", "clip_id"))?;
    }
    rewrite(c, "background_jobs", "id", "resume_json", "1", |value| {
        if let Some(payload) = value.get_mut("payload") { rename(payload, "scene_id", "clip_id"); }
    })?;
    Ok(())
}

pub(super) fn next_clip_id(c: &Connection) -> Result<i64, String> {
    c.query_row("UPDATE clip_sequence SET id=id+1 RETURNING id", [], |row| row.get(0)).map_err(|e| e.to_string())
}

pub(super) fn insert_parent(c: &Connection, ep: i64, title: &str) -> Result<i64, String> {
    if !c.query_row("SELECT EXISTS(SELECT 1 FROM episodes WHERE id=?)", [ep], |row| row.get::<_,bool>(0)).map_err(|e| e.to_string())? {
        return Err("剧集不存在".into());
    }
    c.execute("INSERT INTO scenes(episode_id,title,created_at) VALUES(?,?,?)", params![ep,title,now()]).map_err(|e| e.to_string())?;
    Ok(c.last_insert_rowid())
}

pub(super) fn clip_order(c: &Connection, ep: i64) -> Result<Vec<(i64,i64)>, String> {
    let mut query = c.prepare("SELECT id,scene_id FROM clips WHERE episode_id=? ORDER BY sort_order,id").map_err(|e| e.to_string())?;
    let rows = query.query_map([ep], |row| Ok((row.get(0)?,row.get(1)?))).map_err(|e| e.to_string())?;
    rows.collect::<Result<_,_>>().map_err(|e| e.to_string())
}

fn scene_order(c: &Connection, ep: i64) -> Result<Vec<i64>, String> {
    let mut query = c.prepare("SELECT s.id FROM scenes s JOIN clips c ON c.scene_id=s.id WHERE s.episode_id=? GROUP BY s.id ORDER BY MIN(c.sort_order),s.id")
        .map_err(|e| e.to_string())?;
    let rows = query.query_map([ep], |row| row.get(0)).map_err(|e| e.to_string())?;
    rows.collect::<Result<_,_>>().map_err(|e| e.to_string())
}

pub(super) fn check_contiguous(order: impl IntoIterator<Item=i64>) -> Result<(), String> {
    let mut previous = None;
    let mut seen = HashSet::new();
    for scene in order {
        if previous != Some(scene) && !seen.insert(scene) {
            return Err("同一场景的片段必须连续，请调整选择或移动整个场景".into());
        }
        previous = Some(scene);
    }
    Ok(())
}

pub(super) fn clean_empty(c: &Connection, ep: i64) -> Result<(), String> {
    c.execute("DELETE FROM scenes WHERE episode_id=? AND NOT EXISTS(SELECT 1 FROM clips WHERE scene_id=scenes.id)", [ep])
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub(super) fn set_clip_order(c: &Connection, ep: i64, ids: &[i64]) -> Result<(), String> {
    let members: HashMap<_,_> = clip_order(c,ep)?.into_iter().collect();
    if ids.len()!=members.len() || ids.iter().collect::<HashSet<_>>().len()!=ids.len() || ids.iter().any(|id| !members.contains_key(id)) {
        return Err("请提交剧集完整的片段顺序".into());
    }
    check_contiguous(ids.iter().map(|id| members[id]))?;
    for (index, id) in ids.iter().enumerate() {
        c.execute("UPDATE clips SET sort_order=? WHERE id=? AND sort_order<>?", params![index as i64,id,index as i64]).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn ids(value: &Value, label: &str) -> Result<Vec<i64>,String> {
    let items = value.as_array().ok_or_else(|| format!("{label}必须是 ID 数组"))?;
    let mut seen = HashSet::new();
    items.iter().map(|item| item.as_i64().filter(|id| *id>0 && seen.insert(*id))
        .ok_or_else(|| format!("{label}包含无效或重复的 ID"))).collect()
}

fn regroup(c: &Connection, ep: i64, scene: i64, selected: &[i64]) -> Result<(),String> {
    let order = clip_order(c,ep)?;
    if selected.is_empty() || !order.windows(selected.len()).any(|window| window.iter().map(|(id,_)| id).eq(selected.iter())) {
        return Err("请选择当前剧集中顺序连续的片段".into());
    }
    let selected: HashSet<_> = selected.iter().copied().collect();
    // Removed members of the target become standalone scenes at their original positions.
    for (clip, parent) in &order {
        if *parent==scene && !selected.contains(clip) {
            split_clip(c,*clip)?;
        }
    }
    for clip in selected {
        c.execute("UPDATE clips SET scene_id=? WHERE id=? AND scene_id<>?", params![scene,clip,scene]).map_err(|e| e.to_string())?;
    }
    check_contiguous(clip_order(c,ep)?.into_iter().map(|(_,scene)| scene))?;
    clean_empty(c,ep)
}

fn fields(c: &Connection, value: &Value, create: bool) -> Result<(),String> {
    for (key, item) in value.as_object().ok_or("JSON 必须是对象")? {
        match key.as_str() {
            "project_id" | "id" => {}
            "episode_id" if item.as_i64().is_some_and(|id| id>0) => {}
            "title" if item.as_str().is_some_and(|title| !title.trim().is_empty()) => {}
            "description" | "shared_prompt" if item.is_string() => {}
            "generation_mode" if matches!(item.as_str(),Some("clips"|"one_take")) => {}
            "generation_options" if item.is_object() => {
                for key in ["first_media_id","last_media_id"] {
                    if let Some(value) = item.get(key).filter(|value| !value.is_null()) {
                        if media(c,value.as_i64()).is_none_or(|media| media["kind"]!="image") { return Err(format!("{key} 必须引用有效图片")); }
                    }
                }
                if let Some(value)=item.get("reference_video_media_ids") { check_media(c,value,"video","reference_video_media_ids")?; }
            }
            "reference_media_ids" => check_media(c,item,"image",key)?,
            "reference_audio_media_ids" => check_media(c,item,"audio",key)?,
            "clip_ids" => { ids(item,key)?; }
            "anchor_scene_id" if create && item.as_i64().is_some_and(|id| id>0) => {}
            "position" if create && matches!(item.as_str(),Some("before"|"after")) => {}
            _ => return Err(format!("场景字段无效：{key}")),
        }
    }
    Ok(())
}

fn check_media(c: &Connection, value: &Value, kind: &str, label: &str) -> Result<(),String> {
    for id in ids(value,label)? {
        if media(c,Some(id)).is_none_or(|media| media["kind"]!=kind) { return Err(format!("{label} 引用的素材 {id} 不存在或类型不符")); }
    }
    Ok(())
}

fn save_fields(c: &Connection, scene: i64, v: &Value) -> Result<(),String> {
    c.execute("UPDATE scenes SET title=COALESCE(?,title),description=COALESCE(?,description),shared_prompt=COALESCE(?,shared_prompt),
        reference_media_ids=COALESCE(?,reference_media_ids),reference_audio_media_ids=COALESCE(?,reference_audio_media_ids),
        generation_mode=COALESCE(?,generation_mode),generation_options=COALESCE(?,generation_options) WHERE id=?",
        params![v["title"].as_str().map(str::trim),v["description"].as_str(),v["shared_prompt"].as_str(),
            v.get("reference_media_ids").map(Value::to_string),v.get("reference_audio_media_ids").map(Value::to_string),
            v["generation_mode"].as_str(),v.get("generation_options").map(Value::to_string),scene]).map_err(|e| e.to_string())?;
    Ok(())
}

fn insertion_index(order: &[(i64,i64)], anchor: i64, position: &str) -> Result<usize,String> {
    let index = match position {
        "before" => order.iter().position(|(_,scene)| *scene == anchor),
        "after" => order.iter().rposition(|(_,scene)| *scene == anchor).map(|index| index + 1),
        _ => return Err("插入位置无效".into()),
    };
    index.ok_or_else(|| "目标场景不存在于当前剧集".into())
}

pub(super) fn create(s: &AppState, v: &Value) -> Result<Value,String> {
    let pid = project_id(v)?;
    let mut c = db(s,&pid)?;
    let tx = c.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).map_err(|e| e.to_string())?;
    fields(&tx,v,true)?;
    let ep = intv(v,"episode_id")?;
    let title = strv(v,"title")?;
    let placement = match (v["anchor_scene_id"].as_i64(), v["position"].as_str()) {
        (None, None) => None,
        (Some(anchor), Some(position)) => {
            if v.get("clip_ids").is_some() { return Err("插入场景时不能指定已有片段".into()); }
            let order = clip_order(&tx,ep)?;
            let index = insertion_index(&order,anchor,position)?;
            Some((index, order.into_iter().map(|(clip,_)| clip).collect::<Vec<_>>()))
        }
        _ => return Err("插入场景需要同时指定目标场景和插入位置".into()),
    };
    let id = insert_parent(&tx,ep,title.trim())?;
    save_fields(&tx,id,v)?;
    if let Some(selected) = v.get("clip_ids") {
        regroup(&tx,ep,id,&ids(selected,"clip_ids")?)?;
    } else {
        let clip = next_clip_id(&tx)?;
        tx.execute("INSERT INTO clips(id,episode_id,scene_id,title,sort_order,created_at)
            VALUES(?,?,?,'片段 1',(SELECT COALESCE(MAX(sort_order),-1)+1 FROM clips WHERE episode_id=?),?)",
            params![clip,ep,id,ep,now()]).map_err(|e| e.to_string())?;
        if let Some((index, mut order)) = placement {
            order.insert(index, clip);
            set_clip_order(&tx,ep,&order)?;
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    touch(s,&pid);
    rest::get_scene(&c,id)
}

pub(super) fn duplicate(s: &AppState, v: &Value) -> Result<Value,String> {
    let pid = project_id(v)?;
    let mut c = db(s,&pid)?;
    let tx = c.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).map_err(|e| e.to_string())?;
    let source = intv(v,"id")?;
    let ep = episode_id(&tx,source)?;
    let order = clip_order(&tx,ep)?;
    let index = insertion_index(&order,source,&strv(v,"position")?)?;
    tx.execute("INSERT INTO scenes(episode_id,title,description,shared_prompt,reference_media_ids,reference_audio_media_ids,generation_mode,generation_options,created_at)
        SELECT episode_id,title || '（副本）',description,shared_prompt,reference_media_ids,reference_audio_media_ids,generation_mode,generation_options,?
        FROM scenes WHERE id=?",params![now(),source]).map_err(|e| e.to_string())?;
    let id = tx.last_insert_rowid();
    let mut copies = Vec::new();
    for (clip, _) in order.iter().filter(|(_,scene)| *scene == source) {
        copies.push(copy_clip_content(&tx,*clip,id,order.len()+copies.len(),"")?);
    }
    let mut clips = order.into_iter().map(|(clip,_)| clip).collect::<Vec<_>>();
    clips.splice(index..index,copies);
    set_clip_order(&tx,ep,&clips)?;
    let result = rest::get_scene(&tx,id)?;
    tx.commit().map_err(|e| e.to_string())?;
    touch(s,&pid);
    Ok(result)
}

pub(super) fn update(s: &AppState, v: &Value) -> Result<Value,String> {
    let pid = project_id(v)?;
    let mut c = db(s,&pid)?;
    let tx = c.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).map_err(|e| e.to_string())?;
    fields(&tx,v,false)?;
    let id = intv(v,"id")?;
    let ep = episode_id(&tx,id)?;
    if v.get("episode_id").is_some_and(|value| value.as_i64()!=Some(ep)) { return Err("场景不能跨剧集移动".into()); }
    save_fields(&tx,id,v)?;
    if let Some(selected) = v.get("clip_ids") { regroup(&tx,ep,id,&ids(selected,"clip_ids")?)?; }
    tx.commit().map_err(|e| e.to_string())?;
    touch(s,&pid);
    rest::get_scene(&c,id)
}

fn episode_id(c: &Connection, id: i64) -> Result<i64,String> {
    c.query_row("SELECT episode_id FROM scenes WHERE id=?", [id], |row| row.get(0)).optional().map_err(|e| e.to_string())?
        .ok_or_else(|| "场景不存在".into())
}

pub(super) fn delete(s: &AppState, v: &Value) -> Result<Value,String> {
    let pid = project_id(v)?;
    if db(s,&pid)?.execute("DELETE FROM scenes WHERE id=?", [intv(v,"id")?]).map_err(|e| e.to_string())? == 0 {
        return Err("场景不存在".into());
    }
    touch(s,&pid);
    Ok(json!({"ok":true,"deleted":true}))
}

fn split_clip(c: &Connection, clip: i64) -> Result<i64,String> {
    // A detached clip can still be regenerated with the original creative context.
    c.execute("INSERT INTO scenes(episode_id,title,description,shared_prompt,reference_media_ids,reference_audio_media_ids,generation_options,created_at)
        SELECT s.episode_id,c.title,s.description,s.shared_prompt,s.reference_media_ids,s.reference_audio_media_ids,
               CASE WHEN s.generation_mode='one_take' THEN json_remove(s.generation_options,'$.video_mode','$.first_media_id','$.last_media_id')
                    ELSE s.generation_options END,?
        FROM scenes s JOIN clips c ON c.scene_id=s.id WHERE c.id=?",params![now(),clip]).map_err(|e| e.to_string())?;
    let scene = c.last_insert_rowid();
    c.execute("UPDATE clips SET scene_id=? WHERE id=?", params![scene,clip]).map_err(|e| e.to_string())?;
    Ok(scene)
}

pub(super) fn ungroup(s: &AppState, v: &Value) -> Result<Value,String> {
    let pid = project_id(v)?;
    let mut c = db(s,&pid)?;
    let tx = c.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).map_err(|e| e.to_string())?;
    let id = intv(v,"scene_id")?;
    let ep = episode_id(&tx,id)?;
    let members: Vec<_> = clip_order(&tx,ep)?.into_iter().filter(|(_,parent)| *parent==id).collect();
    if members.len()<2 { return Err("至少两个片段才能拆分场景".into()); }
    let scene_ids = members.into_iter().map(|(clip,_)| split_clip(&tx,clip)).collect::<Result<Vec<_>,_>>()?;
    clean_empty(&tx,ep)?;
    tx.commit().map_err(|e| e.to_string())?;
    touch(s,&pid);
    Ok(json!({"scene_ids":scene_ids}))
}

pub(super) fn merge(s: &AppState, v: &Value) -> Result<Value, String> {
    let pid = project_id(v)?;
    let episode = intv(v, "episode_id")?;
    let selected: HashSet<_> = ids(&v["scene_ids"], "scene_ids")?.into_iter().collect();
    if selected.len() < 2 {
        return Err("请至少选择两个场景".into());
    }
    let title = v.get("title").map(|value| {
        value.as_str().map(str::trim).filter(|title| !title.is_empty()).ok_or("合并后的场景名称不能为空")
    }).transpose()?;

    let mut c = db(s, &pid)?;
    let tx = c.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).map_err(|e| e.to_string())?;
    let order = scene_order(&tx, episode)?;
    let merged = order.windows(selected.len())
        .find(|window| window.iter().all(|id| selected.contains(id)))
        .ok_or("请选择同一剧集中连续的场景")?;
    let target = match v.get("target_scene_id") {
        Some(value) => value.as_i64().filter(|id| selected.contains(id)).ok_or("请选择其中一个场景作为合并目标")?,
        None => merged[0],
    };

    for &source in merged.iter().filter(|&&id| id != target) {
        tx.execute("UPDATE clips SET scene_id=? WHERE scene_id=? AND episode_id=?", params![target, source, episode])
            .map_err(|e| e.to_string())?;
        if tx.execute("DELETE FROM scenes WHERE id=? AND NOT EXISTS(SELECT 1 FROM clips WHERE scene_id=?)", [source, source])
            .map_err(|e| e.to_string())? != 1 {
            return Err("原场景仍有未移动的片段，无法合并".into());
        }
    }
    // The previous take covers only the original members. Keep it as a candidate.
    tx.execute("UPDATE scenes SET title=COALESCE(?,title),video_media_id=NULL WHERE id=?", params![title, target])
        .map_err(|e| e.to_string())?;
    let scene = rest::get_scene(&tx, target)?;
    tx.commit().map_err(|e| e.to_string())?;
    touch(s, &pid);
    Ok(scene)
}

pub(super) fn reorder(s: &AppState, v: &Value) -> Result<Value,String> {
    let pid = project_id(v)?;
    let mut c = db(s,&pid)?;
    let tx = c.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).map_err(|e| e.to_string())?;
    let ep = intv(v,"episode_id")?;
    let requested = ids(&v["scene_ids"],"scene_ids")?;
    let current = scene_order(&tx,ep)?;
    if current.len()!=requested.len() || requested.iter().any(|id| !current.contains(id)) { return Err("请提交剧集完整的场景顺序".into()); }
    let order = clip_order(&tx,ep)?;
    let by_scene = order.into_iter().fold(HashMap::<i64,Vec<i64>>::new(), |mut result,(clip,scene)| {
        result.entry(scene).or_default().push(clip); result
    });
    let flattened = requested.iter().flat_map(|id| by_scene[id].iter().copied()).collect::<Vec<_>>();
    set_clip_order(&tx,ep,&flattened)?;
    tx.commit().map_err(|e| e.to_string())?;
    touch(s,&pid);
    Ok(json!({"ok":true}))
}

pub(super) fn videos(c: &Connection, id: i64) -> Result<Vec<Value>,String> {
    let mut query = c.prepare("SELECT media_id FROM scene_videos WHERE scene_id=? ORDER BY media_id").map_err(|e| e.to_string())?;
    let rows = query.query_map([id], |row| row.get::<_,i64>(0)).map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>,_>>().map_err(|e| e.to_string())?;
    Ok(rows.into_iter().filter_map(|mid| media(c,Some(mid))).collect())
}

pub(super) fn attach_scene_video(c: &Connection, id: i64, mid: i64, select: bool) -> Result<(),String> {
    c.execute("INSERT OR IGNORE INTO scene_videos(scene_id,media_id) VALUES(?,?)", params![id,mid]).map_err(|e| e.to_string())?;
    if select {
        c.execute("UPDATE scenes SET video_media_id=? WHERE id=? AND video_media_id IS NULL AND generation_mode='one_take'", params![mid,id])
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub(super) fn select_video(s: &AppState, v: &Value) -> Result<Value,String> {
    let pid = project_id(v)?;
    let mut c = db(s,&pid)?;
    let tx = c.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).map_err(|e| e.to_string())?;
    let id = intv(v,"scene_id")?;
    let mid = intv(v,"media_id")?;
    episode_id(&tx,id)?;
    if media(&tx,Some(mid)).is_none_or(|media| media["kind"]!="video") { return Err("请选择有效的视频素材".into()); }
    attach_scene_video(&tx,id,mid,false)?;
    tx.execute("UPDATE scenes SET video_media_id=? WHERE id=?", params![mid,id]).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    touch(s,&pid);
    Ok(json!({"ok":true}))
}

pub(super) fn delete_video(s: &AppState, v: &Value) -> Result<Value,String> {
    let pid = project_id(v)?;
    let mut c = db(s,&pid)?;
    let tx = c.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).map_err(|e| e.to_string())?;
    let id = intv(v,"scene_id")?;
    let mid = intv(v,"media_id")?;
    episode_id(&tx,id)?;
    tx.execute("DELETE FROM scene_videos WHERE scene_id=? AND media_id=?", params![id,mid]).map_err(|e| e.to_string())?;
    tx.execute("UPDATE scenes SET video_media_id=NULL WHERE id=? AND video_media_id=?", params![id,mid]).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    touch(s,&pid);
    Ok(json!({"ok":true}))
}

pub(super) fn episode_playback_units(c: &Connection, ep: i64) -> Result<Vec<Value>,String> {
    let mut query = c.prepare("SELECT c.id,c.title,c.video_media_id,s.id,s.title,s.generation_mode,s.video_media_id
        FROM clips c JOIN scenes s ON s.id=c.scene_id WHERE c.episode_id=? ORDER BY c.sort_order,c.id").map_err(|e| e.to_string())?;
    let mut rows = query.query([ep]).map_err(|e| e.to_string())?;
    let mut result = Vec::new();
    let mut takes = HashSet::new();
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let scene: i64 = row.get(3).map_err(|e| e.to_string())?;
        let mode: String = row.get(5).map_err(|e| e.to_string())?;
        let (kind,id,title,mid,versions) = if mode=="one_take" {
            if !takes.insert(scene) { continue; }
            ("scene",scene,row.get::<_,String>(4),row.get::<_,Option<i64>>(6),videos(c,scene)?)
        } else {
            let clip: i64 = row.get(0).map_err(|e| e.to_string())?;
            ("clip",clip,row.get::<_,String>(1),row.get::<_,Option<i64>>(2),clip_videos(c,clip)?)
        };
        let mid = mid.map_err(|e| e.to_string())?;
        result.push(json!({"kind":kind,"id":id,"scene_id":scene,"title":title.map_err(|e| e.to_string())?,
            "video_media_id":mid,"video_media":media(c,mid),"videos":versions}));
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merging_scenes_keeps_order_clips_and_target_settings() {
        let root = std::env::temp_dir().join(format!("spielberg-scene-merge-{}", Uuid::new_v4()));
        storage::initialize_root(&root).unwrap();
        let state = AppState {root: root.clone(), guard: std::sync::Arc::new(Mutex::new(()))};
        let project = create_project(&state, &json!({"name":"合并场景测试"})).unwrap();
        let pid = project["id"].as_str().unwrap();
        let c = db(&state, pid).unwrap();
        c.execute_batch(r#"
            INSERT INTO episodes(id,title,sort_order,created_at) VALUES (1,'第一集',0,'1'),(2,'第二集',1,'1');
            INSERT INTO media(id,name,path,kind,created_at) VALUES
                (1,'目标旧长镜头','1.mp4','video','1'),(2,'原场景长镜头','2.mp4','video','1'),(3,'片段视频','3.mp4','video','1'),
                (4,'参考图','4.png','image','1');
            INSERT INTO scenes(id,episode_id,title,shared_prompt,generation_mode,video_media_id,reference_media_ids,created_at) VALUES
                (1,1,'原场景','原设定','one_take',2,'[]','1'),(2,1,'目标场景','目标设定','one_take',1,'[4]','1'),
                (3,1,'后续场景','','clips',NULL,'[]','1'),(4,2,'另一集场景','','clips',NULL,'[]','1');
            INSERT INTO scene_videos VALUES (1,2),(2,1);
            INSERT INTO clips(id,episode_id,scene_id,title,sort_order,created_at,video_media_id) VALUES
                (11,1,1,'片段 A',0,'1',3),(13,1,1,'片段 B',1,'1',NULL),(12,1,2,'片段 C',2,'1',NULL),
                (14,1,3,'片段 D',3,'1',NULL),(15,2,4,'片段 E',0,'1',NULL);
            INSERT INTO clip_videos VALUES (11,3);
        "#).unwrap();

        for invalid in [
            json!({"scene_ids":[1]}),
            json!({"scene_ids":[1,1]}),
            json!({"scene_ids":[1,3]}),
            json!({"scene_ids":[1,4]}),
            json!({"scene_ids":[1,2],"target_scene_id":3}),
            json!({"scene_ids":[1,2],"title":" "}),
        ] {
            let mut request = invalid;
            request["project_id"] = json!(pid);
            request["episode_id"] = json!(1);
            assert!(rest::action(&state, "/scenes/merge", request).is_err());
            assert_eq!(clip_order(&c,1).unwrap(), vec![(11,1),(13,1),(12,2),(14,3)]);
            assert_eq!(rest::get_scene(&c,2).unwrap()["video_media_id"],1);
        }

        let result = rest::action(&state, "/scenes/merge", json!({
            "project_id":pid,"episode_id":1,"scene_ids":[2,1],"target_scene_id":2,"title":"  合并场景  "
        })).unwrap();
        assert_eq!(result["id"],2);
        assert_eq!(result["title"],"合并场景");
        assert_eq!(result["shared_prompt"],"目标设定");
        assert_eq!(result["reference_media_ids"],json!([4]));
        assert_eq!(result["generation_mode"],"one_take");
        assert!(result["video_media_id"].is_null());
        assert_eq!(result["videos"][0]["id"],1);
        assert_eq!(result["clips"][0]["video_media_id"],3);
        assert_eq!(clip_order(&c,1).unwrap(),vec![(11,2),(13,2),(12,2),(14,3)]);
        assert_eq!(clip_order(&c,2).unwrap(),vec![(15,4)]);
        assert!(rest::get_scene(&c,1).is_err());
        assert!(media(&c,Some(2)).is_some());
        let playback = episode_playback_units(&c,1).unwrap();
        assert_eq!(playback.len(),2);
        assert_eq!(playback[0]["id"],2);
        assert!(playback[0]["video_media_id"].is_null());

        let result = rest::action(&state, "/scenes/merge", json!({
            "project_id":pid,"episode_id":1,"scene_ids":[3,2]
        })).unwrap();
        assert_eq!(result["id"],2);
        assert_eq!(result["title"],"合并场景");
        assert_eq!(clip_order(&c,1).unwrap(),vec![(11,2),(13,2),(12,2),(14,2)]);
        drop(c);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn legacy_scene_ids_media_and_saved_work_survive_migration() {
        let c = Connection::open_in_memory().unwrap();
        migrate_to(&c,16).unwrap();
        c.execute_batch(r#"
            INSERT INTO episodes(id,title,sort_order,created_at,storyboard) VALUES(1,'剧集',0,'1','{"scenes":[{"scene_id":43,"title":"分镜"}]}');
            INSERT INTO media(id,name,path,kind,created_at) VALUES(3,'参考','image.png','image','1'),(4,'结果','video.mp4','video','1');
            INSERT INTO scenes(id,episode_id,title,description,sort_order,created_at,creation_mode,first_media_id,video_media_id)
                VALUES(43,1,'旧场景','旧描述',0,'1','canvas',3,4);
            INSERT INTO scene_videos VALUES(43,4);
            INSERT INTO scene_options VALUES(43,'{"duration":8}');
            INSERT INTO scene_scripts VALUES(43,'{"first":"旧脚本"}');
            INSERT INTO scene_canvases VALUES(43,'{"nodes":[{"kind":"scene","ref_id":43}]}',2);
            INSERT INTO scene_canvas_sources VALUES(43,3);
            INSERT INTO settings VALUES('script_draft_episode_1','{"scenes":[{"scene_id":43,"description":"草稿"}]}');
            INSERT INTO background_jobs(operation,status,prompt,created_at,updated_at,request_json,resume_json)
                VALUES('/generations/video','running','续跑','1','1','{"scene_id":43}','{"payload":{"scene_id":43,"prompt":"原文"}}');
        "#).unwrap();
        migrate(&c).unwrap();
        migrate(&c).unwrap();
        let scene = rest::get_scene(&c,43).unwrap();
        assert_eq!(scene["title"],"旧场景");
        assert_eq!(scene["clips"][0]["id"],43);
        assert_eq!(scene["clips"][0]["video_media"]["id"],4);
        assert_eq!(scene["clips"][0]["generation_options"]["duration"],8);
        assert_eq!(scene["clips"][0]["script"]["first"],"旧脚本");
        assert_eq!(storyboard::load(&c,1).unwrap()["clips"][0]["clip_id"],43);
        assert_eq!(episode_playback_units(&c,1).unwrap()[0]["kind"],"clip");
        for (query,expected) in [
            ("SELECT json_extract(draft,'$.nodes[0].kind') FROM clip_canvases","clip"),
            ("SELECT CAST(json_extract(value,'$.clips[0].clip_id') AS TEXT) FROM settings WHERE key='script_draft_episode_1'","43"),
            ("SELECT CAST(json_extract(resume_json,'$.payload.clip_id') AS TEXT) FROM background_jobs","43"),
        ] {
            assert_eq!(c.query_row(query,[],|row| row.get::<_,String>(0)).unwrap(),expected);
        }
        assert_eq!(catalog::usages(&c,3).unwrap().len(),2);
        assert!(!c.prepare("PRAGMA foreign_key_check").unwrap().exists([]).unwrap());
        c.execute("DELETE FROM clips WHERE id=43",[]).unwrap();
        assert!(rest::get_scene(&c,43).is_err());
        assert!(media(&c,Some(4)).is_some());
        assert!(next_clip_id(&c).unwrap()>43);
    }
}
