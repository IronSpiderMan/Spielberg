use super::*;

fn catalog() -> &'static Value {
    static CATALOG: std::sync::OnceLock<Value> = std::sync::OnceLock::new();
    CATALOG.get_or_init(|| serde_json::from_str(include_str!("../../src/generation-models.json")).expect("generation catalog"))
}

pub(super) fn profile(id: &str) -> Result<&'static Value, String> {
    catalog()["profiles"].get(id).ok_or_else(|| format!("未知模型能力配置：{id}"))
}

fn builtin(id: &str) -> Option<Value> {
    catalog()["models"].as_array()?.iter().find(|m| m["id"] == id).cloned()
}

fn llm_defaults(provider: &str) -> (&'static str, &'static str, &'static str) {
    match provider {
        "deepseek" => ("deepseek-chat", "deepseek-flash", "https://api.deepseek.com"),
        "qianwen-token-plan" => ("qwen-chat", "qwen3.8-max", "https://token-plan.maas.qianwenaiapi.com/compatible-mode/v1"),
        _ => ("openai-chat", "gpt-4o-mini", "https://api.openai.com/v1"),
    }
}

// Empty configuration remains readable so the Agent settings dialog can open before setup.
pub(super) fn llm_config(settings: &Value) -> Result<Value, String> {
    if settings["llm"]["channels"].as_array().is_some_and(Vec::is_empty) { return Ok(json!({})); }
    resolve(settings, &json!({}), "llm", "chat")
}

pub(super) fn normalize(settings: &Value) -> Value {
    let mut result = settings.clone();
    let llm = &settings["llm"];
    if llm.is_object() && llm.get("channels").is_none() && ["base_url", "url", "model", "api_key"].iter().any(|key| llm[*key].as_str().is_some_and(|s| !s.is_empty())) {
        let provider = llm["provider"].as_str().filter(|p| ["openai", "deepseek", "qianwen-token-plan"].contains(p)).unwrap_or("openai");
        let (profile, default_model, default_base) = llm_defaults(provider);
        let id = llm["model"].as_str().filter(|s| !s.is_empty()).unwrap_or(default_model);
        let base = llm["base_url"].as_str().filter(|s| !s.is_empty()).or_else(|| llm["url"].as_str().filter(|s| !s.is_empty())).unwrap_or(default_base);
        result["llm"]["channels"] = json!([{"id":"legacy-llm","name":"原 LLM 渠道","provider":provider,"base_url":base,"api_key":llm["api_key"].as_str().unwrap_or(""),"models":[{"id":id,"name":id,"profile":profile}],"default_model_id":id}]);
        result["llm"]["default_channel_id"] = json!("legacy-llm");
    }
    for (kind, operations) in [("image", vec!["t2i", "i2i"]), ("video", vec!["t2v", "i2v", "ref2v", "fl2v"])] {
        if settings[kind].get("channels").is_some() { continue }
        let shared = &settings[kind];
        let legacy = operations.iter().find_map(|op| settings.get(*op).filter(|v| !v["url"].as_str().unwrap_or("").is_empty()));
        let config = if shared.is_object() { shared } else { legacy.unwrap_or(&Value::Null) };
        let base = config["base_url"].as_str().filter(|s| !s.is_empty()).or_else(|| config["url"].as_str().filter(|s| !s.is_empty()))
            .or_else(|| legacy.and_then(|v| v["url"].as_str())).unwrap_or("");
        if base.is_empty() && config["provider"] != "qianwen-token-plan" { continue }
        let provider = config["provider"].as_str().unwrap_or("cast");
        let default = if kind == "image" { if provider == "openai" { "gpt-image-1" } else if provider == "qianwen-token-plan" { "qwen-image-3.0-pro" } else { "default" } }
            else if provider == "qianwen-token-plan" { "happyhorse-1.1-t2v" } else { "minimax-h3" };
        let id = config["model"].as_str().filter(|s| !s.is_empty()).unwrap_or(default);
        let mut models = vec![builtin(id).unwrap_or_else(|| json!({"id":id,"name":id,"profile":if kind=="image" {if provider=="openai"{"openai-image"}else{"cast-image"}}else{"runninghub-video"}}))];
        if kind == "video" && provider == "qianwen-token-plan" && id.starts_with("happyhorse-") {
            models = ["happyhorse-1.1-t2v", "happyhorse-1.1-i2v", "happyhorse-1.1-r2v"].iter().filter_map(|id|builtin(id)).collect();
        }
        let channel_id = format!("legacy-{kind}");
        let mut channel = json!({"id":channel_id,"name":if kind=="image"{"原图片渠道"}else{"原视频渠道"},"provider":provider,"base_url":base,
            "api_key":config["api_key"].as_str().or_else(||legacy.and_then(|v|v["api_key"].as_str())).unwrap_or(""),"models":models,"default_model_id":id});
        channel["resolution"] = config["resolution"].clone();
        if !shared.is_object() && provider == "cast" {
            for op in &operations {
                if let Some(old) = settings.get(*op).filter(|v| !v["url"].as_str().unwrap_or("").is_empty()) {
                    if !channel["operation_urls"].is_object() {channel["operation_urls"]=json!({});channel["operation_api_keys"]=json!({});}
                    channel["operation_urls"][*op]=old["url"].clone();channel["operation_api_keys"][*op]=old["api_key"].clone();
                }
            }
            if kind=="video" && channel["operation_urls"]["ref2v"].is_null() && !channel["operation_urls"]["i2v"].is_null(){
                channel["operation_urls"]["ref2v"]=channel["operation_urls"]["i2v"].clone();channel["operation_api_keys"]["ref2v"]=channel["operation_api_keys"]["i2v"].clone();
            }
        }
        if !result[kind].is_object() {result[kind]=json!({});}
        result[kind]["channels"]=json!([channel]);result[kind]["default_channel_id"]=json!(channel_id);
    }
    result
}

