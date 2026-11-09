//! Exercise the actual video submission path without calling a generation service.
use super::*;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::time::{Duration, Instant};

fn accept(listener: &TcpListener) -> TcpStream {
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        match listener.accept() {
            Ok((stream, _)) => {
                stream.set_nonblocking(false).unwrap();
                return stream;
            },
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock && Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(5));
            }
            Err(error) => panic!("missing fixture request: {error}"),
        }
    }
}

fn read_request(stream: &mut TcpStream) -> (String, Value) {
    stream.set_read_timeout(Some(Duration::from_secs(10))).unwrap();
    let mut bytes = Vec::new();
    let mut buffer = [0; 4096];
    loop {
        let count = stream.read(&mut buffer).unwrap();
        assert!(count > 0);
        bytes.extend_from_slice(&buffer[..count]);
        if let Some(end) = bytes.windows(4).position(|part| part == b"\r\n\r\n") {
            let headers = String::from_utf8_lossy(&bytes[..end]).to_string();
            let length = headers.lines().find_map(|line| {
                line.to_ascii_lowercase().strip_prefix("content-length:").map(|value| value.trim().parse::<usize>().unwrap())
            }).unwrap_or(0);
            if bytes.len() >= end + 4 + length {
                let body = if length == 0 { Value::Null } else {
                    serde_json::from_slice(&bytes[end + 4..end + 4 + length]).unwrap()
                };
                return (headers, body);
            }
        }
    }
}

#[test]
fn h3_presets_reach_native_and_runninghub_video_requests() {
    let catalog: Value = serde_json::from_str(include_str!("../../src/generation-models.json")).unwrap();
    let models: Vec<Value> = catalog["models"].as_array().unwrap().iter()
        .filter(|model| model["profile"] == "runninghub-video").cloned().collect();
    assert_eq!(models.iter().map(|model| model["id"].as_str().unwrap()).collect::<Vec<_>>(),
               ["minimax-h3", "standard", "turbo8", "pika"]);
    let root = std::env::temp_dir().join(format!("spielberg-h3-models-{}", Uuid::new_v4()));
    storage::initialize_root(&root).unwrap();
    let state = AppState { root: root.clone(), guard: std::sync::Arc::new(Mutex::new(())) };
    let project = create_project(&state, &json!({"name":"H3 model presets"})).unwrap();
    let pid = project["id"].as_str().unwrap();
    let path = root.join("reference.png");
    fs::write(&path, b"fixture-image").unwrap();
    let image = import_media(&state, &json!({"project_id":pid,"source_path":path})).unwrap();
    for native in [false, true] {
        for model in &models {
            for operation in ["t2v", "fl2v", "ref2v"] {
                let listener = TcpListener::bind("127.0.0.1:0").unwrap();
                listener.set_nonblocking(true).unwrap();
                let address = listener.local_addr().unwrap();
                let expected_path = format!("POST /v1/generations/{operation} ");
                let server = std::thread::spawn(move || {
                    let mut captured = Value::Null;
                    for index in 0..2 {
                        let mut stream = accept(&listener);
                        let (headers, body) = read_request(&mut stream);
                        assert!(headers.to_ascii_lowercase().contains("authorization: bearer fixture-key"));
                        let (status, response) = if index == 0 {
                            assert!(headers.starts_with("GET /health "));
                            ("200 OK", if native { r#"{"native_video":{}}"# } else { r#"{"status":"ok"}"# })
                        } else {
                            assert!(headers.starts_with(&expected_path), "{headers}");
                            captured = body;
                            ("400 Bad Request", r#"{"error":"fixture stops before generation"}"#)
                        };
                        write!(stream, "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{response}", response.len()).unwrap();
                    }
                    captured
                });
                let settings = json!({"video":{"default_channel_id":"h3","channels":[{
                    "id":"h3","name":"H3","provider":"cast","base_url":format!("http://{address}"),
                    "api_key":"fixture-key","models":models,"default_model_id":"minimax-h3"
                }]}});
                save_settings(&state, &json!({"project_id":pid,"settings":settings})).unwrap();
                let mut payload = json!({"project_id":pid,"channel_id":"h3","model":model["id"],"prompt":"A bird moves.","duration":5});
                if operation == "fl2v" {
                    payload["video_mode"] = json!("fl2v");
                    payload["first_media_id"] = image["id"].clone();
                    payload["last_media_id"] = image["id"].clone();
                } else if operation == "ref2v" {
                    payload["video_mode"] = json!("i2v");
                    payload["image_media_ids"] = json!([image["id"]]);
                }
                let result = generate_video(&state, &payload);
                let body = server.join().unwrap();
                assert!(result.unwrap_err().contains("fixture stops before generation"));
                if model["id"] == "minimax-h3" {
                    assert!(body.get("model").is_none(), "fixed-model adapters keep the original contract");
                } else {
                    assert_eq!(model["send_model"], true);
                    assert_eq!(body["model"], model["id"]);
                }
                assert!(body.get("steps").is_none(), "the selected server model supplies 20/8/4 steps");
                assert_eq!(body["frames"], 124);
                if operation == "fl2v" { assert_eq!(body["start_image"], body["end_image"]); }
                if operation == "ref2v" { assert_eq!(body["reference_images"].as_array().unwrap().len(), 1); }
                let c = db(&state, pid).unwrap();
                let saved: String = c.query_row("SELECT request_json FROM generations ORDER BY id DESC LIMIT 1", [], |row| row.get(0)).unwrap();
                assert_eq!(serde_json::from_str::<Value>(&saved).unwrap(), body);
            }
        }
    }
    fs::remove_dir_all(root).unwrap();
}
