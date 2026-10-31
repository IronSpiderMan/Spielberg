//! Durable turn state, separate from conversation text and business tool effects.
use super::*;

pub(super) fn start(session: &mut Value, limit: usize) {
    let previous = &session["execution"];
    let plan = previous["plan"].as_array().filter(|plan| plan.iter().any(|step| step["status"] != "completed"))
        .cloned().unwrap_or_default();
    session["execution"] = json!({"id":Uuid::new_v4().to_string(),"phase":"thinking",
        "tool_calls":0,"max_steps":limit,"model_requests":0,"retries":0,"usage":{},"plan":plan});
}

pub(super) fn update_plan(session: &mut Value, args: &Value) -> Result<Value, String> {
    let object = args.as_object().ok_or("计划参数必须为对象")?;
    if object.keys().any(|key| !["plan", "explanation"].contains(&key.as_str())) { return Err("计划包含不支持的字段".into()); }
    let plan = args["plan"].as_array().filter(|plan| !plan.is_empty() && plan.len() <= 8).ok_or("计划需要 1–8 个步骤")?;
    let mut active = 0;
    for item in plan {
        let fields = item.as_object().ok_or("计划步骤必须为对象")?;
        if fields.keys().any(|key| !["step", "status"].contains(&key.as_str())) { return Err("计划步骤包含不支持的字段".into()); }
        if !item["step"].as_str().is_some_and(|text| !text.trim().is_empty() && text.chars().count() <= 200) {
            return Err("计划步骤需要 1–200 字的说明".into());
        }
        match item["status"].as_str() {
            Some("in_progress") => active += 1,
            Some("pending" | "completed") => {},
            _ => return Err("计划状态必须为 pending、in_progress 或 completed".into()),
        }
    }
    if active > 1 { return Err("最多只能有一个正在执行的计划步骤".into()); }
    if let Some(explanation) = args.get("explanation") {
        if !explanation.as_str().is_some_and(|text| text.chars().count() <= 1000) { return Err("计划说明必须为 1000 字以内的文本".into()); }
    }
    // Validate before changing state; an invalid plan must not replace the last good one.
    session["execution"]["plan"] = json!(plan);
    session["execution"]["explanation"] = args.get("explanation").cloned().unwrap_or(Value::Null);
    Ok(json!({"updated":true,"plan":plan}))
}

pub(super) fn usage(session: &mut Value, usage: &Value) {
    for key in ["prompt_tokens", "completion_tokens", "total_tokens"] {
        if let Some(count) = usage[key].as_u64() {
            let previous = session["execution"]["usage"][key].as_u64().unwrap_or(0);
            session["execution"]["usage"][key] = json!(previous.saturating_add(count));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn invalid_plan_does_not_replace_persisted_progress() {
        let mut session = json!({});
        start(&mut session, 16);
        let args = json!({"plan":[{"step":"读取当前项目","status":"completed"},{"step":"验证镜头结果","status":"in_progress"}]});
        update_plan(&mut session, &args).unwrap();
        let previous = session.clone();
        for invalid in [
            json!({"plan":[]}),
            json!({"plan":[{"step":"a","status":"in_progress"},{"step":"b","status":"in_progress"}]}),
            json!({"plan":[{"step":" ","status":"completed"}]}),
            json!({"plan":[{"step":"a","status":"done"}]}),
            json!({"plan":[{"step":"a","status":"pending","project_id":"foreign"}]}),
            json!({"plan":[{"step":"a","status":"pending"}],"explanation":42}),
        ] {
            assert!(update_plan(&mut session, &invalid).is_err());
            assert_eq!(session, previous);
        }
        let old_id = session["execution"]["id"].clone();
        start(&mut session, 8);
        assert_ne!(session["execution"]["id"], old_id);
        assert_eq!(session["execution"]["plan"], args["plan"]);
        assert_eq!(session["execution"]["tool_calls"], 0);
        update_plan(&mut session, &json!({"plan":[{"step":"验证镜头结果","status":"completed"}]})).unwrap();
        start(&mut session, 8);
        assert_eq!(session["execution"]["plan"], json!([]));
    }
}
