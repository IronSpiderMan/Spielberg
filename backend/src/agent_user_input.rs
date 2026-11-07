//! User decisions are bound to one pending request, never inferred from time or defaults.
use super::*;

fn fields(value: &Value, allowed: &[&str]) -> Result<(), String> {
    let object = value.as_object().ok_or("交互参数必须为对象")?;
    if object.keys().any(|key| !allowed.contains(&key.as_str())) {
        return Err("交互参数包含不支持的字段".into());
    }
    Ok(())
}

fn text<'a>(value: &'a Value, max: usize) -> Result<&'a str, String> {
    value.as_str().filter(|text| !text.trim().is_empty() && text.chars().count() <= max)
        .ok_or_else(|| format!("交互文本必须为 1–{max} 字"))
}

fn validate(args: &Value) -> Result<(), String> {
    fields(args, &["questions", "tool"])?;
    let questions = args["questions"].as_array().filter(|items| !items.is_empty() && items.len() <= 4)
        .ok_or("每次需要 1–4 个问题")?;
    let mut ids = std::collections::HashSet::new();
    for question in questions {
        fields(question, &["id", "question", "type", "options"])?;
        if !ids.insert(text(&question["id"], 80)?) { return Err("问题 ID 不能重复".into()); }
        text(&question["question"], 1000)?;
        match question["type"].as_str() {
            Some("confirmation" | "text") => {
                if question.get("options").is_some() { return Err("确认或文本问题不能包含选项".into()); }
            },
            Some("single_select" | "multi_select") => {
                let options = question["options"].as_array().filter(|items| (2..=12).contains(&items.len()))
                    .ok_or("选择题需要 2–12 个选项")?;
                let mut ids = std::collections::HashSet::new();
                for option in options {
                    fields(option, &["id", "label", "description"])?;
                    if !ids.insert(text(&option["id"], 80)?) { return Err("选项 ID 不能重复".into()); }
                    text(&option["label"], 200)?;
                    if let Some(description) = option.get("description") {
                        if !description.as_str().is_some_and(|text| text.chars().count() <= 500) {
                            return Err("选项说明最多 500 字".into());
                        }
                    }
                }
            },
            _ => return Err("不支持的问题类型".into()),
        }
    }
    if let Some(tool) = args.get("tool") {
        fields(tool, &["name", "arguments"])?;
        if questions.len() != 1 || questions[0]["type"] != "confirmation" {
            return Err("工具执行确认必须且只能包含一个 confirmation 问题".into());
        }
        if !matches!(tool["name"].as_str(), Some("app_request" | "app_action")) || !tool["arguments"].is_object() {
            return Err("工具确认仅支持 app_request 或 app_action 的具体参数".into());
        }
    }
    Ok(())
}

fn validate_answers(request: &Value, answers: &Value) -> Result<(), String> {
    let answers = answers.as_object().ok_or("answers 必须为对象")?;
    let questions = request["questions"].as_array().ok_or("待回答问题无效")?;
    if answers.len() != questions.len() { return Err("请回答全部问题，不能增加其他答案".into()); }
    for question in questions {
        let answer = answers.get(question["id"].as_str().ok_or("问题 ID 无效")?).ok_or("请回答全部问题")?;
        let valid_option = |answer: &Value| answer.as_str().is_some_and(|id| {
            question["options"].as_array().is_some_and(|options| options.iter().any(|option| option["id"] == id))
        });
        match question["type"].as_str() {
            Some("confirmation") if answer.is_boolean() => {},
            Some("text") => { text(answer, 4000)?; },
            Some("single_select") if valid_option(answer) => {},
            Some("multi_select") => {
                let items = answer.as_array().filter(|items| !items.is_empty()).ok_or("请至少选择一项")?;
                let mut selected = std::collections::HashSet::new();
                if !items.iter().all(|item| valid_option(item) && selected.insert(item.as_str().unwrap())) {
                    return Err("多选答案包含重复或无效选项".into());
                }
            },
            _ => return Err("答案类型或选项无效".into()),
        }
    }
    Ok(())
}

// Called under the same data lock as cancellation and all other session commands.
pub(super) fn respond(s: &AppState, pid: &str, c: &Connection, value: &Value) -> Result<Value, String> {
    let id = strv(value, "session_id")?;
    let mut session = read_session(c, &id)?;
    let active = runs().lock().map_err(|_| "Agent 运行锁不可用")?
        .get(&run_key(s, pid, &id)).is_some_and(|cancel| !cancel.load(Ordering::SeqCst));
    let pending = &session["execution"]["user_input"];
    if !active || session["status"] != "running" || session["execution"]["phase"] != "waiting_input"
        || pending["id"].as_str() != Some(strv(value, "request_id")?.as_str())
        || session["execution"].get("user_input_response").is_some() {
        return Err("此问题已回答或已失效，请刷新会话".into());
    }
    validate_answers(pending, &value["answers"])?;
    session["execution"]["user_input_response"] = json!({"answers":value["answers"]});
    save_session(c, &mut session)?;
    Ok(session)
}