pub(super) fn validate_settings(settings: &Value) -> Result<(), String> {
    for kind in ["llm", "image", "video", "tts"] {
        let Some(channels) = settings[kind].get("channels") else {continue};
        let channels = channels.as_array().ok_or("channels 必须为数组")?;
        let mut ids = std::collections::HashSet::new();
        for channel in channels {
            let id = strv(channel,"id")?;if id.trim().is_empty() || !ids.insert(id) {return Err("渠道 ID 不能为空或重复".into())}
            if strv(channel,"name")?.trim().is_empty() {return Err("请填写渠道名称".into())}
            let provider = strv(channel,"provider")?;
            let models = channel["models"].as_array().ok_or("请配置渠道模型列表")?;
            if models.is_empty() {return Err("每个渠道至少需要一个模型".into())}
            let mut model_ids = std::collections::HashSet::new();
            for model in models {
                let id = strv(model,"id")?;
                if id.trim().is_empty() || !model_ids.insert(id.clone()) {return Err("同一渠道内的模型 ID 不能为空或重复".into())}
                let p = profile(&strv(model,"profile")?)?;
                if p["kind"]!=kind || !p["providers"].as_array().is_some_and(|xs|xs.contains(&json!(provider))) {return Err("模型能力配置与渠道类型不匹配".into())}
                if kind!="llm" && provider=="qianwen-token-plan" && !builtin(&id).is_some_and(|b| b["profile"]==model["profile"]) {return Err(format!("Token Plan 模型 ID 与能力不匹配：{id}"))}
            }
            if let Some(default) = channel["default_model_id"].as_str().filter(|s|!s.is_empty()) {
                if !model_ids.contains(default) {return Err("默认模型不在渠道模型列表中".into())}
            }
        }
        if let Some(id) = settings[kind]["default_channel_id"].as_str().filter(|s|!s.is_empty()) {
            if !ids.contains(id) {return Err("默认渠道不存在".into())}
        }
    }
    Ok(())
}

