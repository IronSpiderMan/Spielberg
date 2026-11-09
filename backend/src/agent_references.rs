use super::*;
use std::collections::HashSet;

pub(super) fn validate(c: &Connection, request: &Value, message: &str) -> Result<Vec<Value>, String> {
    let Some(value) = request.get("references") else { return Ok(vec![]) };
    let references = value.as_array().ok_or("项目引用必须是数组")?;
    if references.len() > 32 { return Err("每条消息最多引用 32 个项目对象".into()); }
    let mut names = HashSet::new();
    references.iter().map(|entry| {
        let name = entry["name"].as_str()
            .filter(|name| !name.is_empty() && name.len() <= 2048 && !name.contains(['@', '\r', '\n']))
            .ok_or("项目引用名称无效")?;
        if !names.insert(name) || !message.contains(&format!("@{name}")) {
            return Err("项目引用名称重复或未出现在消息中".into());
        }
        let resource = entry["resource"].as_str().unwrap_or_default();
        let read_id = |key: &str| entry[key].as_i64().filter(|id| *id > 0).ok_or_else(|| format!("项目引用的 {key} 无效"));
        let id = read_id("id")?;
        let mut reference = json!({"name": name, "resource": resource, "id": id});
        let (sql, ids) = match resource {
            "assets" => ("SELECT EXISTS(SELECT 1 FROM assets WHERE id=? AND enabled!=0)", vec![id]),
            "episodes" => ("SELECT EXISTS(SELECT 1 FROM episodes WHERE id=?)", vec![id]),
            "media" => {
                let asset = read_id("asset_id")?;
                reference["asset_id"] = json!(asset);
                ("SELECT EXISTS(SELECT 1 FROM media m JOIN assets a ON a.id=?2
                  WHERE m.id=?1 AND m.deleted_at IS NULL AND m.purged_at IS NULL AND a.enabled!=0 AND (
                    a.design_media_id=m.id OR EXISTS(SELECT 1 FROM role_media WHERE role_id=a.id AND media_id=m.id)
                    OR EXISTS(SELECT 1 FROM role_audio WHERE role_id=a.id AND media_id=m.id)))", vec![id, asset])
            }
            "scenes" => {
                let episode = read_id("episode_id")?;
                reference["episode_id"] = json!(episode);
                ("SELECT EXISTS(SELECT 1 FROM scenes WHERE id=? AND episode_id=?)", vec![id, episode])
            }
            "clips" => {
                let episode = read_id("episode_id")?;
                let scene = read_id("scene_id")?;
                reference["episode_id"] = json!(episode);
                reference["scene_id"] = json!(scene);
                ("SELECT EXISTS(SELECT 1 FROM clips WHERE id=? AND episode_id=? AND scene_id=?)", vec![id, episode, scene])
            }
            _ => return Err("不支持的项目引用类型".into()),
        };
        let exists: bool = c.query_row(sql, rusqlite::params_from_iter(ids), |row| row.get(0)).map_err(|e| e.to_string())?;
        if !exists { return Err(format!("项目引用 @{name} 已停用、移除或不属于所选上级，请删除后重新选择。")); }
        Ok(reference)
    }).collect()
}
