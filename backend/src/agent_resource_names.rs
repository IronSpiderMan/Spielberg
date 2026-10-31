//! Upgrade structured tool history once; user/assistant prose and resource IDs stay intact.
use super::*;

fn resource(name: &str) -> &str {
    match name { "roles" => "assets", "assets" => "media", _ => name }
}

fn operation(name: &str) -> String {
    name.strip_prefix("roles/").map(|suffix|format!("assets/{suffix}"))
        .unwrap_or_else(||resource(name).to_string())
}

fn arguments(name: &str, args: &mut Value) {
    if let Some(raw) = args.as_str() {
        if let Ok(mut parsed) = serde_json::from_str::<Value>(raw) {
            arguments(name, &mut parsed);
            *args = json!(parsed.to_string());
        }
        return;
    }
    if !args.is_object() { return; }
    match name {
        "app_request" => {
            if let Some(old) = args["resource"].as_str() { args["resource"] = json!(resource(old)); }
            if let Some(data)=args.get_mut("data") { rename_asset_id(data); }
        },
        "app_action" | "app_describe" => {
            if let Some(old) = args["operation"].as_str() { args["operation"] = json!(operation(old)); }
            if let Some(data)=args.get_mut("data") { rename_asset_id(data); }
            if args["operation"]=="canvas/save" { canvas::normalize_asset_nodes(&mut args["data"]["draft"]); }
        },
        _ => {},
    }
}

fn rename_asset_id(value: &mut Value) {
    if let Some(object) = value.as_object_mut() {
        if let Some(id) = object.remove("role_id") { object.insert("asset_id".into(), id); }
    }
}

fn snapshot(value: &mut Value) {
    if let Some(object) = value.as_object_mut() {
        if let Some(assets) = object.remove("roles") { object.insert("assets".into(), assets); }
        if let Some(revisions) = object.get_mut("revisions").and_then(Value::as_object_mut) {
            if let Some(version) = revisions.remove("roles") { revisions.insert("assets".into(), version); }
        }
    }
}

fn messages(messages: &mut Value) {
    let Some(items) = messages.as_array_mut() else { return };
    for message in items {
        if message["role"]=="assistant" {
            if let Some(calls) = message["tool_calls"].as_array_mut() {
                for call in calls {
                    let name=call["function"]["name"].as_str().unwrap_or("").to_string();
                    arguments(&name, &mut call["function"]["arguments"]);
                }
            }
        } else if message["role"]=="tool" {
            let name=message["tool_name"].as_str().unwrap_or("").to_string();
            if let Some(args)=message.get_mut("arguments") { arguments(&name,args); }
            if let Some(mut result)=message["content"].as_str().and_then(|s|serde_json::from_str::<Value>(s).ok()) {
                if name=="get_project" {
                    snapshot(&mut result);
                    if let Some(data)=result.get_mut("data") { snapshot(data); }
                } else if name=="app_action" && matches!(message["arguments"]["operation"].as_str(),Some("canvas/load"|"canvas/save")) {
                    canvas::normalize_asset_nodes(&mut result["draft"]);
                }
                message["content"]=json!(result.to_string());
            }
        }
    }
}

pub(super) fn migrate_session(c: &Connection, id: &str) -> Result<(),String> {
    let row:Option<String>=c.query_row("SELECT messages FROM agent_sessions WHERE id=? AND resource_names_version<2",[id],|r|r.get(0)).optional().map_err(|e|e.to_string())?;
    if let Some(raw)=row {
        let mut history=serde_json::from_str::<Value>(&raw).map_err(|e|e.to_string())?;
        messages(&mut history);
        c.execute("UPDATE agent_sessions SET messages=?,resource_names_version=2 WHERE id=? AND resource_names_version<2",params![history.to_string(),id]).map_err(|e|e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn old_tool_history_is_mapped_once_without_changing_prose_or_ids() {
        let c=Connection::open_in_memory().unwrap(); install(&c).unwrap();
        let history=json!([
            {"role":"user","content":"roles assets role_id /api/v1 都是原文"},
            {"role":"assistant","content":"旧说明 roles","tool_calls":[
                {"id":"asset","function":{"name":"app_request","arguments":json!({"resource":"roles","method":"PATCH","id":9,"data":{"description":"assets 原文"}}).to_string()}},
                {"id":"media","function":{"name":"app_request","arguments":json!({"resource":"assets","method":"POST","data":{"role_id":9}}).to_string()}}
            ]},
            {"role":"tool","tool_name":"app_action","arguments":{"operation":"roles/audio/save","data":{"role_id":9,"media_id":4,"name":"roles 音频"}},"content":"{\"id\":4}"},
            {"role":"tool","tool_name":"get_project","content":json!({"roles":[{"id":9}],"media":[{"id":4}],"revisions":{"roles":3,"media":2}}).to_string()}
        ]);
        c.execute("INSERT INTO agent_sessions(id,title,status,messages,created_at,updated_at) VALUES('old','旧会话','completed',?,'1','1')",[history.to_string()]).unwrap();
        let first=read_session(&c,"old").unwrap();
        assert_eq!(first["messages"][0],history[0]);
        assert_eq!(first["messages"][1]["content"],history[1]["content"]);
        let call=|n:usize|serde_json::from_str::<Value>(first["messages"][1]["tool_calls"][n]["function"]["arguments"].as_str().unwrap()).unwrap();
        assert_eq!(call(0)["resource"],"assets");assert_eq!(call(0)["id"],9);assert_eq!(call(0)["data"]["description"],"assets 原文");
        assert_eq!(call(1)["resource"],"media");assert_eq!(call(1)["data"]["asset_id"],9);
        assert_eq!(first["messages"][2]["arguments"]["operation"],"assets/audio/save");
        assert_eq!(first["messages"][2]["arguments"]["data"],json!({"asset_id":9,"media_id":4,"name":"roles 音频"}));
        let project:Value=serde_json::from_str(first["messages"][3]["content"].as_str().unwrap()).unwrap();
        assert_eq!(project,json!({"assets":[{"id":9}],"media":[{"id":4}],"revisions":{"assets":3,"media":2}}));
        assert_eq!(read_session(&c,"old").unwrap(),first);
    }
}
