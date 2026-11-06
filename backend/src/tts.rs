use super::*;
use std::io::Read;

const QWEN_PATH: &str = "/api/v1/services/audio/tts/SpeechSynthesizer";
const MAX_AUDIO_BYTES: u64 = 50 * 1024 * 1024;

fn read_audio_response(response: reqwest::blocking::Response) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    response.take(MAX_AUDIO_BYTES + 1).read_to_end(&mut bytes).map_err(|e| format!("读取合成音频失败：{e}"))?;
    if bytes.len() as u64 > MAX_AUDIO_BYTES {return Err("合成音频超过 50 MB".into())}
    Ok(bytes)
}

fn response_error(status: reqwest::StatusCode, result: &Value, key: &str) -> String {
    let message = result["error"]["message"].as_str().or_else(|| result["message"].as_str()).unwrap_or("服务未返回音频");
    let code = result["code"].as_str().or_else(|| result["error"]["code"].as_str()).unwrap_or("");
    let message = if key.is_empty() {message.to_string()} else {message.replace(key, "[已隐藏]")};
    let code = if key.is_empty() {code.to_string()} else {code.replace(key, "[已隐藏]")};
    format!("语音合成失败（{status}）：{} {}", code.chars().take(100).collect::<String>(), message.chars().take(500).collect::<String>())
}

fn audio_bytes(response: reqwest::blocking::Response, config: &Value, key: &str) -> Result<Vec<u8>, String> {
    let status = response.status();
    let is_json = response.headers().get(reqwest::header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).is_some_and(|v| v.to_ascii_lowercase().contains("json"));
    let bytes = read_audio_response(response)?;
    let looks_json = bytes.iter().find(|b| !b.is_ascii_whitespace()) == Some(&b'{');
    if !status.is_success() || is_json || looks_json {
        let result: Value = serde_json::from_slice(&bytes).map_err(|_| format!("语音合成响应无效（{status}）：无法解析 JSON"))?;
        if !status.is_success() || result.get("error").is_some_and(|v| !v.is_null()) || result.get("code").is_some_and(|v| !v.is_null() && v != "" && v != "Success") {
            return Err(response_error(status, &result, key));
        }
        if config["provider"] != "qianwen-token-plan" {return Err(response_error(status, &result, key))}
        // Qwen's non-streaming response contains a temporary audio URL, not the file.
        let raw = result["output"]["audio"]["url"].as_str().filter(|s| !s.trim().is_empty()).ok_or("千问语音响应缺少音频下载地址 output.audio.url")?;
        let url = reqwest::Url::parse(raw).map_err(|_| "千问音频下载地址无效")?;
        if !["http", "https"].contains(&url.scheme()) || url.host_str().is_none() || !url.username().is_empty() || url.password().is_some() {
            return Err("千问音频下载地址无效".into());
        }
        // The signed result URL is independent of the API endpoint. Never forward its API key.
        let client = generation_http::client_builder(raw).connect_timeout(std::time::Duration::from_secs(15)).timeout(std::time::Duration::from_secs(120)).build().map_err(|e| e.to_string())?;
        let response = client.get(url).send().map_err(|e| format!("下载合成音频失败：{}", e.without_url()))?;
        if !response.status().is_success() {return Err(format!("下载合成音频失败（{}）", response.status()))}
        return read_audio_response(response);
    }
    Ok(bytes)
}

