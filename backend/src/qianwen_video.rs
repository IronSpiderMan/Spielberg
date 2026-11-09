use super::*;
use reqwest::blocking::{Client, Response};
use std::time::{Duration, Instant};

const DEFAULT_BASE: &str = "https://token-plan.maas.qianwenaiapi.com";
const VIDEO_PATH: &str = "/api/v1/services/aigc/video-generation/video-synthesis";

// Accept the API root, the console's OpenAI Base URL, or the video endpoint.
pub(super) fn api_root(config: &Value) -> Result<String, String> {
    let raw = config["base_url"].as_str().filter(|s| !s.trim().is_empty())
        .or_else(|| config["url"].as_str().filter(|s| !s.trim().is_empty()))
        .unwrap_or(DEFAULT_BASE).trim().trim_end_matches('/');
    let root = [VIDEO_PATH, "/api/v1/services/aigc/multimodal-generation/generation", "/compatible-mode/v1", "/api/v1"]
        .iter().find_map(|suffix| raw.strip_suffix(suffix)).unwrap_or(raw);
    let url = reqwest::Url::parse(root).map_err(|_| "千问 Token Plan 服务地址无效")?;
    if !["http", "https"].contains(&url.scheme()) || url.host_str().is_none()
        || url.query().is_some() || url.fragment().is_some() {
        return Err("千问 Token Plan 服务地址无效".into());
    }
    Ok(root.to_string())
}

pub(super) fn image_data(c: &Connection, id: i64) -> Result<String, String> {
    reference_image_data(c, id, false)
}

fn video_image_data(c: &Connection, id: i64) -> Result<String, String> {
    reference_image_data(c, id, true)
}

