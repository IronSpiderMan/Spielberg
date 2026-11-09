//! Upgrade structured tool history once; user/assistant prose and resource IDs stay intact.
use super::*;

fn resource(name: &str) -> &str {
    match name { "roles" => "assets", "assets" => "media", _ => name }
}

fn operation(name: &str) -> String {
    name.strip_prefix("roles/").map(|suffix|format!("assets/{suffix}"))
        .unwrap_or_else(||resource(name).to_string())
}

fn arguments(name: &str, args: &mut Value, version: i64) {
    if let Some(raw) = args.as_str() {
        if let Ok(mut parsed) = serde_json::from_str::<Value>(raw) {
            arguments(name, &mut parsed, version);
            *args = json!(parsed.to_string());
        }
        return;
    }
    if !args.is_object() { return; }
    if name == "request_user_input" {
        if let Some(tool) = args.get_mut("tool") {
            let tool_name = tool["name"].as_str().unwrap_or("").to_string();
            if let Some(inner) = tool.get_mut("arguments") { arguments(&tool_name, inner, version); }
        }
        return;
    }
    if version < 2 { asset_arguments(name, args); }
    clip_arguments(name, args);
}

fn asset_arguments(name: &str, args: &mut Value) {
    match name {
        "app_request" => {
            if let Some(old) = args["resource"].as_str() { args["resource"] = json!(resource(old)); }
            if let Some(data)=args.get_mut("data") { rename_asset_id(data); }
        },
        "app_action" | "app_describe" => {
            if let Some(old) = args["operation"].as_str() { args["operation"] = json!(operation(old)); }
            if let Some(data)=args.get_mut("data") { rename_asset_id(data); }
            if args["operation"]=="canvas/save" {
                if let Some(draft) = args.pointer_mut("/data/draft") { canvas::normalize_asset_nodes(draft); }
            }
        },
        _ => {},
    }
}

fn rename_field(value: &mut Value, from: &str, to: &str) {
    if let Some(object) = value.as_object_mut() {
        if let Some(previous) = object.remove(from) { object.entry(to).or_insert(previous); }
    }
}

fn clip_collection(value: &mut Value) {
    rename_field(value, "scenes", "clips");
    if let Some(items) = value.get_mut("clips").and_then(Value::as_array_mut) {
        for item in items { rename_field(item, "scene_id", "clip_id"); }
    }
}

fn clip_canvas_nodes(draft: &mut Value) {
    if let Some(nodes) = draft.get_mut("nodes").and_then(Value::as_array_mut) {
        for node in nodes {
            if node["kind"] == "scene" { node["kind"] = json!("clip"); }
        }
    }
}

