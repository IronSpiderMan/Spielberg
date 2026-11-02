use super::*;
use reqwest::blocking::{Client, Response};
use std::time::Duration;

fn image_client(url: &str) -> reqwest::blocking::ClientBuilder {
    generation_http::client_builder(url).connect_timeout(Duration::from_secs(15)).timeout(Duration::from_secs(600))
}

fn submit(client: &Client, url: &str, key: &str, request: &Value) -> Result<Response, String> {
    send_with_direct_fallback(client, url, |client| client.post(url).bearer_auth(key).json(request))
}

fn send_with_direct_fallback(client: &Client, url: &str, request: impl Fn(&Client) -> reqwest::blocking::RequestBuilder) -> Result<Response, String> {
    match request(client).send() {
        Ok(response) => Ok(response),
        // A dead inherited proxy can prevent reaching Token Plan. Only retry
        // connection establishment failures: no generation body has been sent.
        // Never resubmit on response timeouts, HTTP errors or dropped responses.
        Err(error) if error.is_connect() => {
            let direct = image_client(url).no_proxy().build().map_err(|e| e.to_string())?;
            request(&direct).send().map_err(|direct_error| {
                format!("{}；直连重试也失败：{}",
                    generation_http::request_error_for(&error, url, "千问图片"),
                    generation_http::request_error_for(&direct_error, url, "千问图片"))
            })
        }
        Err(error) => Err(generation_http::request_error_for(&error, url, "千问图片")),
    }
}

fn body(c: &Connection, v: &Value, config: &Value, prompt: &str) -> Result<Value,String> {
    let mut content=Vec::new();
    if v["operation"]=="i2i" {
        for id in reference_media_ids(v,"image_media_ids")? {
            let item=media(c,Some(id)).filter(|m|m["kind"]=="image").ok_or("参考图不存在或类型不符")?;
            let path=item["path"].as_str().ok_or("参考图路径无效")?;
            if fs::metadata(path).map_err(|e|e.to_string())?.len()>10*1024*1024 {return Err("千问图片单张参考图不能超过 10 MB".into())}
            content.push(json!({"image":qianwen_video::image_data(c,id)?}));
        }
    }
    content.push(json!({"text":prompt}));
    Ok(json!({"model":config["model"],"input":{"messages":[{"role":"user","content":content}]},
        "parameters":{"size":generation_channels::image_size(v,config)?,"n":1}}))
}