pub(super) fn request(s: &AppState, pid: &str, session: &mut Value, args: &Value, web: bool,
    cfg: &Value, cancel: &AtomicBool, secrets: &[String]) -> Result<Value, String> {
    validate(args)?;
    // An approval must display exactly what will execute, without hidden/truncated fields.
    if safe_value(args, secrets, 0) != *args || args.to_string().len() > 24_000 {
        return Err("交互内容包含敏感或过长参数，请缩短内容；不要请求凭据".into());
    }
    let mut request = args.clone();
    request["id"] = json!(Uuid::new_v4().to_string());
    session["execution"]["user_input"] = request.clone();
    session["execution"]["phase"] = json!("waiting_input");
    session["messages"].as_array_mut().unwrap().last_mut().unwrap()["status"] = json!("waiting_input");
    progress(s, pid, session, cancel)?;
    let answers = loop {
        if cancel.load(Ordering::SeqCst) { return Err("执行已取消".into()); }
        {
            let _lock = s.guard.lock().map_err(|_| "项目数据锁不可用")?;
            // Poll only the small execution state; waiting must not repeatedly deserialize
            // a potentially multi-megabyte conversation or rebuild its context metadata.
            let (status, raw): (String, String) = db(s, pid)?.query_row(
                "SELECT status,execution FROM agent_sessions WHERE id=?",
                [session["id"].as_str().unwrap_or("")], |row| Ok((row.get(0)?, row.get(1)?)))
                .map_err(|_| "待回答会话已失效")?;
            let execution: Value = serde_json::from_str(&raw).map_err(|_| "待回答状态无效")?;
            if execution["user_input"]["id"] != request["id"] || status != "running" {
                return Err("用户问题已失效".into());
            }
            if let Some(response) = execution.get("user_input_response") {
                break response["answers"].clone();
            }
        }
        std::thread::sleep(Duration::from_millis(100));
    };
    session["execution"].as_object_mut().unwrap().remove("user_input");
    session["execution"].as_object_mut().unwrap().remove("user_input_response");
    session["execution"]["phase"] = json!("tool");
    let mut result = json!({"request_id":request["id"],"answers":answers});
    let trace = session["messages"].as_array_mut().unwrap().last_mut().unwrap();
    trace["status"] = json!("running");
    trace["content"] = json!(tool_content(&Ok(result.clone()), secrets));
    // Persist consumption before executing. Duplicate/stale submissions cannot replay a tool.
    progress(s, pid, session, cancel)?;
    if let Some(tool) = args.get("tool") {
        let approved = result["answers"][args["questions"][0]["id"].as_str().unwrap()] == true;
        result["approved"] = json!(approved);
        result["executed"] = json!(false);
        if approved {
            if cancel.load(Ordering::SeqCst) { return Err("执行已取消".into()); }
            session["execution"]["active_tool"] = tool["name"].clone();
            progress(s, pid, session, cancel)?;
            result["executed"] = json!(true);
            match agent_tools::execute(s, pid, tool["name"].as_str().unwrap(), &tool["arguments"], web, cfg) {
                Ok(value) => { result["tool_result"] = value; },
                Err(error) => { result["tool_error"] = json!(error); },
            }
        }
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn questions_and_answers_are_strict_and_bound_to_option_ids() {
        let request = json!({"questions":[
            {"id":"approve","question":"执行？","type":"confirmation"},
            {"id":"brief","question":"补充要求","type":"text"},
            {"id":"one","question":"选择一个","type":"single_select","options":[{"id":"a","label":"甲"},{"id":"b","label":"乙"}]},
            {"id":"many","question":"选择多个","type":"multi_select","options":[{"id":"a","label":"甲"},{"id":"b","label":"乙"}]}
        ]});
        validate(&request).unwrap();
        let answers = json!({"approve":false,"brief":"雨夜","one":"a","many":["a","b"]});
        validate_answers(&request,&answers).unwrap();
        for (key,value) in [("approve",json!("true")),("brief",json!(" ")),("one",json!("unknown")),
            ("many",json!([])),("many",json!(["a","a"])),("many",json!(["a","unknown"]))] {
            let mut invalid = answers.clone(); invalid[key] = value;
            assert!(validate_answers(&request,&invalid).is_err());
        }
        let mut extra = answers.clone();extra["other"]=json!(true);
        assert!(validate_answers(&request,&extra).is_err());
        let mut invalid = request.clone();invalid["questions"][1]["id"]=json!("approve");
        assert!(validate(&invalid).is_err());
        let mut invalid = request.clone();invalid["tool"]=json!({"name":"app_action","arguments":{}});
        assert!(validate(&invalid).is_err());
        assert!(validate(&json!({"questions":[]})).is_err());
    }
}
