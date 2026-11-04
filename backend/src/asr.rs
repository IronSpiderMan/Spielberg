use super::*;
use std::io::Read;

const MAX_BYTES: u64 = 25 * 1024 * 1024;
const QWEN_PATH: &str = "/api/v1/services/aigc/multimodal-generation/generation";

fn endpoint(config: &Value) -> Result<String, String> {
    let endpoint = match config["provider"].as_str() {
        Some("qianwen-token-plan") => format!("{}{QWEN_PATH}", qianwen_video::api_root(config)?),
        Some("openai") => {
            let base = config["base_url"].as_str().filter(|s| !s.trim().is_empty()).unwrap_or("https://api.openai.com/v1").trim().trim_end_matches('/');
            if base.ends_with("/audio/transcriptions") {base.into()} else if base.ends_with("/v1") {format!("{base}/audio/transcriptions")} else {format!("{base}/v1/audio/transcriptions")}
        },
        _ => return Err("请先配置 ASR 渠道和模型".into()),
    };
    let url = reqwest::Url::parse(&endpoint).map_err(|_| "ASR 服务地址无效")?;
    if !["http", "https"].contains(&url.scheme()) || url.host_str().is_none() || url.query().is_some() || url.fragment().is_some() || !url.username().is_empty() || url.password().is_some() {return Err("ASR 服务地址无效".into())}
    Ok(endpoint)
}

fn result_text(result: &Value, qwen: bool) -> Result<String, String> {
    let text = if qwen {result.pointer("/output/text").or_else(|| result.pointer("/output/sentence/text")).and_then(Value::as_str)} else {result["text"].as_str()};
    text.filter(|s| !s.trim().is_empty()).map(str::to_owned).ok_or_else(|| "服务未返回识别文本".into())
}