pub(super) fn generate(s:&AppState,c:&Connection,pid:&str,v:&Value,config:&Value,prompt:&str)->Result<Value,String>{
    let key=config["api_key"].as_str().unwrap_or("").trim();
    if !key.starts_with("sk-sp-"){return Err("请配置千问 Token Plan 专属 API Key（sk-sp- 开头）".into())}
    let root=qianwen_video::api_root(config)?;
    let request=body(c,v,config,prompt)?;
    let url=format!("{root}/api/v1/services/aigc/multimodal-generation/generation");
    let client=image_client(&url).build().map_err(|e|e.to_string())?;
    let response=submit(&client,&url,key,&request)?;
    let status=response.status();let result:Value=response.json().map_err(|e|format!("解析千问图片响应失败：{e}"))?;
    if !status.is_success()||result.get("code").is_some_and(|v|!v.is_null()){return Err(format!("千问图片请求失败（{status}）：{} {}",result["code"].as_str().unwrap_or(""),result["message"].as_str().unwrap_or("未知错误")))}
    let image=result["output"]["choices"].as_array().into_iter().flatten().filter_map(|x|x["message"]["content"].as_array()).flatten().find_map(|x|x["image"].as_str()).ok_or("千问未返回生成图片")?;
    let bytes=if image.starts_with("data:") {
        base64::engine::general_purpose::STANDARD.decode(image.split_once(',').ok_or("生成图片数据无效")?.1).map_err(|e|e.to_string())?
    }else{
        let url=reqwest::Url::parse(image).map_err(|_|"生成图片 URL 无效")?;
        if !["http","https"].contains(&url.scheme()){return Err("生成图片 URL 协议无效".into())}
        let client=image_client(image).build().map_err(|e|e.to_string())?;
        send_with_direct_fallback(&client,image,|client|client.get(image).timeout(Duration::from_secs(120)))?
            .error_for_status().and_then(|r|r.bytes()).map_err(|e|format!("下载千问图片失败：{e}"))?.to_vec()
    };
    if bytes.is_empty(){return Err("生成图片文件为空".into())}
    let ext=if bytes.starts_with(b"\xff\xd8\xff"){"jpg"}else if bytes.starts_with(b"RIFF"){"webp"}else{"png"};
    let dir=PathBuf::from(project(s,pid)?["path"].as_str().ok_or("无效项目路径")?).join("assets/images");fs::create_dir_all(&dir).map_err(|e|e.to_string())?;
    let out=dir.join(format!("{}.{}",Uuid::new_v4(),ext));fs::write(&out,bytes).map_err(|e|e.to_string())?;
    let name=format!("{}-{}.{}",v["operation"].as_str().unwrap_or("image"),now(),ext);let created=now();
    c.execute("INSERT INTO media(name,path,kind,created_at) VALUES(?,?,'image',?)",params![name,out.to_string_lossy(),created]).map_err(|e|e.to_string())?;
    let id=c.last_insert_rowid();let _guard=s.guard.lock().map_err(|_|"本地数据锁不可用")?;touch(s,pid);
    Ok(json!({"id":id,"name":name,"path":out,"kind":"image","created_at":created}))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unreachable_proxy_falls_back_to_direct_without_changing_request() {
        let (base, mock) = qianwen_video::tests::server(vec![("POST /image ", 200, "{}".into())]);
        let proxy = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let proxy_address = proxy.local_addr().unwrap();
        drop(proxy);
        let client = Client::builder().proxy(reqwest::Proxy::all(format!("http://{proxy_address}")).unwrap())
            .timeout(Duration::from_secs(2)).build().unwrap();
        let request = json!({"model":"qwen-image-3.0-pro","input":{"messages":[{"role":"user","content":[{"text":"test"}]}]}});
        assert!(submit(&client, &format!("{base}/image"), "sk-sp-fixture", &request).unwrap().status().is_success());
        assert_eq!(mock.join().unwrap(), vec![request]);
    }

    #[test]
    fn result_download_recovers_from_an_unreachable_proxy_without_authentication() {
        // The existing mock requires this download route to have no API key.
        let (base, mock) = qianwen_video::tests::server(vec![("GET /clip.mp4 ", 200, "image-bytes".into())]);
        let proxy = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let proxy_address = proxy.local_addr().unwrap();
        drop(proxy);
        let client = Client::builder().proxy(reqwest::Proxy::all(format!("http://{proxy_address}")).unwrap())
            .timeout(Duration::from_secs(2)).build().unwrap();
        let url = format!("{base}/clip.mp4");
        let response = send_with_direct_fallback(&client, &url, |client| client.get(&url).timeout(Duration::from_secs(120))).unwrap();
        assert_eq!(response.text().unwrap(), "image-bytes");
        assert_eq!(mock.join().unwrap().len(), 1);
    }

    #[test]
    fn http_errors_are_returned_without_resubmitting() {
        let (base, mock) = qianwen_video::tests::server(vec![("POST /image ", 503, "{}".into())]);
        let client = image_client(&base).build().unwrap();
        let response = submit(&client, &format!("{base}/image"), "sk-sp-fixture", &json!({"model":"qwen-image-3.0-pro"})).unwrap();
        assert_eq!(response.status().as_u16(), 503);
        assert_eq!(mock.join().unwrap().len(), 1);
    }

    #[test]
    fn dropped_response_does_not_resubmit_a_generation() {
        use std::io::Read;
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/image", listener.local_addr().unwrap());
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
            let mut buffer = [0; 4096];
            assert!(stream.read(&mut buffer).unwrap() > 0);
            drop(stream);
            listener.set_nonblocking(true).unwrap();
            std::thread::sleep(Duration::from_millis(150));
            assert!(listener.accept().is_err(), "must not retry a request already received by the server");
        });
        let client = image_client(&url).build().unwrap();
        let error = submit(&client, &url, "sk-sp-fixture", &json!({"model":"qwen-image-3.0-pro"})).unwrap_err();
        assert!(error.contains("千问图片请求失败"));
        assert!(!error.contains("直连重试"));
        server.join().unwrap();
    }

    #[test]
    fn selected_token_plan_image_model_receives_references_and_saves_result() {
        let root=std::env::temp_dir().join(format!("spielberg-qianwen-image-{}",Uuid::new_v4()));storage::initialize_root(&root).unwrap();
        let state=AppState{root:root.clone(),guard:std::sync::Arc::new(Mutex::new(()))};
        let project=create_project(&state,&json!({"name":"Image channels"})).unwrap();let pid=project["id"].as_str().unwrap();let c=db(&state,pid).unwrap();
        let png=b"\x89PNG\r\n\x1a\nfixture";let path=root.join("reference.png");fs::write(&path,png).unwrap();
        c.execute("INSERT INTO media(name,path,kind,created_at) VALUES('ref',?,'image','1')",[path.to_string_lossy().as_ref()]).unwrap();let image_id=c.last_insert_rowid();
        let encoded=base64::engine::general_purpose::STANDARD.encode(png);
        let (base,mock)=qianwen_video::tests::server(vec![("POST /api/v1/services/aigc/multimodal-generation/generation ",200,
            json!({"output":{"choices":[{"message":{"content":[{"text":"ok"},{"image":format!("data:image/png;base64,{encoded}")} ]}}]}}).to_string())]);
        let settings=json!({"image":{"default_channel_id":"other","channels":[
            {"id":"other","name":"Other","provider":"openai","base_url":"http://127.0.0.1:9","api_key":"fixture-unused","models":[{"id":"custom","profile":"openai-image"}]},
            {"id":"token","name":"Token","provider":"qianwen-token-plan","base_url":format!("{base}/compatible-mode/v1"),"api_key":"sk-sp-fixture","models":[{"id":"qwen-image-3.0-pro","profile":"qwen-image"},{"id":"wan2.7-image","profile":"wan-image"}]}
        ]}});
        save_settings(&state,&json!({"project_id":pid,"settings":settings})).unwrap();
        let result=generate_image(&state,&json!({"project_id":pid,"operation":"i2i","prompt":"edit reference","channel_id":"token","model":"wan2.7-image","image_media_ids":[image_id],"size":"1024x1024"})).unwrap();
        assert_eq!(fs::read(result["path"].as_str().unwrap()).unwrap(),png);
        let requests=mock.join().unwrap();let request=&requests[0];
        assert_eq!(request["model"],"wan2.7-image");assert_eq!(request["parameters"]["size"],"1024*1024");assert_eq!(request["parameters"]["n"],1);
        assert!(request["input"]["messages"][0]["content"][0]["image"].as_str().unwrap().starts_with("data:image/png;base64,"));
        assert!(!request.to_string().contains("sk-sp-fixture"));fs::remove_dir_all(root).unwrap();
    }
}