pub(super) fn resolve(settings: &Value, v: &Value, kind: &str, operation: &str) -> Result<Value, String> {
    for field in ["channel_id","model"] {if v.get(field).is_some_and(|x|!x.is_null()&&!x.is_string()){return Err(format!("{field} 必须是字符串"))}}
    let settings = normalize(settings);
    let Some(channels) = settings[kind]["channels"].as_array() else {
        if v.get("channel_id").is_some_and(|s|!s.is_null()) {return Err("所选渠道不存在，请重新选择".into())}
        return Ok(if settings[kind].is_object(){settings[kind].clone()}else{settings[operation].clone()});
    };
    let requested = v["channel_id"].as_str().filter(|s|!s.is_empty());
    let default = settings[kind]["default_channel_id"].as_str();
    let channel = if let Some(id)=requested {channels.iter().find(|c|c["id"]==id)}
        else {default.and_then(|id|channels.iter().find(|c|c["id"]==id)).or_else(||channels.first())}.ok_or("所选渠道不存在或尚未配置渠道")?;
    let models = channel["models"].as_array().ok_or("渠道没有模型")?;
    let requested_model = v["model"].as_str().filter(|s|!s.is_empty());
    let mode=if kind=="video" && operation=="i2v"{"fl2v"}else{operation};
    let supports = |m: &&Value| profile(m["profile"].as_str().unwrap_or("")).is_ok_and(|p|p["modes"].as_array().is_some_and(|xs|xs.contains(&json!(mode))));
    let model = if let Some(id)=requested_model {models.iter().find(|m|m["id"]==id)} else {
        models.iter().filter(supports).find(|m|channel["default_model_id"]==m["id"]).or_else(||models.iter().find(supports))
    }.ok_or("所选模型不在渠道中，或渠道没有支持当前生成方式的模型")?;
    let mut config=channel.clone();config["model"]=model["id"].clone();config["_model_profile"]=model["profile"].clone();config["_channel_id"]=channel["id"].clone();
    if let Some(url)=channel["operation_urls"][operation].as_str() {config["base_url"]=json!(url);config["api_key"]=channel["operation_api_keys"][operation].clone();}
    if let Some(url)=model["base_url"].as_str().filter(|s|!s.trim().is_empty()){config["base_url"]=json!(url.trim());}
    config["send_model"]=model["send_model"].clone();
    if kind == "llm" {
        let (_, _, default_base) = llm_defaults(config["provider"].as_str().unwrap_or("openai"));
        let mut base = config["base_url"].as_str().filter(|s| !s.trim().is_empty()).unwrap_or(default_base).trim().trim_end_matches('/').to_string();
        if config["provider"] == "qianwen-token-plan" && reqwest::Url::parse(&base).is_ok_and(|u| u.path().is_empty() || u.path() == "/") {
            base.push_str("/compatible-mode/v1");
        }
        config["base_url"] = json!(base);
    } else {
        validate_request(&config,v,operation)?;
    }
    Ok(config)
}

pub(super) fn validate_request(config: &Value, v: &Value, operation: &str) -> Result<(), String> {
    let Some(id)=config["_model_profile"].as_str() else {return Ok(())};let p=profile(id)?;
    let mode=if p["kind"]=="video"&&operation=="i2v"{"fl2v"}else{operation};
    if !p["modes"].as_array().is_some_and(|xs|xs.contains(&json!(mode))) {return Err("所选模型不支持当前生成方式，请切换模型或生成方式".into())}
    if opti(v,"last_media_id").is_some() && p["last_frame"]!=true {return Err("所选模型不支持尾帧".into())}
    if v["mask_data_url"].as_str().is_some_and(|s|!s.is_empty()) && p["mask"]!=true {return Err("所选模型不支持蒙版，请切换模型或清除蒙版".into())}
    for (key,limit) in [("image_media_ids","max_images"),("reference_video_media_ids","max_videos"),("reference_audio_media_ids","max_audios")] {
        let count=reference_media_ids(v,key)?.len() as u64;
        if count>p[limit].as_u64().unwrap_or(0) {return Err(format!("所选模型的 {key} 上限为 {}",p[limit].as_u64().unwrap_or(0)))}
    }
    if p["kind"]=="video" {
        let duration=v.get("duration").map(|d|d.as_i64().ok_or("时长须为整数")).transpose()?.unwrap_or(5);
        if !(duration==-1&&p["smart_duration"]==true) && !(p["min_duration"].as_i64().unwrap_or(3)..=p["max_duration"].as_i64().unwrap_or(15)).contains(&duration) {return Err("时长超出所选模型支持的范围".into())}
        if v.get("audio").is_some() && p["audio"]!=true {return Err("所选模型不支持声音开关".into())}
        if p["size_mode"]=="resolution" {
            let resolution=v["resolution"].as_str().or_else(||config["resolution"].as_str()).unwrap_or("720P");
            if !p["resolutions"].as_array().is_some_and(|xs|xs.contains(&json!(resolution))) {return Err("所选模型不支持此分辨率".into())}
        }
    }
    if operation!="fl2v" {
        if let (Some(ratios),Some(ratio))=(p["ratios"].as_array(),v["aspect_ratio"].as_str()) {if !ratios.contains(&json!(ratio)) && !(p["size_mode"]=="openai" && ["16:9","9:16"].contains(&ratio)) {return Err("所选模型不支持此画幅".into())}}
    }
    Ok(())
}