fn request(config: &Value, v: &Value) -> Result<(String, Value, String), String> {
    let p = generation_channels::profile(config["_model_profile"].as_str().ok_or("请先配置 TTS 渠道和模型")?)?;
    let text = strv(v, "text")?;
    if text.trim().is_empty() || text.chars().count() > p["max_text"].as_u64().unwrap_or(4096) as usize {
        return Err("合成文本不能为空，且最多 4096 字符".into());
    }
    let string = |key: &str, default: &str| -> Result<String, String> {
        match v.get(key) {
            None => Ok(default.into()),
            Some(Value::String(s)) if !s.trim().is_empty() => Ok(s.trim().into()),
            _ => Err(format!("{key} 必须是非空字符串")),
        }
    };
    let voice = string("voice", p["default_voice"].as_str().unwrap_or("alloy"))?;
    let format = string("format", "mp3")?;
    if !p["formats"].as_array().is_some_and(|xs| xs.contains(&json!(format))) {
        return Err("TTS 音频格式须为 mp3 或 wav".into());
    }
    let mut body;
    let endpoint;
    if config["provider"] == "qianwen-token-plan" {
        if v.get("speed").is_some() || v.get("instructions").is_some() {
            return Err("QwenTokenPlan 暂不支持语速和风格指令参数".into());
        }
        let mut root_config = config.clone();
        if let Some(base) = config["base_url"].as_str().and_then(|s| s.trim().trim_end_matches('/').strip_suffix(QWEN_PATH)) {
            root_config["base_url"] = json!(base);
        }
        endpoint = format!("{}{QWEN_PATH}", qianwen_video::api_root(&root_config)?);
        body = json!({"model":config["model"],"input":{"text":text,"voice":voice,"format":format,"sample_rate":24000}});
    } else if config["provider"] == "openai" {
        let base = config["base_url"].as_str().filter(|s| !s.trim().is_empty()).unwrap_or("https://api.openai.com/v1").trim().trim_end_matches('/');
        endpoint = if base.ends_with("/audio/speech") {base.into()} else if base.ends_with("/v1") {format!("{base}/audio/speech")} else {format!("{base}/v1/audio/speech")};
        body = json!({"model":config["model"],"input":text,"voice":voice,"response_format":format});
        if let Some(speed) = v.get("speed") {
            let speed = speed.as_f64().filter(|n| (0.25..=4.0).contains(n)).ok_or("语速须为 0.25–4 的数字")?;
            body["speed"] = json!(speed);
        }
        if let Some(instructions) = v.get("instructions") {
            if p["instructions"] != true {return Err("所选模型不支持风格指令".into())}
            let instructions = instructions.as_str().filter(|s| s.chars().count() <= 4096).ok_or("风格指令须为字符串且最多 4096 字符")?;
            body["instructions"] = json!(instructions);
        }
    } else {return Err("不支持此 TTS 渠道类型".into())}
    let url = reqwest::Url::parse(&endpoint).map_err(|_| "TTS 服务地址无效")?;
    if !["http", "https"].contains(&url.scheme()) || url.host_str().is_none() || url.query().is_some() || url.fragment().is_some() || !url.username().is_empty() || url.password().is_some() {
        return Err("TTS 服务地址无效".into());
    }
    Ok((endpoint, body, format))
}

struct SynthesizedAudio {
    bytes: Vec<u8>,
    format: String,
    channel_id: Value,
    model: Value,
}

fn synthesize_audio(s: &AppState, v: &Value) -> Result<SynthesizedAudio, String> {
    let pid = project_id(v)?;
    let c = db(s, &pid)?;
    let raw: Option<String> = c.query_row("SELECT value FROM settings WHERE key='models'", [], |r| r.get(0)).optional().map_err(|e| e.to_string())?;
    let settings: Value = serde_json::from_str(raw.as_deref().unwrap_or("{}")).map_err(|e| e.to_string())?;
    let config = generation_channels::resolve(&settings, v, "tts", "tts")?;
    let (url, body, format) = request(&config, v)?;
    let key = config["api_key"].as_str().unwrap_or("").trim();
    if config["provider"] == "qianwen-token-plan" && !key.starts_with("sk-sp-") {return Err("请配置 sk-sp- 开头的 Token Plan 专属 Key".into())}
    let client = generation_http::client_builder(&url).connect_timeout(std::time::Duration::from_secs(15)).timeout(std::time::Duration::from_secs(180)).build().map_err(|e| e.to_string())?;
    let mut req = client.post(&url).json(&body);
    if !key.is_empty() {req = req.bearer_auth(key);}
    let response = req.send().map_err(|e| generation_http::request_error_for(&e, &url, "语音合成"))?;
    let bytes = audio_bytes(response, &config, key)?;
    let valid = if format == "wav" {bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WAVE")} else {bytes.starts_with(b"ID3") || (bytes.first() == Some(&0xff) && bytes.get(1).is_some_and(|b| b & 0xe0 == 0xe0))};
    if !valid {return Err("服务返回了空文件或无效音频".into())}
    Ok(SynthesizedAudio { bytes, format, channel_id: config["_channel_id"].clone(), model: config["model"].clone() })
}

// Assistant read-aloud is ephemeral: it shares provider validation with generation,
// but does not add a media file, background job, or project revision.
pub(super) fn synthesize(s: &AppState, v: &Value) -> Result<Value, String> {
    let audio = synthesize_audio(s, v)?;
    let mime = if audio.format == "wav" { "audio/wav" } else { "audio/mpeg" };
    Ok(json!({
        "audio_data_url": format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(audio.bytes)),
        "channel_id": audio.channel_id,
        "model": audio.model,
    }))
}