fn reference_image_data(c: &Connection, id: i64, compress: bool) -> Result<String, String> {
    let item = media(c, Some(id)).ok_or("找不到参考图片")?;
    let path = svg::reference_path(Path::new(item["path"].as_str().ok_or("参考图片路径无效")?))?;
    let bytes = fs::read(&path).map_err(|e| format!("无法读取参考图片：{e}"))?;
    let mime = if bytes.starts_with(b"\x89PNG\r\n\x1a\n") { "image/png" }
        else if bytes.starts_with(b"\xff\xd8\xff") { "image/jpeg" }
        else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") { "image/webp" }
        else { return Err("千问视频参考图仅支持 PNG、JPEG、WebP（SVG 会自动转换）".into()) };
    if compress && bytes.len() > 512 * 1024 {
        let binary = if Path::new("/opt/homebrew/bin/ffmpeg").exists() {
            "/opt/homebrew/bin/ffmpeg"
        } else {
            "ffmpeg"
        };
        // Keep transparency for formats that can carry it.
        let opaque = mime == "image/jpeg" || (mime == "image/png"
            && matches!(bytes.get(25), Some(0 | 2 | 3))
            && !bytes.windows(4).any(|chunk| chunk == b"tRNS"));
        let (encoder, output_mime) = if opaque { ("mjpeg", "image/jpeg") }
            else { ("png", "image/png") };
        let output = crate::background_command(binary)
            .args(["-nostdin", "-v", "error", "-i"])
            .arg(&path)
            .args(["-frames:v", "1", "-vf",
                "scale=w='min(1920,iw)':h='min(1920,ih)':force_original_aspect_ratio=decrease",
                "-q:v", "3", "-c:v", encoder, "-f", "image2pipe", "pipe:1"])
            .output();
        if let Ok(output) = output {
            if output.status.success() && !output.stdout.is_empty()
                && output.stdout.len() < bytes.len() && output.stdout.len() <= 20 * 1024 * 1024
            {
                let encoded = base64::engine::general_purpose::STANDARD.encode(output.stdout);
                return Ok(format!("data:{output_mime};base64,{encoded}"));
            }
        }
    }
    if bytes.len() > 20 * 1024 * 1024 { return Err("千问视频单张参考图不能超过 20 MB".into()) }
    // Inline data avoids the separate OSS upload API, unavailable to Token Plan.
    Ok(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
}

fn request_body(c: &Connection, v: &Value, config: &Value, operation: &str, prompt: &str) -> Result<Value, String> {
    if config["model"] == "wan3.0-video" { return wan_request_body(c, v, config, operation, prompt) }
    let duration = match v.get("duration") {
        None => 5,
        Some(value) => value.as_i64().filter(|d| (3..=15).contains(d)).ok_or("千问视频时长须为 3–15 秒整数")?,
    };
    let resolution = v["resolution"].as_str().or_else(|| config["resolution"].as_str()).unwrap_or("720P");
    if !["480P", "720P", "1080P"].contains(&resolution) { return Err("千问视频分辨率须为 480P、720P 或 1080P".into()) }
    if !reference_media_ids(v, "reference_video_media_ids")?.is_empty()
        || !reference_media_ids(v, "reference_audio_media_ids")?.is_empty() {
        return Err("千问 Token Plan 的 HappyHorse 当前仅支持图片参考，请移除参考视频和音频".into());
    }
    let (field, default, mode) = match operation {
        "t2v" => ("model", "happyhorse-1.1-t2v", "t2v"),
        "fl2v" | "i2v" => ("i2v_model", "happyhorse-1.1-i2v", "i2v"),
        "ref2v" => ("r2v_model", "happyhorse-1.1-r2v", "r2v"),
        _ => return Err("千问视频生成方式无效".into()),
    };
    if opti(v, "last_media_id").is_some() { return Err("千问 Token Plan 的 HappyHorse 不支持尾帧，请只选择首帧或使用图片参考".into()) }
    let model = if config.get("_model_profile").is_some() {config["model"].as_str().unwrap_or(default)} else {config[field].as_str().filter(|s| !s.trim().is_empty()).unwrap_or(default)}.trim();
    if model != default { return Err(format!("千问 Token Plan 的 {mode} 模型请使用 {default}")) }
    let mut input = json!({"prompt": prompt});
    let mut parameters = json!({"duration": duration, "resolution": resolution});
    if mode == "i2v" {
        let ids = if operation == "fl2v" { opti(v, "first_media_id").into_iter().collect() }
            else { let ids = reference_media_ids(v, "image_media_ids")?; if ids.is_empty() { opti(v, "image_media_id").into_iter().collect() } else { ids } };
        if ids.len() != 1 { return Err("千问图生视频需要且仅支持一张首帧图片".into()) }
        input["media"] = json!([{"type": "first_frame", "url": video_image_data(c, ids[0])?}]);
    } else {
        let ratio = v["aspect_ratio"].as_str().unwrap_or("16:9");
        if !["16:9", "9:16", "1:1", "4:3", "3:4", "4:5", "5:4", "9:21", "21:9"].contains(&ratio) {
            return Err("千问视频不支持此画幅，请选择 16:9、9:16 或 1:1".into());
        }
        parameters["ratio"] = json!(ratio);
        if mode == "r2v" {
            let ids = reference_media_ids(v, "image_media_ids")?;
            if ids.is_empty() || ids.len() > 9 { return Err("千问图片参考视频需要 1–9 张参考图片".into()) }
            input["media"] = Value::Array(ids.into_iter().map(|id| Ok(json!({"type": "reference_image", "url": video_image_data(c, id)?})))
                .collect::<Result<Vec<_>, String>>()?);
        }
    }
    Ok(json!({"model": model, "input": input, "parameters": parameters}))
}

fn av_data(c: &Connection, id: i64, kind: &str) -> Result<String, String> {
    let item = media(c, Some(id)).filter(|item| item["kind"] == kind).ok_or("参考素材不存在或类型不符")?;
    let path = Path::new(item["path"].as_str().ok_or("参考素材路径无效")?);
    let (mime, limit) = match (kind, path.extension().and_then(|s| s.to_str()).unwrap_or("").to_ascii_lowercase().as_str()) {
        ("video", "mp4") => ("video/mp4", 100), ("video", "mov") => ("video/quicktime", 100),
        ("audio", "mp3") => ("audio/mpeg", 15), ("audio", "wav") => ("audio/wav", 15),
        _ => return Err("Wan 3.0 参考视频支持 MP4/MOV，参考音频支持 MP3/WAV".into()),
    };
    let size = fs::metadata(path).map_err(|e| e.to_string())?.len();
    if size > limit * 1024 * 1024 { return Err(format!("Wan 3.0 单个参考素材不能超过 {limit} MB")) }
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    Ok(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
}

fn wan_request_body(c: &Connection, v: &Value, config: &Value, operation: &str, prompt: &str) -> Result<Value, String> {
    let duration = match v.get("duration") {
        None => 5,
        Some(value) => value.as_i64().filter(|d| *d == -1 || (2..=30).contains(d)).ok_or("Wan 3.0 时长须为 2–30 秒整数，或 -1（智能时长）")?,
    };
    let resolution = v["resolution"].as_str().or_else(|| config["resolution"].as_str()).unwrap_or("720P");
    if !["480P", "720P", "1080P"].contains(&resolution) { return Err("千问视频分辨率须为 480P、720P 或 1080P".into()) }
    let ratio = if operation == "fl2v" || operation == "i2v" { "adaptive" } else { v["aspect_ratio"].as_str().unwrap_or("16:9") };
    if !["adaptive", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"].contains(&ratio) {
        return Err("Wan 3.0 不支持此画幅，请选择 16:9、9:16、1:1 等支持的比例".into());
    }
    let images = reference_media_ids(v, "image_media_ids")?;
    let videos = reference_media_ids(v, "reference_video_media_ids")?;
    let audios = reference_media_ids(v, "reference_audio_media_ids")?;
    let mut refs = Vec::new();
    match operation {
        "t2v" => {
            if !images.is_empty() || !videos.is_empty() || !audios.is_empty() || opti(v, "first_media_id").is_some() || opti(v, "last_media_id").is_some() {
                return Err("文生视频不使用参考素材".into());
            }
        },
        "fl2v" | "i2v" => {
            if !videos.is_empty() || !audios.is_empty() { return Err("Wan 3.0 首尾帧模式不能混用音视频参考".into()) }
            let first = if operation == "fl2v" { opti(v, "first_media_id") }
                else if images.len() <= 1 { images.first().copied().or_else(|| opti(v, "image_media_id")) } else { return Err("首帧模式只能选择一张图片，请使用全能参考模式".into()) };
            refs.push(json!({"type":"first_frame", "url":video_image_data(c, first.ok_or("请选择首帧")?)?}));
            if let Some(id) = opti(v, "last_media_id") { refs.push(json!({"type":"last_frame", "url":video_image_data(c, id)?})); }
        },
        "ref2v" => {
            if opti(v, "first_media_id").is_some() || opti(v, "last_media_id").is_some() { return Err("Wan 3.0 参考模式不能混用首尾帧".into()) }
            if images.len() > 9 || videos.len() > 3 || audios.len() > 3 { return Err("全能参考最多支持 9 张图片、3 个视频和 3 个音频".into()) }
            for id in images { refs.push(json!({"type":"reference_image", "url":video_image_data(c, id)?})); }
            for (ids, kind) in [(videos, "video"), (audios, "audio")] {
                for id in ids { refs.push(json!({"type":format!("reference_{kind}"), "url":av_data(c, id, kind)?})); }
            }
            if refs.is_empty() { return Err("全能参考至少需要一种参考素材".into()) }
        },
        _ => return Err("Wan 3.0 视频生成方式无效".into()),
    }
    let mut input = json!({"prompt":prompt});
    if !refs.is_empty() { input["media"] = json!(refs); }
    let mut parameters = json!({"duration":duration,"resolution":resolution,"ratio":ratio});
    for field in ["audio", "prompt_extend", "watermark"] {
        if let Some(value) = v.get(field).or_else(|| config.get(field)) {
            parameters[field] = json!(value.as_bool().ok_or_else(|| format!("{field} 须为布尔值"))?);
        }
    }
    Ok(json!({"model":"wan3.0-video","input":input,"parameters":parameters}))
}

fn response_json(response: Response) -> Result<Value, String> {
    let status = response.status();
    let body = response.text().map_err(|e| format!("读取千问响应失败：{e}"))?;
    let item: Value = serde_json::from_str(&body).map_err(|_| format!("千问返回非 JSON 响应（{status}）"))?;
    if !status.is_success() || item.get("code").is_some_and(|c| !c.is_null()) {
        return Err(format!("千问视频请求失败（{status}）：{} {}", item["code"].as_str().unwrap_or(""), item["message"].as_str().unwrap_or("未知错误")));
    }
    Ok(item)
}

fn poll(client: &Client, root: &str, key: &str, task_id: &str, interval: Duration, timeout: Duration) -> Result<Value, String> {
    let mut url = reqwest::Url::parse(&format!("{root}/api/v1/tasks/")).map_err(|e| e.to_string())?;
    url.path_segments_mut().map_err(|_| "千问任务地址无效")?.pop_if_empty().push(task_id);
    let started = Instant::now();
    loop {
        let item = response_json(client.get(url.clone()).bearer_auth(key).send().map_err(|e| format!("查询千问视频任务失败：{e}"))?)?;
        match item["output"]["task_status"].as_str() {
            Some("SUCCEEDED") => return Ok(item),
            Some("FAILED" | "CANCELED" | "CANCELLED" | "UNKNOWN") => return Err(format!("千问视频任务失败：{} {}",
                item["output"]["code"].as_str().unwrap_or(""), item["output"]["message"].as_str().unwrap_or("任务已取消或失效"))),
            Some("PENDING" | "RUNNING") => {},
            _ => return Err("千问响应缺少有效的任务状态".into()),
        }
        if started.elapsed() >= timeout { return Err(format!("千问视频任务查询超时，远程任务 {task_id} 可能仍在执行，请勿重复提交")) }
        std::thread::sleep(interval);
    }
}

pub(super) fn generate(s: &AppState, c: &Connection, pid: &str, v: &Value, operation: &str, prompt: &str, config: &Value) -> Result<Value, String> {
    let key = config["api_key"].as_str().unwrap_or("").trim();
    if !key.starts_with("sk-sp-") { return Err("请配置千问 Token Plan 专属 API Key（sk-sp- 开头）".into()) }
    let root = if let Some(resume) = v.get("_resume") { strv(resume, "url")? } else { api_root(config)? };
    let client = generation_http::client_builder(&root).connect_timeout(Duration::from_secs(15)).timeout(Duration::from_secs(120))
        .build().map_err(|e| e.to_string())?;
    let (gid, task_id) = if let Some(resume) = v.get("_resume") {
        (intv(resume, "generation_row_id")?, strv(resume, "generation_id")?)
    } else {
        let body = request_body(c, v, config, operation, prompt)?;
        // Keep only reference IDs locally, rather than duplicating large base64 payloads.
        let stored = json!({"model": body["model"], "parameters": body["parameters"], "request": v});
        c.execute("INSERT INTO generations(operation,status,prompt,request_json,created_at,updated_at) VALUES(?,'running',?,?,?,?)",
            params![operation, prompt, stored.to_string(), now(), now()]).map_err(|e| e.to_string())?;
        let gid = c.last_insert_rowid();
        let submitted = (|| {
            let result = response_json(client.post(format!("{root}{VIDEO_PATH}")).bearer_auth(key)
                .header("X-DashScope-Async", "enable").json(&body).send().map_err(|e| format!("提交千问视频任务失败：{e}"))?)?;
            result["output"]["task_id"].as_str().filter(|s| !s.is_empty()).map(str::to_string).ok_or_else(|| "千问未返回任务编号".to_string())
        })();
        match submitted {
            Ok(task_id) => (gid, task_id),
            Err(error) => { mark_failed(c, gid, &error); return Err(error) },
        }
    };
    let result: Result<Value, String> = (|| {
        if let Some(job) = opti(v, "_job_id") {
            let mut payload = v.clone();payload.as_object_mut().ok_or("视频请求无效")?.remove("_resume");if let Some(id)=config.get("_channel_id"){payload["channel_id"]=id.clone();payload["model"]=config["model"].clone();}
            let resume = json!({"provider": "qianwen-token-plan", "payload": payload, "generation_row_id": gid,
                "generation_id": task_id, "url": root, "operation": operation});
            c.execute("UPDATE background_jobs SET resume_json=?,updated_at=? WHERE id=?", params![resume.to_string(), now(), job]).map_err(|e| e.to_string())?;
        }
        let result = poll(&client, &root, key, &task_id, Duration::from_secs(15), Duration::from_secs(3600))?;
        let remote = result["output"]["video_url"].as_str().filter(|s| !s.is_empty()).ok_or("千问任务已完成，但未返回视频地址")?;
        // Download with a separate client; never send the API key to the media host.
        let bytes = generation_http::submission_client_builder(remote).timeout(Duration::from_secs(300)).build().map_err(|e| e.to_string())?
            .get(remote).send().and_then(|r| r.error_for_status()).and_then(|r| r.bytes()).map_err(|e| format!("下载千问视频失败：{e}"))?;
        if bytes.is_empty() { return Err("千问返回的视频文件为空".into()) }
        save_generated_video(s, c, pid, v, operation, gid, "mp4", &bytes, &result)
    })();
    if let Err(error) = &result { mark_failed(c, gid, error); }
    result
}

fn mark_failed(c: &Connection, gid: i64, error: &str) {
    let _ = c.execute("UPDATE generations SET status='failed',error=?,updated_at=? WHERE id=?", params![error, now(), gid]);
}

#[cfg(test)]
pub(super) mod tests {
    use super::*;
    use std::io::{Read, Write};

    struct Fixture { state: AppState, pid: String }
    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!("spielberg-qianwen-{}", Uuid::new_v4()));
            storage::initialize_root(&root).unwrap();
            let state = AppState {root, guard:std::sync::Arc::new(Mutex::new(()))};
            let project = create_project(&state, &json!({"name":"Token Plan fixture"})).unwrap();
            Self {state, pid:project["id"].as_str().unwrap().to_string()}
        }
        fn media(&self, c: &Connection, name: &str, kind: &str, bytes: &[u8]) -> i64 {
            let path = self.state.root.join(name);fs::write(&path, bytes).unwrap();
            c.execute("INSERT INTO media(name,path,kind,created_at) VALUES(?,?,?,?)", params![name,path.to_string_lossy(),kind,now()]).unwrap();
            c.last_insert_rowid()
        }
    }
    impl Drop for Fixture { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.state.root); } }

    // The server returns immediately completed tasks so end-to-end tests don't sleep.
    pub(crate) fn server(steps: Vec<(&'static str, u16, String)>) -> (String, std::thread::JoinHandle<Vec<Value>>) {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let root = format!("http://{}", listener.local_addr().unwrap());
        let base = root.clone();
        let thread = std::thread::spawn(move || {
            let mut requests = Vec::new();
            for (route, status, response) in steps {
                let deadline = Instant::now() + Duration::from_secs(10);
                let mut stream = loop {
                    match listener.accept() {
                        Ok((stream, _)) => break stream,
                        Err(e) if e.kind() == std::io::ErrorKind::WouldBlock && Instant::now() < deadline => std::thread::sleep(Duration::from_millis(5)),
                        Err(e) => panic!("mock request missing: {route}: {e}"),
                    }
                };
                stream.set_read_timeout(Some(Duration::from_secs(3))).unwrap();
                let mut data = Vec::new();let mut chunk = [0;8192];
                let (header, start, length) = loop {
                    let n = stream.read(&mut chunk).unwrap();assert!(n > 0);data.extend_from_slice(&chunk[..n]);
                    if let Some(end) = data.windows(4).position(|w| w == b"\r\n\r\n") {
                        let header = String::from_utf8_lossy(&data[..end]).to_string();
                        let length = header.lines().find_map(|line| line.to_ascii_lowercase().strip_prefix("content-length: ").and_then(|s|s.parse::<usize>().ok())).unwrap_or(0);
                        break (header, end+4, length);
                    }
                };
                while data.len() < start+length { let n=stream.read(&mut chunk).unwrap();assert!(n>0);data.extend_from_slice(&chunk[..n]); }
                assert!(header.starts_with(route), "{header}");
                let lower = header.to_ascii_lowercase();
                if route.contains("/clip.mp4") { assert!(!lower.contains("authorization:")); }
                else { assert!(lower.contains("authorization: bearer sk-sp-fixture")); }
                if route.starts_with("POST") && route.contains("video-synthesis") { assert!(lower.contains("x-dashscope-async: enable")); }
                requests.push(if length > 0 {serde_json::from_slice(&data[start..start+length]).unwrap()} else {Value::Null});
                let body = response.replace("$BASE", &base);
                write!(stream,"HTTP/1.1 {status} Mock\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len()).unwrap();
            }
            requests
        });
        (root, thread)
    }
    fn completed() -> String { json!({"output":{"task_status":"SUCCEEDED","video_url":"$BASE/clip.mp4"}}).to_string() }
    fn config(root: &str, model: &str) -> Value { json!({"provider":"qianwen-token-plan","base_url":root,"api_key":"sk-sp-fixture","model":model}) }
    fn multi_channel_config(root: &str) -> Value {json!({"video":{"default_channel_id":"other","channels":[
        {"id":"other","name":"Other","provider":"qianwen-token-plan","base_url":"http://127.0.0.1:9","api_key":"sk-sp-unused","models":[{"id":"wan3.0-video","profile":"wan3-video"}]},
        {"id":"original","name":"Original","provider":"qianwen-token-plan","base_url":root,"api_key":"sk-sp-fixture","models":[{"id":"wan3.0-video","profile":"wan3-video"}]}
    ]}})}

    #[test]
    fn normalizes_console_and_video_urls() {
        for suffix in ["", "/", "/compatible-mode/v1", "/api/v1", VIDEO_PATH] {
            assert_eq!(api_root(&json!({"base_url":format!("{DEFAULT_BASE}{suffix}")})).unwrap(),DEFAULT_BASE);
        }
        assert_eq!(api_root(&json!({})).unwrap(),DEFAULT_BASE);
        assert!(api_root(&json!({"base_url":"ftp://example.com"})).is_err());
    }

    #[test]
    fn maps_happyhorse_models_and_reference_order() {
        let f=Fixture::new();let c=db(&f.state,&f.pid).unwrap();
        let a=f.media(&c,"a.png","image",b"\x89PNG\r\n\x1a\nfirst");let b=f.media(&c,"b.png","image",b"\x89PNG\r\n\x1a\nsecond");
        let settings=json!({});
        let text=request_body(&c,&json!({}),&settings,"t2v","test").unwrap();
        assert_eq!(text["model"],"happyhorse-1.1-t2v");assert!(text["input"].get("media").is_none());
        let first=request_body(&c,&json!({"first_media_id":a}),&settings,"fl2v","test").unwrap();
        assert_eq!(first["model"],"happyhorse-1.1-i2v");assert_eq!(first["input"]["media"][0]["type"],"first_frame");assert!(first["parameters"].get("ratio").is_none());
        let refs=request_body(&c,&json!({"image_media_ids":[b,a]}),&settings,"ref2v","test").unwrap();
        assert_eq!(refs["model"],"happyhorse-1.1-r2v");assert_eq!(refs["input"]["media"][0]["url"],image_data(&c,b).unwrap());
        assert!(request_body(&c,&json!({"first_media_id":a,"last_media_id":b}),&settings,"fl2v","test").unwrap_err().contains("尾帧"));
        assert!(request_body(&c,&json!({"reference_video_media_ids":[1]}),&settings,"ref2v","test").is_err());
        assert!(request_body(&c,&json!({"duration":30}),&settings,"t2v","test").is_err());
        assert!(request_body(&c,&json!({"aspect_ratio":"3:2"}),&settings,"t2v","test").is_err());
    }

    #[test]
    fn wan_supports_text_first_last_and_multimodal_reference() {
        let f=Fixture::new();let c=db(&f.state,&f.pid).unwrap();let settings=config(DEFAULT_BASE,"wan3.0-video");
        let a=f.media(&c,"a.png","image",b"\x89PNG\r\n\x1a\nfirst");let b=f.media(&c,"b.png","image",b"\x89PNG\r\n\x1a\nlast");
        let video=f.media(&c,"ref.mp4","video",b"video");let audio=f.media(&c,"ref.wav","audio",b"audio");
        let text=request_body(&c,&json!({"duration":30,"audio":false}),&settings,"t2v","test").unwrap();
        assert_eq!(text["model"],"wan3.0-video");assert_eq!(text["parameters"]["duration"],30);assert_eq!(text["parameters"]["audio"],false);assert!(text["input"].get("media").is_none());
        let frames=request_body(&c,&json!({"first_media_id":a,"last_media_id":b,"duration":2}),&settings,"fl2v","test").unwrap();
        assert_eq!(frames["input"]["media"][1]["type"],"last_frame");assert_eq!(frames["parameters"]["ratio"],"adaptive");
        let refs=request_body(&c,&json!({"image_media_ids":[b,a],"reference_video_media_ids":[video],"reference_audio_media_ids":[audio],"duration":-1}),&settings,"ref2v","test").unwrap();
        assert_eq!(refs["parameters"]["duration"],-1);assert_eq!(refs["input"]["media"][0]["url"],image_data(&c,b).unwrap());
        assert_eq!(refs["input"]["media"][2]["type"],"reference_video");assert_eq!(refs["input"]["media"][3]["type"],"reference_audio");
        for duration in [0,1,31] {assert!(request_body(&c,&json!({"duration":duration}),&settings,"t2v","test").is_err());}
        assert!(request_body(&c,&json!({"first_media_id":a,"reference_audio_media_ids":[audio]}),&settings,"fl2v","test").is_err());
    }

    #[test]
    fn submits_polls_downloads_and_tracks_result() {
        let f=Fixture::new();let c=db(&f.state,&f.pid).unwrap();
        let (root, mock)=server(vec![("POST /api/v1/services/aigc/video-generation/video-synthesis ",200,json!({"output":{"task_id":"task-1"}}).to_string()),
            ("GET /api/v1/tasks/task-1 ",200,completed()),("GET /clip.mp4 ",200,"video fixture".into())]);
        save_settings(&f.state,&json!({"project_id":f.pid,"settings":multi_channel_config(&format!("{root}/compatible-mode/v1"))})).unwrap();
        let saved=tracked_generation(&f.state,"/generations/video",&json!({"project_id":f.pid,"prompt":"camera moves","duration":20,"channel_id":"original","model":"wan3.0-video"})).unwrap();
        assert_eq!(fs::read(saved["path"].as_str().unwrap()).unwrap(),b"video fixture");
        let (status, resume):(String,String)=c.query_row("SELECT status,resume_json FROM background_jobs",[],|r|Ok((r.get(0)?,r.get(1)?))).unwrap();
        assert_eq!(status,"completed");let resume:Value=serde_json::from_str(&resume).unwrap();assert_eq!(resume["provider"],"qianwen-token-plan");assert_eq!(resume["generation_id"],"task-1");
        assert!(!resume.to_string().contains("sk-sp-fixture"));assert_eq!(mock.join().unwrap()[0]["model"],"wan3.0-video");
        assert_eq!(resume["payload"]["channel_id"],"original");assert_eq!(resume["payload"]["model"],"wan3.0-video");
    }

    #[test]
    fn handles_pending_failed_and_http_errors() {
        let (root,mock)=server(vec![("GET /api/v1/tasks/test ",200,json!({"output":{"task_status":"PENDING"}}).to_string()),
            ("GET /api/v1/tasks/test ",200,json!({"output":{"task_status":"RUNNING"}}).to_string()),
            ("GET /api/v1/tasks/test ",200,json!({"output":{"task_status":"FAILED","code":"InvalidInput","message":"bad reference"}}).to_string())]);
        let client=generation_http::client_builder(&root).build().unwrap();
        assert!(poll(&client,&root,"sk-sp-fixture","test",Duration::ZERO,Duration::from_secs(5)).unwrap_err().contains("bad reference"));mock.join().unwrap();
        let f=Fixture::new();let c=db(&f.state,&f.pid).unwrap();
        let (root,mock)=server(vec![("POST /api/v1/services/aigc/video-generation/video-synthesis ",401,json!({"code":"InvalidApiKey","message":"invalid key"}).to_string())]);
        let error=generate(&f.state,&c,&f.pid,&json!({}),"t2v","test",&config(&root,"wan3.0-video")).unwrap_err();
        assert!(error.contains("InvalidApiKey"));assert_eq!(c.query_row("SELECT status FROM generations",[],|r|r.get::<_,String>(0)).unwrap(),"failed");mock.join().unwrap();
    }

    #[test]
    fn manual_resume_reuses_the_original_job_and_completion() {
        let fixture = Fixture::new();
        let c = db(&fixture.state, &fixture.pid).unwrap();
        let (root, mock) = server(vec![
            ("GET /api/v1/tasks/accepted ", 200, completed()),
            ("GET /clip.mp4 ", 200, "one video from the accepted job".into()),
        ]);
        save_settings(&fixture.state, &json!({"project_id":fixture.pid,"settings":multi_channel_config(&root)})).unwrap();
        c.execute(
            "INSERT INTO generations(operation,status,prompt,request_json,created_at,updated_at) VALUES('t2v','failed','test','{}','1','1')",
            [],
        ).unwrap();
        let resume = json!({
            "provider":"qianwen-token-plan","url":root,"operation":"t2v","generation_id":"accepted",
            "generation_row_id":c.last_insert_rowid(),"payload":{"project_id":fixture.pid,"prompt":"test",
                "channel_id":"original","model":"wan3.0-video"}
        });
        c.execute(
            "INSERT INTO background_jobs(operation,status,prompt,created_at,updated_at,resume_json) VALUES('/generations/video','running','test','1','1',?)",
            [resume.to_string()],
        ).unwrap();
        let id = c.last_insert_rowid();
        let input = json!({"project_id":fixture.pid,"job_id":id});
        assert!(resume_video_job(&fixture.state, &input).unwrap_err().contains("正在运行"));
        c.execute("UPDATE background_jobs SET status='failed' WHERE id=?", [id]).unwrap();

        let saved = resume_video_job(&fixture.state, &input).unwrap();
        assert_eq!(resume_video_job(&fixture.state, &input).unwrap(), saved);
        assert_eq!(fs::read(strv(&saved,"path").unwrap()).unwrap(), b"one video from the accepted job");
        assert_eq!(c.query_row("SELECT COUNT(*) FROM background_jobs", [], |r| r.get::<_,i64>(0)).unwrap(), 1);
        assert_eq!(c.query_row("SELECT COUNT(*) FROM media WHERE kind='video'", [], |r| r.get::<_,i64>(0)).unwrap(), 1);
        assert_eq!(mock.join().unwrap().len(), 2);
        assert!(tracked_generation(&fixture.state, "/generations/video", &json!({
            "project_id":fixture.pid,"_resume":resume
        })).unwrap_err().contains("/tasks/resume-video"));
    }

    #[test]
    fn restart_resumes_task_without_resubmitting() {
        let f=Fixture::new();let c=db(&f.state,&f.pid).unwrap();
        let (root,mock)=server(vec![("GET /api/v1/tasks/existing ",200,completed()),("GET /clip.mp4 ",200,"resumed video".into())]);
        save_settings(&f.state,&json!({"project_id":f.pid,"settings":multi_channel_config(&root)})).unwrap();
        c.execute("INSERT INTO generations(operation,status,prompt,request_json,created_at,updated_at) VALUES('t2v','running','test','{}','1','1')",[]).unwrap();let gid=c.last_insert_rowid();
        let resume=json!({"provider":"qianwen-token-plan","url":root,"operation":"t2v","generation_id":"existing","generation_row_id":gid,"payload":{"project_id":f.pid,"prompt":"test","channel_id":"original","model":"wan3.0-video"}});
        c.execute("INSERT INTO background_jobs(operation,status,prompt,created_at,updated_at,resume_json) VALUES('/generations/video','interrupted','test','1','1',?)",[resume.to_string()]).unwrap();
        recover_jobs(&f.state,&f.pid,&c).unwrap();mock.join().unwrap();
        let deadline=Instant::now()+Duration::from_secs(5);
        loop { let status:String=c.query_row("SELECT status FROM background_jobs",[],|r|r.get(0)).unwrap();
            if status=="completed" {break}assert_eq!(status,"running");assert!(Instant::now()<deadline);std::thread::sleep(Duration::from_millis(10)); }
        assert_eq!(c.query_row("SELECT COUNT(*) FROM media WHERE kind='video'",[],|r|r.get::<_,i64>(0)).unwrap(),1);
    }
}