pub(super) fn image_size(v: &Value, config: &Value) -> Result<String,String> {
    let p=profile(config["_model_profile"].as_str().unwrap_or("qwen-image"))?;
    let ratio=v["aspect_ratio"].as_str().unwrap_or("16:9");
    let default=match ratio {"9:16"=>"768x1344","1:1"=>"1024x1024","3:2"=>"1536x1024","2:3"=>"1024x1536",_=>"1344x768"};
    let size=v["size"].as_str().unwrap_or(default);
    let (w,h)=size.split_once('x').or_else(||size.split_once('*')).and_then(|(w,h)|Some((w.parse::<u64>().ok()?,h.parse::<u64>().ok()?))).ok_or("图片尺寸须为宽×高像素")?;
    let pixels=w.checked_mul(h).ok_or("图片尺寸过大")?;
    if w==0||h==0||pixels<p["min_pixels"].as_u64().unwrap_or(1)||pixels>p["max_pixels"].as_u64().unwrap_or(16777216)||w>h.saturating_mul(8)||h>w.saturating_mul(8) {return Err("图片尺寸超出所选模型范围".into())}
    if config["model"]=="wan2.7-image-pro" && v["operation"]=="i2i" && pixels>4194304 {return Err("Wan Image Pro 图生图最多支持 2K 像素面积".into())}
    Ok(format!("{w}*{h}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn channel(id:&str,provider:&str,models:Value)->Value {json!({"id":id,"name":id,"provider":provider,"base_url":format!("https://{id}.example.com"),"api_key":format!("fixture-{id}"),"models":models})}
    fn settings()->Value {json!({"image":{"default_channel_id":"a","channels":[
        channel("a","openai",json!([{"id":"model-a","name":"A","profile":"openai-image"}])),
        channel("b","qianwen-token-plan",json!([{"id":"qwen-image-3.0-pro","name":"Qwen","profile":"qwen-image"},{"id":"wan2.7-image-pro","name":"Wan","profile":"wan-image-pro"}]))
    ]},"video":{"channels":[channel("video","qianwen-token-plan",json!([
        {"id":"wan3.0-video","name":"Wan","profile":"wan3-video"},
        {"id":"happyhorse-1.1-i2v","name":"First","profile":"happyhorse-i2v"},
        {"id":"happyhorse-1.1-r2v","name":"Refs","profile":"happyhorse-r2v"}
    ]))]}})}

    #[test]
    fn llm_migration_selection_and_deletion_preserve_channel_boundaries() {
        let old=json!({"llm":{"url":"http://local.example/v1/chat/completions","model":"my-model","api_key":"old-key"}});
        let normalized=normalize(&old);
        assert_eq!(normalize(&normalized),normalized);
        validate_settings(&normalized).unwrap();
        let legacy=llm_config(&old).unwrap();
        assert_eq!(legacy["base_url"],old["llm"]["url"]);
        assert_eq!(legacy["model"],"my-model");assert_eq!(legacy["api_key"],"old-key");
        let mut settings=json!({"llm":{"default_channel_id":"deepseek","channels":[
            channel("openai","openai",json!([{"id":"custom","profile":"openai-chat"}])),
            channel("deepseek","deepseek",json!([{"id":"deepseek-flash","profile":"deepseek-chat"}])),
            channel("qwen","qianwen-token-plan",json!([{"id":"custom-qwen","profile":"qwen-chat"}]))
        ]}});
        validate_settings(&settings).unwrap();
        assert_eq!(llm_config(&settings).unwrap()["api_key"],"fixture-deepseek");
        settings["llm"]["channels"][2]["base_url"]=json!("https://token-plan.maas.qianwenaiapi.com/");
        let selected=resolve(&settings,&json!({"channel_id":"qwen"}),"llm","chat").unwrap();
        assert_eq!(selected["base_url"],"https://token-plan.maas.qianwenaiapi.com/compatible-mode/v1");
        assert_eq!(selected["api_key"],"fixture-qwen");assert_eq!(selected["model"],"custom-qwen");
        assert!(resolve(&settings,&json!({"channel_id":"missing"}),"llm","chat").is_err());
        assert!(resolve(&settings,&json!({"channel_id":"qwen","model":"custom"}),"llm","chat").is_err());
        settings["llm"]["channels"][1]["models"][0]["profile"]=json!("openai-chat");
        assert!(validate_settings(&settings).is_err());
        let deleted=json!({"llm":{"base_url":"https://old.example/v1","api_key":"old-key","model":"old","channels":[],"default_channel_id":""}});
        assert!(llm_config(&deleted).unwrap()["api_key"].is_null());
        assert!(resolve(&deleted,&json!({}),"llm","chat").is_err());
    }

    #[test]
    fn prompt_requests_use_the_default_llm_channel_credentials_and_model() {
        use std::io::{Read, Write};
        use std::net::TcpListener;
        for (provider, profile, model) in [("openai","openai-chat","custom-openai"),("deepseek","deepseek-chat","deepseek-flash"),("qianwen-token-plan","qwen-chat","qwen3.8-max")] {
            let root=std::env::temp_dir().join(format!("spielberg-llm-{}",Uuid::new_v4()));
            storage::initialize_root(&root).unwrap();
            let state=AppState{root:root.clone(),guard:std::sync::Arc::new(Mutex::new(()))};
            let project=create_project(&state,&json!({"name":"LLM routing"})).unwrap();
            let listener=TcpListener::bind("127.0.0.1:0").unwrap();
            let address=listener.local_addr().unwrap();
            let server=std::thread::spawn(move || {
                let (mut stream,_)=listener.accept().unwrap();
                stream.set_read_timeout(Some(std::time::Duration::from_secs(5))).unwrap();
                let mut bytes=Vec::new();let mut buffer=[0;4096];
                let (headers,body)=loop {
                    let count=stream.read(&mut buffer).unwrap();assert!(count>0);bytes.extend_from_slice(&buffer[..count]);
                    if let Some(end)=bytes.windows(4).position(|s|s==b"\r\n\r\n") {
                        let headers=String::from_utf8_lossy(&bytes[..end]).to_string();
                        let len:usize=headers.lines().find_map(|line|line.to_ascii_lowercase().strip_prefix("content-length:").map(|s|s.trim().parse().unwrap())).unwrap();
                        if bytes.len()>=end+4+len {break (headers,serde_json::from_slice::<Value>(&bytes[end+4..end+4+len]).unwrap());}
                    }
                };
                let response=json!({"choices":[{"message":{"content":"optimized prompt"}}]}).to_string();
                write!(stream,"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",response.len(),response).unwrap();
                (headers,body)
            });
            let base=if provider=="qianwen-token-plan" {format!("http://{address}/compatible-mode/v1")} else {format!("http://{address}/v1")};
            let settings=json!({"llm":{"base_url":"http://127.0.0.1:9","api_key":"stale-key","model":"stale-model","default_channel_id":"selected","channels":[
                {"id":"unused","name":"Unused","provider":"openai","base_url":"http://127.0.0.1:9","api_key":"unused-key","models":[{"id":"unused","profile":"openai-chat"}]},
                {"id":"selected","name":"Selected","provider":provider,"base_url":base,"api_key":"selected-key","default_model_id":model,"models":[{"id":model,"profile":profile}]}
            ]}});
            save_settings(&state,&json!({"project_id":project["id"],"settings":settings})).unwrap();
            let result=optimize_prompt(&state,&json!({"project_id":project["id"],"prompt":"test"}));
            let (headers,body)=server.join().unwrap();
            assert_eq!(result.unwrap()["prompt"],"optimized prompt");
            assert!(headers.starts_with(if provider=="qianwen-token-plan" {"POST /compatible-mode/v1/chat/completions "} else {"POST /v1/chat/completions "}));
            assert!(headers.to_ascii_lowercase().contains("authorization: bearer selected-key"));
            assert_eq!(body["model"],model);assert_eq!(body["messages"][1]["content"],"test");
            fs::remove_dir_all(root).unwrap();
        }
    }

    #[test]
    fn routes_only_to_the_selected_channel_and_model() {
        let s=settings();validate_settings(&s).unwrap();
        let chosen=resolve(&s,&json!({"channel_id":"b","model":"wan2.7-image-pro"}),"image","t2i").unwrap();
        assert_eq!(chosen["api_key"],"fixture-b");assert_eq!(chosen["base_url"],"https://b.example.com");assert_eq!(chosen["model"],"wan2.7-image-pro");
        assert_eq!(resolve(&s,&json!({}),"image","t2i").unwrap()["model"],"model-a");
        assert!(resolve(&s,&json!({"channel_id":"missing"}),"image","t2i").is_err());
        assert!(resolve(&s,&json!({"channel_id":"b","model":"model-a"}),"image","t2i").is_err());
    }

    #[test]
    fn legacy_urls_keys_and_defaults_are_preserved_without_mutating_input() {
        let old=json!({"t2v":{"url":"http://text:8190/v1/generations/t2v","api_key":"fixture-text"},"i2v":{"url":"http://refs:8190/v1/generations/i2v","api_key":"fixture-refs"}});
        let normalized=normalize(&old);assert!(old.get("video").is_none());assert_eq!(normalize(&normalized),normalized);
        let config=resolve(&old,&json!({}),"video","ref2v").unwrap();
        assert_eq!(config["base_url"],"http://refs:8190/v1/generations/i2v");assert_eq!(config["api_key"],"fixture-refs");
        let token=json!({"video":{"provider":"qianwen-token-plan","model":"happyhorse-1.1-t2v","api_key":"sk-sp-fixture"}});
        assert_eq!(resolve(&token,&json!({}),"video","fl2v").unwrap()["model"],"happyhorse-1.1-i2v");
    }

    #[test]
    fn rejects_invalid_settings_before_they_replace_saved_configuration() {
        let mut s=settings();s["image"]["channels"][1]["id"]=json!("a");assert!(validate_settings(&s).is_err());
        let mut s=settings();s["video"]["channels"][0]["models"][0]["profile"]=json!("openai-image");assert!(validate_settings(&s).is_err());
        let mut s=settings();s["video"]["channels"][0]["models"][0]["id"]=json!("guessed-model");assert!(validate_settings(&s).is_err());
        let mut s=settings();s["image"]["channels"]=json!([]);s["image"]["default_channel_id"]=json!("");validate_settings(&s).unwrap();assert!(resolve(&s,&json!({}),"image","t2i").is_err());
    }

    #[test]
    fn validates_capabilities_and_never_silently_changes_an_explicit_model() {
        let s=settings();let payload=json!({"channel_id":"video","model":"happyhorse-1.1-i2v","first_media_id":1,"last_media_id":2});
        assert!(resolve(&s,&payload,"video","fl2v").unwrap_err().contains("尾帧"));
        assert!(resolve(&s,&json!({"model":"happyhorse-1.1-r2v","reference_audio_media_ids":[3]}),"video","ref2v").is_err());
        assert!(resolve(&s,&json!({"model":"happyhorse-1.1-i2v"}),"video","t2v").is_err());
        assert!(resolve(&s,&json!({"model":"wan3.0-video","duration":30,"audio":false}),"video","t2v").is_ok());
        assert!(resolve(&s,&json!({"model":"wan3.0-video","duration":-1}),"video","t2v").is_ok());
        assert!(resolve(&s,&json!({"model":"wan3.0-video","duration":31}),"video","t2v").is_err());
        assert!(resolve(&s,&json!({"channel_id":"b","mask_data_url":"data:image/png;base64,test"}),"image","i2i").is_err());
        let config=resolve(&s,&json!({"channel_id":"b","model":"wan2.7-image-pro"}),"image","t2i").unwrap();
        assert_eq!(image_size(&json!({"operation":"t2i","size":"4096x4096"}),&config).unwrap(),"4096*4096");
        assert!(image_size(&json!({"operation":"i2i","size":"4096x4096"}),&config).is_err());
    }

    #[test]
    fn model_service_override_and_wire_model_are_opt_in() {
        let s=json!({"video":{"channels":[channel("local","cast",json!([
            {"id":"one","name":"one","profile":"runninghub-video"},
            {"id":"two","name":"two","profile":"runninghub-video","base_url":"http://local:9999","send_model":true}
        ]))]}});
        let one=resolve(&s,&json!({"model":"one"}),"video","t2v").unwrap();assert!(one["send_model"].is_null());
        let two=resolve(&s,&json!({"model":"two"}),"video","t2v").unwrap();assert_eq!(two["base_url"],"http://local:9999");assert_eq!(two["send_model"],true);
    }
}