pub(super) fn generate(s: &AppState, v: &Value) -> Result<Value, String> {
    let pid = project_id(v)?;
    let SynthesizedAudio { bytes, format, .. } = synthesize_audio(s, v)?;
    let c = db(s, &pid)?;
    let dir = PathBuf::from(strv(&project(s, &pid)?, "path")?).join("assets/audios");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let out = dir.join(format!("{}.{format}", Uuid::new_v4()));
    fs::write(&out, bytes).map_err(|e| e.to_string())?;
    let name = format!("TTS-{}.{format}", now());
    let created = now();
    if let Err(e) = c.execute("INSERT INTO media(name,path,kind,created_at) VALUES(?,?,'audio',?)", params![name, out.to_string_lossy(), created]) {
        let _ = fs::remove_file(&out);
        return Err(e.to_string());
    }
    let id = c.last_insert_rowid();
    let _guard = s.guard.lock().map_err(|_| "本地数据锁不可用")?;
    touch(s, &pid);
    Ok(json!({"id":id,"name":name,"path":out,"kind":"audio","created_at":created}))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{io::Write, net::TcpListener, time::{Duration, Instant}};

    struct Fixture { state: AppState, pid: String }
    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!("spielberg-tts-{}", Uuid::new_v4()));
            storage::initialize_root(&root).unwrap();
            let state = AppState {root, guard: std::sync::Arc::new(Mutex::new(()))};
            let pid = strv(&create_project(&state, &json!({"name":"TTS fixture"})).unwrap(), "id").unwrap();
            Self {state, pid}
        }
        fn configure(&self, base: &str) {
            let settings = json!({"tts":{"default_channel_id":"openai","channels":[
                {"id":"openai","name":"OpenAI","provider":"openai","base_url":base,"api_key":"fixture-openai","default_model_id":"custom-tts","models":[{"id":"custom-tts","profile":"openai-tts-instruct"}]},
                {"id":"qwen","name":"QwenTokenPlan","provider":"qianwen-token-plan","base_url":format!("{base}/compatible-mode/v1"),"api_key":"sk-sp-fixture","models":[{"id":"qwen-audio-3.0-tts-plus","profile":"qwen-tts"}]}
            ]}});
            save_settings(&self.state, &json!({"project_id":self.pid,"settings":settings})).unwrap();
            assert_eq!(snapshot(&self.state, &self.pid).unwrap()["settings"]["tts"], settings["tts"]);
        }
        fn run(&self, mut v: Value) -> Result<Value, String> {
            v["project_id"] = json!(self.pid);
            rest::action(&self.state, "/generations/tts", v).map_err(|e| format!("{e:?}"))
        }
        fn speak(&self, mut v: Value) -> Result<Value, String> {
            v["project_id"] = json!(self.pid);
            rest::action(&self.state, "/speech/synthesize", v).map_err(|e| format!("{e:?}"))
        }
        fn assert_no_speech_artifacts(&self) {
            let c = db(&self.state, &self.pid).unwrap();
            for table in ["media", "background_jobs"] {
                assert_eq!(c.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get::<_, i64>(0)).unwrap(), 0);
            }
            let directory = PathBuf::from(project(&self.state, &self.pid).unwrap()["path"].as_str().unwrap()).join("assets/audios");
            assert_eq!(fs::read_dir(directory).map(|entries| entries.count()).unwrap_or(0), 0);
        }
    }
    impl Drop for Fixture {fn drop(&mut self) {let _ = fs::remove_dir_all(&self.state.root);}}

    fn server(status: u16, mime: &'static str, body: Vec<u8>) -> (String, std::thread::JoinHandle<(String, Value)>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let worker = std::thread::spawn(move || {
            let deadline = Instant::now() + Duration::from_secs(10);
            let mut stream = loop {
                match listener.accept() {
                    Ok((stream, _)) => break stream,
                    Err(e) if e.kind() == std::io::ErrorKind::WouldBlock && Instant::now() < deadline => std::thread::sleep(Duration::from_millis(10)),
                    Err(e) => panic!("TTS mock did not receive request: {e}"),
                }
            };
            stream.set_read_timeout(Some(Duration::from_secs(3))).unwrap();
            let mut data = Vec::new();
            let (header, request) = loop {
                let mut chunk = [0; 4096];
                let n = stream.read(&mut chunk).unwrap();
                assert!(n > 0);data.extend_from_slice(&chunk[..n]);
                if let Some(at) = data.windows(4).position(|w| w == b"\r\n\r\n") {
                    let header = String::from_utf8_lossy(&data[..at]).into_owned();
                    let len: usize = header.lines().find_map(|l| l.to_ascii_lowercase().strip_prefix("content-length:").map(|s| s.trim().parse().unwrap())).unwrap_or(0);
                    if data.len() >= at + 4 + len {break (header, if len == 0 {Value::Null} else {serde_json::from_slice::<Value>(&data[at+4..at+4+len]).unwrap()});}
                }
            };
            write!(stream,"HTTP/1.1 {status} Mock\r\nContent-Type: {mime}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",body.len()).unwrap();
            stream.write_all(&body).unwrap();
            (header, request)
        });
        (base, worker)
    }

    #[test]
    fn tts_routes_both_protocols_and_persists_audio_and_jobs() {
        let f = Fixture::new();
        for channel in ["openai", "qwen"] {
            let format = if channel == "openai" {"mp3"} else {"wav"};
            let audio = if format == "mp3" {b"ID3\x04\x00\x00\x00\x00\x00\x00fixture".to_vec()}
                else {b"RIFF\x26\x00\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00\xc0\x5d\x00\x00\x80\xbb\x00\x00\x02\x00\x10\x00data\x02\x00\x00\x00\x00\x00".to_vec()};
            let (base, worker) = server(200, "application/octet-stream", audio.clone());
            f.configure(&base);
            let mut v = json!({"text":"你好，世界。","channel_id":channel,"format":format});
            if channel == "openai" {v["speed"] = json!(1.25);v["instructions"] = json!("平静地讲述");}
            let result = f.run(v).unwrap();
            assert_eq!(result["kind"], "audio");
            assert_eq!(fs::read(result["path"].as_str().unwrap()).unwrap(), audio);
            let (header, body) = worker.join().unwrap();
            if channel == "openai" {
                assert!(header.starts_with("POST /v1/audio/speech "));
                assert!(header.contains("Bearer fixture-openai"));
                assert_eq!(body, json!({"model":"custom-tts","input":"你好，世界。","voice":"alloy","response_format":"mp3","speed":1.25,"instructions":"平静地讲述"}));
            } else {
                assert!(header.starts_with(&format!("POST {QWEN_PATH} ")));
                assert!(header.contains("Bearer sk-sp-fixture"));
                assert_eq!(body, json!({"model":"qwen-audio-3.0-tts-plus","input":{"text":"你好，世界。","voice":"longanhuan_v3.6","format":"wav","sample_rate":24000}}));
            }
            let c = db(&f.state, &f.pid).unwrap();
            assert_eq!(media(&c, result["id"].as_i64()).unwrap(), result);
            let (status, prompt): (String, String) = c.query_row("SELECT status,prompt FROM background_jobs ORDER BY id DESC LIMIT 1", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
            assert_eq!(status, "completed");assert_eq!(prompt, "你好，世界。");
        }
    }

    #[test]
    fn speech_synthesis_routes_explicit_selection_without_saving_media_or_jobs() {
        let f = Fixture::new();
        for format in ["mp3", "wav"] {
            let audio = if format == "mp3" { b"ID3fixture".to_vec() } else { b"RIFFxxxxWAVEfixture".to_vec() };
            let (base, worker) = server(200, "application/octet-stream", audio.clone());
            let settings = json!({"tts":{"default_channel_id":"unused","channels":[
                {"id":"unused","name":"Unused","provider":"openai","base_url":"http://127.0.0.1:9","models":[{"id":"unused","profile":"openai-tts"}]},
                {"id":"selected","name":"Selected","provider":"openai","base_url":base,"api_key":"fixture-selected","default_model_id":"default-model","models":[
                    {"id":"default-model","profile":"openai-tts"},{"id":"selected-model","profile":"openai-tts"}
                ]}
            ]}});
            save_settings(&f.state, &json!({"project_id":f.pid,"settings":settings})).unwrap();
            let revisions = snapshot(&f.state, &f.pid).unwrap()["revisions"].clone();
            let result = f.speak(json!({"text":"回复朗读。","channel_id":"selected","model":"selected-model","voice":"yunxi","speed":1.2,"format":format})).unwrap();
            let mime = if format == "wav" { "audio/wav" } else { "audio/mpeg" };
            assert_eq!(result, json!({
                "audio_data_url":format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(audio)),
                "channel_id":"selected","model":"selected-model"
            }));
            let (headers, body) = worker.join().unwrap();
            assert!(headers.starts_with("POST /v1/audio/speech "));
            assert!(headers.contains("Bearer fixture-selected"));
            assert_eq!(body, json!({"model":"selected-model","input":"回复朗读。","voice":"yunxi","response_format":format,"speed":1.2}));
            f.assert_no_speech_artifacts();
            assert_eq!(snapshot(&f.state, &f.pid).unwrap()["revisions"], revisions);
        }
    }

    #[test]
    fn speech_synthesis_rejects_missing_selection_and_invalid_audio_without_side_effects() {
        let f = Fixture::new();
        let error = f.speak(json!({"text":"没有配置"})).unwrap_err();
        assert!(!error.contains("请求失败"));
        f.assert_no_speech_artifacts();
        f.configure("http://127.0.0.1:9");
        for payload in [json!({"text":"ok","channel_id":"deleted"}), json!({"text":"ok","model":"deleted"}), json!({"text":"ok","speed":0})] {
            let error = f.speak(payload).unwrap_err();
            assert!(!error.contains("请求失败"), "{error}");
            f.assert_no_speech_artifacts();
        }
        for bytes in [vec![], b"not audio".to_vec()] {
            let (base, worker) = server(200, "audio/mpeg", bytes);
            f.configure(&base);
            let error = f.speak(json!({"text":"这段朗读失败"})).unwrap_err();
            assert!(error.contains("无效音频"));
            worker.join().unwrap();
            f.assert_no_speech_artifacts();
        }
    }

    #[test]
    fn tts_failures_never_create_media_and_are_recorded() {
        let f = Fixture::new();
        for (status, mime, bytes) in [
            (401, "application/json", br#"{"error":{"message":"invalid fixture-openai"}}"#.to_vec()),
            (200, "application/json", br#"{"code":"InvalidParameter","message":"bad voice"}"#.to_vec()),
            (200, "audio/mpeg", vec![]),
            (200, "text/html", b"<html>gateway failure</html>".to_vec()),
        ] {
            let (base, worker) = server(status, mime, bytes);
            f.configure(&base);
            let error = f.run(json!({"text":"hello"})).unwrap_err();
            assert!(!error.contains("fixture-openai"));
            worker.join().unwrap();
            let c = db(&f.state, &f.pid).unwrap();
            assert_eq!(c.query_row("SELECT COUNT(*) FROM media", [], |r| r.get::<_,i64>(0)).unwrap(), 0);
            assert_eq!(c.query_row("SELECT status FROM background_jobs ORDER BY id DESC LIMIT 1", [], |r| r.get::<_,String>(0)).unwrap(), "failed");
        }
    }

    #[test]
    fn qwen_json_success_downloads_audio_without_forwarding_api_credentials() {
        let f = Fixture::new();
        for mime in ["application/json", "application/octet-stream"] {
            let audio = b"ID3\x04\x00\x00\x00\x00\x00\x00fixture".to_vec();
            let (download_base, download) = server(200, "audio/mpeg", audio.clone());
            let (base, submission) = server(200, mime, json!({"request_id":"fixture-request","output":{"finish_reason":"stop","audio":{"url":format!("{download_base}/result.mp3?signature=fixture-signed"),"data":""}},"usage":{"characters":5}}).to_string().into_bytes());
            f.configure(&base);
            let result = f.run(json!({"text":"Hello","channel_id":"qwen"})).unwrap();
            assert_eq!(fs::read(result["path"].as_str().unwrap()).unwrap(), audio);
            let (header, _) = submission.join().unwrap();
            assert!(header.starts_with(&format!("POST {QWEN_PATH} ")));
            assert!(header.contains("Bearer sk-sp-fixture"));
            let (header, _) = download.join().unwrap();
            assert!(header.starts_with("GET /result.mp3?signature=fixture-signed "));
            assert!(!header.to_ascii_lowercase().contains("authorization:"));
            let c = db(&f.state, &f.pid).unwrap();
            assert_eq!(c.query_row("SELECT status FROM background_jobs ORDER BY id DESC LIMIT 1", [], |r| r.get::<_,String>(0)).unwrap(), "completed");
        }
    }

    #[test]
    fn qwen_result_download_failures_do_not_create_media() {
        let f = Fixture::new();
        for (status, body) in [(403, b"expired link".to_vec()), (200, b"not audio".to_vec())] {
            let (download_base, download) = server(status, "application/octet-stream", body);
            let (base, submission) = server(200, "application/json", json!({"output":{"audio":{"url":format!("{download_base}/result?signature=private-token")}}}).to_string().into_bytes());
            f.configure(&base);
            let error = f.run(json!({"text":"Hello","channel_id":"qwen"})).unwrap_err();
            assert!(!error.contains("private-token"));
            submission.join().unwrap();download.join().unwrap();
            let c = db(&f.state, &f.pid).unwrap();
            assert_eq!(c.query_row("SELECT COUNT(*) FROM media", [], |r| r.get::<_,i64>(0)).unwrap(), 0);
            assert_eq!(c.query_row("SELECT status FROM background_jobs ORDER BY id DESC LIMIT 1", [], |r| r.get::<_,String>(0)).unwrap(), "failed");
        }
        for response in [json!({"output":{"audio":{"data":""}}}), json!({"output":{"audio":{"url":"file:///tmp/audio.mp3"}}}), json!({"code":"InvalidVoice","message":"bad voice sk-sp-fixture","output":{"audio":{"url":"http://127.0.0.1:9/unused"}}})] {
            let (base, submission) = server(200, "application/json", response.to_string().into_bytes());
            f.configure(&base);
            let error = f.run(json!({"text":"Hello","channel_id":"qwen"})).unwrap_err();
            assert!(!error.contains("sk-sp-fixture"));assert!(!error.contains("下载合成音频失败"));
            submission.join().unwrap();
        }
    }

    #[test]
    fn tts_rejects_invalid_selection_and_parameters_before_network() {
        let f = Fixture::new();f.configure("http://127.0.0.1:9");
        for v in [json!({"text":""}), json!({"text":"a".repeat(4097)}), json!({"text":12}),
            json!({"text":"ok","channel_id":"missing"}), json!({"text":"ok","model":"missing"}),
            json!({"text":"ok","speed":0}), json!({"text":"ok","speed":"fast"}),
            json!({"text":"ok","format":"../mp3"}), json!({"text":"ok","voice":" "}),
            json!({"text":"ok","channel_id":"qwen","speed":1}), json!({"text":"ok","channel_id":"qwen","instructions":"calm"})] {
            let error = f.run(v).unwrap_err();assert!(!error.contains("请求失败"), "{error}");
        }
        let mut config = json!({"provider":"openai","_model_profile":"openai-tts","model":"tts-1","base_url":"https://example.com/v1/audio/speech"});
        assert!(request(&config, &json!({"text":"ok","instructions":"calm"})).is_err());
        assert_eq!(request(&config, &json!({"text":"ok","format":"wav"})).unwrap().0, "https://example.com/v1/audio/speech");
        config["provider"] = json!("qianwen-token-plan");config["_model_profile"] = json!("qwen-tts");config["base_url"] = json!(format!("https://example.com{QWEN_PATH}"));
        assert_eq!(request(&config, &json!({"text":"ok","voice":"custom","format":"wav"})).unwrap().0, format!("https://example.com{QWEN_PATH}"));
        let mut invalid = json!({"tts":{"channels":[{"id":"a","name":"a","provider":"cast","models":[{"id":"tts-1","profile":"openai-tts"}]}]}});
        assert!(generation_channels::validate_settings(&invalid).is_err());
        invalid["tts"]["channels"][0]["provider"] = json!("qianwen-token-plan");
        assert!(generation_channels::validate_settings(&invalid).is_err());
        assert!(generate(&f.state, &json!({"project_id":f.pid,"text":"ok","channel_id":"missing"})).is_err());
    }
}