fn clip_arguments(name: &str, args: &mut Value) {
    match name {
        "app_request" => {
            if args["resource"] == "scenes" { args["resource"] = json!("clips"); }
            if let Some(board) = args.pointer_mut("/data/storyboard") { clip_collection(board); }
        }
        "app_action" | "app_describe" => {
            let Some(old) = args["operation"].as_str() else { return };
            let operation = if old == "scenes" { "clips".to_string() }
                else if let Some(suffix) = old.strip_prefix("scenes/") { format!("clips/{suffix}") }
                else { old.to_string() };
            args["operation"] = json!(operation);
            let Some(data) = args.get_mut("data") else { return };
            match operation.as_str() {
                "clips/reorder" => rename_field(data, "scene_ids", "clip_ids"),
                "clips/select-video" | "clips/delete-video" | "generations/video" | "media/video-frame" | "canvas/load" => rename_field(data, "scene_id", "clip_id"),
                "canvas/save" => {
                    rename_field(data, "scene_id", "clip_id");
                    if let Some(draft) = data.get_mut("draft") { clip_canvas_nodes(draft); }
                },
                "scripts/save" | "scripts/publish" => {
                    if let Some(draft) = data.get_mut("draft") { clip_collection(draft); }
                },
                "storyboard/plan" | "storyboard/validate" => {
                    rename_field(data, "scene", "clip");
                    if let Some(clip) = data.get_mut("clip") { rename_field(clip, "scene_id", "clip_id"); }
                },
                "resource/text/read" if data["resource"] == "scenes" => data["resource"] = json!("clips"),
                _ => {},
            }
        }
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

fn episode(value: &mut Value) {
    clip_collection(value);
    if let Some(board) = value.get_mut("storyboard") { clip_collection(board); }
}

fn result_payload(name: &str, args: &Value, result: &mut Value, version: i64) {
    if result["truncated"] == true {
        if let Some(data) = result.get_mut("data") { result_payload(name, args, data, version); }
        return;
    }
    match name {
        "get_project" => {
            if version < 2 { snapshot(result); }
            if let Some(items) = result.get_mut("episodes").and_then(Value::as_array_mut) {
                for item in items { episode(item); }
            }
        },
        "app_request" if args["resource"] == "episodes" => {
            if let Some(items) = result.as_array_mut() { for item in items { episode(item); } }
            else { episode(result); }
        },
        "app_action" => match args["operation"].as_str() {
            Some("canvas/load" | "canvas/save") => if let Some(draft) = result.get_mut("draft") {
                if version < 2 { canvas::normalize_asset_nodes(draft); }
                clip_canvas_nodes(draft);
            },
            Some("scripts/load" | "storyboard/generate") => clip_collection(result),
            Some("scripts/publish") => if let Some(draft) = result.get_mut("draft") { clip_collection(draft); },
            Some("resource/text/read") if result["resource"] == "scenes" => result["resource"] = json!("clips"),
            _ => {},
        },
        "request_user_input" => {
            if let Some(output) = result.get_mut("tool_result") {
                let tool = &args["tool"];
                result_payload(tool["name"].as_str().unwrap_or(""), &tool["arguments"], output, version);
            }
        },
        _ => {},
    }
}

fn messages(messages: &mut Value, version: i64) {
    let Some(items) = messages.as_array_mut() else { return };
    for message in items {
        if message["role"]=="assistant" {
            if let Some(calls) = message["tool_calls"].as_array_mut() {
                for call in calls {
                    let name=call["function"]["name"].as_str().unwrap_or("").to_string();
                    arguments(&name, &mut call["function"]["arguments"], version);
                }
            }
        } else if message["role"]=="tool" {
            let name=message["tool_name"].as_str().unwrap_or("").to_string();
            if let Some(args)=message.get_mut("arguments") { arguments(&name,args,version); }
            if let Some(mut result)=message["content"].as_str().and_then(|s|serde_json::from_str::<Value>(s).ok()) {
                result_payload(&name, &message["arguments"], &mut result, version);
                message["content"]=json!(result.to_string());
            }
        }
    }
}

pub(super) fn migrate_session(c: &Connection, id: &str) -> Result<(),String> {
    let row:Option<(String,i64)>=c.query_row("SELECT messages,resource_names_version FROM agent_sessions WHERE id=? AND resource_names_version<3",[id],|r|Ok((r.get(0)?,r.get(1)?))).optional().map_err(|e|e.to_string())?;
    if let Some((raw,version))=row {
        let mut history=serde_json::from_str::<Value>(&raw).map_err(|e|e.to_string())?;
        messages(&mut history,version);
        c.execute("UPDATE agent_sessions SET messages=?,resource_names_version=3 WHERE id=? AND resource_names_version=?",params![history.to_string(),id,version]).map_err(|e|e.to_string())?;
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

    #[test]
    fn former_scene_tool_history_targets_clips_and_keeps_creation_data() {
        let c=Connection::open_in_memory().unwrap(); install(&c).unwrap();
        let history=json!([
            {"role":"user","content":"旧场景 9 的 scenes 和 scene_id"},
            {"role":"assistant","content":"保留 scene_id 的原文","tool_calls":[
                {"function":{"name":"app_request","arguments":json!({"resource":"scenes","method":"PATCH","id":9,"data":{"description":"scene_id 原文"}}).to_string()}},
                {"function":{"name":"app_action","arguments":json!({"operation":"scenes/reorder","data":{"episode_id":2,"scene_ids":[9,12]}}).to_string()}}
            ]},
            {"role":"tool","tool_name":"app_action","arguments":{"operation":"canvas/save","data":{"scene_id":9,"draft":{"nodes":[{"kind":"scene","ref_id":12},{"kind":"asset","ref_id":4}]}}},"content":"{}"},
            {"role":"tool","tool_name":"app_action","arguments":{"operation":"scripts/publish","data":{"draft":{"scenes":[{"scene_id":9,"description":"scene_id"}]}}},"content":json!({"draft":{"scenes":[{"scene_id":9,"description":"scene_id"}]}}).to_string()},
            {"role":"tool","tool_name":"get_project","content":json!({"assets":[{"id":4}],"episodes":[{"id":2,"scenes":[{"id":9}],"storyboard":{"scenes":[{"scene_id":9,"shots":[]}]}}]}).to_string()}
        ]);
        c.execute("INSERT INTO agent_sessions(id,title,status,messages,created_at,updated_at,resource_names_version) VALUES('old','旧会话','completed',?,'1','1',2)",[history.to_string()]).unwrap();
        let first=read_session(&c,"old").unwrap();
        let messages=&first["messages"];
        assert_eq!(messages[0],history[0]);
        assert_eq!(messages[1]["content"],history[1]["content"]);
        let call=|index:usize|serde_json::from_str::<Value>(messages[1]["tool_calls"][index]["function"]["arguments"].as_str().unwrap()).unwrap();
        assert_eq!(call(0),json!({"resource":"clips","method":"PATCH","id":9,"data":{"description":"scene_id 原文"}}));
        assert_eq!(call(1),json!({"operation":"clips/reorder","data":{"episode_id":2,"clip_ids":[9,12]}}));
        assert_eq!(messages[2]["arguments"]["data"],json!({"clip_id":9,"draft":{"nodes":[{"kind":"clip","ref_id":12},{"kind":"asset","ref_id":4}]}}));
        let result=|index:usize|serde_json::from_str::<Value>(messages[index]["content"].as_str().unwrap()).unwrap();
        assert_eq!(result(3)["draft"]["clips"][0],json!({"clip_id":9,"description":"scene_id"}));
        assert_eq!(result(4)["episodes"][0]["clips"][0]["id"],9);
        assert_eq!(result(4)["episodes"][0]["storyboard"]["clips"][0]["clip_id"],9);
        assert_eq!(result(4)["assets"][0]["id"],4);
        assert_eq!(read_session(&c,"old").unwrap(),first);
    }
}