pub(super) fn transcribe(s: &AppState, v: &Value) -> Result<Value, String> {
    let pid = project_id(v)?;
    let c = db(s, &pid)?;
    let raw: Option<String> = c.query_row("SELECT value FROM settings WHERE key='models'", [], |r| r.get(0)).optional().map_err(|e| e.to_string())?;
    let settings: Value = serde_json::from_str(raw.as_deref().unwrap_or("{}")).map_err(|e| e.to_string())?;
    let config = generation_channels::resolve(&settings, v, "asr", "asr")?;
    let url = endpoint(&config)?;
    let (bytes, format, media_id) = if let Some(data) = v.get("audio_data_url") {
        let data = data.as_str().ok_or("录音数据须为字符串")?;
        let encoded = data.strip_prefix("data:audio/wav;base64,").ok_or("录音须为 WAV 格式")?;
        if encoded.len() > (MAX_BYTES as usize * 4 / 3 + 4) {return Err("录音超过 25 MB".into())}
        let bytes = base64::engine::general_purpose::STANDARD.decode(encoded).map_err(|_| "录音编码无效")?;
        if !bytes.starts_with(b"RIFF") || bytes.get(8..12) != Some(b"WAVE") {return Err("录音 WAV 数据无效".into())}
        (bytes, "wav".to_owned(), Value::Null)
    } else {
        let item = media(&c, Some(intv(v, "media_id")?)).ok_or("找不到音频素材")?;
        if item["kind"] != "audio" {return Err("请选择音频素材".into())}
        let path = PathBuf::from(strv(&item, "path")?);
        let format = path.extension().and_then(|s| s.to_str()).unwrap_or("").to_ascii_lowercase();
        if !["mp3", "wav", "m4a", "mp4", "mpeg", "mpga", "webm", "ogg", "flac"].contains(&format.as_str()) {return Err("不支持此音频格式".into())}
        let file = fs::File::open(&path).map_err(|e| format!("无法读取音频：{e}"))?;
        if file.metadata().map_err(|e| e.to_string())?.len() > MAX_BYTES {return Err("ASR 音频不能超过 25 MB".into())}
        let mut bytes = Vec::new();
        file.take(MAX_BYTES + 1).read_to_end(&mut bytes).map_err(|e| e.to_string())?;
        (bytes, format, item["id"].clone())
    };
    if bytes.is_empty() || bytes.len() as u64 > MAX_BYTES {return Err("音频为空或超过 25 MB".into())}
    let language = match v.get("language") {None => None, Some(Value::String(s)) if s.is_empty() => None, Some(Value::String(s)) if s.len() <= 16 && s.bytes().all(|b| b.is_ascii_alphabetic() || b == b'-') => Some(s.as_str()), _ => return Err("语言须为语言代码，如 zh 或 en".into())};
    let qwen = config["provider"] == "qianwen-token-plan";
    let key = config["api_key"].as_str().unwrap_or("").trim();
    if qwen && !key.starts_with("sk-sp-") {return Err("请配置 sk-sp- 开头的 Token Plan 专属 Key".into())}
    let client = generation_http::client_builder(&url).connect_timeout(std::time::Duration::from_secs(15)).timeout(std::time::Duration::from_secs(180)).build().map_err(|e| e.to_string())?;
    let mut req = client.post(&url);
    if qwen {
        let data = format!("data:audio/{format};base64,{}", base64::engine::general_purpose::STANDARD.encode(&bytes));
        let mut body = json!({"model":config["model"],"input":{"messages":[{"role":"user","content":[{"type":"input_audio","input_audio":{"data":data}}]}]},"parameters":{"format":format}});
        if let Some(lang) = language {body["parameters"]["language_hints"] = json!([lang]);}
        req = req.json(&body);
    } else {
        let part = reqwest::blocking::multipart::Part::bytes(bytes).file_name(format!("audio.{format}"));
        let mut form = reqwest::blocking::multipart::Form::new().text("model", strv(&config,"model")?).text("response_format", "json").part("file", part);
        if let Some(lang) = language {form = form.text("language", lang.to_string());}
        req = req.multipart(form);
    }
    if !key.is_empty() {req = req.bearer_auth(key);}
    let response = req.send().map_err(|e| generation_http::request_error_for(&e, &url, "语音识别"))?;
    let status = response.status();
    let mut body = Vec::new();
    response.take(2 * 1024 * 1024 + 1).read_to_end(&mut body).map_err(|_| "读取 ASR 响应失败")?;
    if body.len() > 2 * 1024 * 1024 {return Err("ASR 响应过大".into())}
    let result: Value = serde_json::from_slice(&body).map_err(|_| format!("ASR 返回无效 JSON（{status}）"))?;
    if !status.is_success() || result.get("error").is_some_and(|v| !v.is_null()) || result.get("code").is_some_and(|v| !v.is_null() && v != "" && v != "Success") {
        let message = result["error"]["message"].as_str().or_else(|| result["message"].as_str()).unwrap_or("服务请求失败");
        let message = if key.is_empty() {message.to_owned()} else {message.replace(key,"[已隐藏]")};
        return Err(format!("语音识别失败（{status}）：{}", message.chars().take(500).collect::<String>()));
    }
    Ok(json!({"text":result_text(&result,qwen)?,"media_id":media_id,"channel_id":config["_channel_id"],"model":config["model"]}))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn asr_routes_audio_to_selected_channel_and_tracks_text_results() {
        use std::{io::Write, net::TcpListener};
        for qwen in [false, true] {
            let root = std::env::temp_dir().join(format!("spielberg-asr-{}", Uuid::new_v4()));
            storage::initialize_root(&root).unwrap();
            let state = AppState {root:root.clone(),guard:std::sync::Arc::new(Mutex::new(()))};
            let pid = create_project(&state,&json!({"name":"ASR test"})).unwrap()["id"].as_str().unwrap().to_owned();
            let path = root.join("test.wav");
            fs::write(&path,b"RIFFxxxxWAVEaudio").unwrap();
            let c = db(&state,&pid).unwrap();
            c.execute("INSERT INTO media(name,path,kind,created_at) VALUES('test.wav',?,'audio','1')",[path.to_string_lossy().as_ref()]).unwrap();
            let mid=c.last_insert_rowid();
            let listener=TcpListener::bind("127.0.0.1:0").unwrap();
            let base=format!("http://{}",listener.local_addr().unwrap());
            let server=std::thread::spawn(move || {
                let (mut stream,_)=listener.accept().unwrap();
                stream.set_read_timeout(Some(std::time::Duration::from_secs(5))).unwrap();
                let mut bytes=Vec::new();let mut buf=[0;4096];
                let (headers,body)=loop {
                    let n=stream.read(&mut buf).unwrap(); assert!(n>0);bytes.extend_from_slice(&buf[..n]);
                    if let Some(end)=bytes.windows(4).position(|s|s==b"\r\n\r\n") {
                        let headers=String::from_utf8_lossy(&bytes[..end]).to_string();
                        let len:usize=headers.lines().find_map(|line|line.to_ascii_lowercase().strip_prefix("content-length:").map(|s|s.trim().parse().unwrap())).unwrap();
                        if bytes.len()>=end+4+len {break(headers,bytes[end+4..end+4+len].to_vec());}
                    }
                };
                let response=if qwen {json!({"output":{"text":"测试转写"}})} else {json!({"text":"测试转写"})}.to_string();
                write!(stream,"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",response.len(),response).unwrap();
                (headers,body)
            });
            let (provider,profile,model)=if qwen {("qianwen-token-plan","qwen-asr","qwen-audio-3.0-asr-flash")} else {("openai","openai-asr","custom-asr")};
            save_settings(&state,&json!({"project_id":pid,"settings":{"asr":{"channels":[{"id":"selected","name":"Selected","provider":provider,"base_url":base,"api_key":"sk-sp-fixture","models":[{"id":model,"profile":profile}]}]}}})).unwrap();
            let mut payload=json!({"project_id":pid,"media_id":mid,"language":"zh"});
            if qwen {payload["audio_data_url"]=json!(format!("data:audio/wav;base64,{}",base64::engine::general_purpose::STANDARD.encode(b"RIFFxxxxWAVEaudio")));}
            let result=rest::action(&state,if qwen {"/speech/transcribe"} else {"/generations/asr"},payload);
            let (headers,body)=server.join().unwrap();
            assert_eq!(result.unwrap()["text"],"测试转写");
            assert!(headers.to_ascii_lowercase().contains("authorization: bearer sk-sp-fixture"));
            if qwen {
                assert!(headers.starts_with(&format!("POST {QWEN_PATH} ")));
                let body:Value=serde_json::from_slice(&body).unwrap();
                assert_eq!(body["model"],model);assert_eq!(body["parameters"],json!({"format":"wav","language_hints":["zh"]}));
                assert_eq!(body["input"]["messages"][0]["content"][0]["input_audio"]["data"],format!("data:audio/wav;base64,{}",base64::engine::general_purpose::STANDARD.encode(b"RIFFxxxxWAVEaudio")));
            } else {
                assert!(headers.starts_with("POST /v1/audio/transcriptions "));
                let body=String::from_utf8(body).unwrap();
                assert!(body.contains("custom-asr"));assert!(body.contains("RIFFxxxxWAVEaudio"));assert!(body.contains("name=\"language\""));
            }
            if !qwen {
                let job: (String,String)=c.query_row("SELECT status,result_json FROM background_jobs",[],|r|Ok((r.get(0)?,r.get(1)?))).unwrap();
                assert_eq!(job.0,"completed");assert_eq!(serde_json::from_str::<Value>(&job.1).unwrap()["text"],"测试转写");
            } else {
                assert_eq!(c.query_row("SELECT COUNT(*) FROM background_jobs",[],|r|r.get::<_,i64>(0)).unwrap(),0);
            }
            assert!(rest::action(&state,"/generations/asr",json!({"project_id":pid,"media_id":mid,"channel_id":"missing"})).is_err());
            assert_eq!(c.query_row("SELECT COUNT(*) FROM media",[],|r|r.get::<_,i64>(0)).unwrap(),1);
            fs::remove_dir_all(root).unwrap();
        }
    }

    #[test]
    fn endpoints_and_responses_use_provider_protocols() {
        assert_eq!(endpoint(&json!({"provider":"openai","base_url":"https://example.com/v1"})).unwrap(),"https://example.com/v1/audio/transcriptions");
        assert_eq!(endpoint(&json!({"provider":"qianwen-token-plan","base_url":"https://example.com/compatible-mode/v1"})).unwrap(),format!("https://example.com{QWEN_PATH}"));
        assert!(endpoint(&json!({"provider":"openai","base_url":"ftp://example.com"})).is_err());
        assert_eq!(result_text(&json!({"text":"hello"}),false).unwrap(),"hello");
        assert_eq!(result_text(&json!({"output":{"sentence":{"text":"你好"}}}),true).unwrap(),"你好");
        assert!(result_text(&json!({"output":{}}),true).is_err());
        assert!(result_text(&json!({"text":" "}),false).is_err());
    }
}
