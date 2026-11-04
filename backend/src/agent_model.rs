//! Model transport is cancellable, including response reads and retry backoff.
//! Only inference requests are retried; business tools must never be replayed here.
use super::*;

const MAX_JSON_RESPONSE_BYTES: usize = 1_000_000;
// SSE repeats the JSON envelope for every fragment and can include private
// reasoning and heartbeats that are discarded. Its wire size is not the size
// of the retained message. Keep a separate transport ceiling, while bounding
// each buffered event and the accumulated public text/tool arguments below.
const MAX_STREAM_RESPONSE_BYTES: usize = 64 * 1024 * 1024;
const MAX_EVENT_BYTES: usize = 256_000;
const MAX_TEXT_BYTES: usize = 128_000;
const MAX_ARGUMENT_BYTES: usize = 64_000;

pub(super) struct Completion {
    pub message: Value,
    pub usage: Value,
}

pub(super) enum Event {
    Attempt,
    Retrying,
    /// Accumulated public text for this model request; never private reasoning.
    Delta(String),
}

enum Failure {
    Retry(u64),
    Fatal(String),
}

fn usage_counters(value: &Value) -> Value {
    let mut usage = json!({});
    for key in ["prompt_tokens", "completion_tokens", "total_tokens"] {
        if let Some(count) = value[key].as_u64() { usage[key] = json!(count); }
    }
    usage
}

fn check_finish_reason(reason: &str) -> Result<(), String> {
    match reason {
        "stop" | "tool_calls" => Ok(()),
        "length" => Err("Agent 模型输出被长度限制截断，请拆分任务后重试。".into()),
        "content_filter" => Err("Agent 模型服务未完成输出，请调整请求后重试。".into()),
        _ => Err("Agent 模型返回了不支持的结束状态，工具未执行。".into()),
    }
}

fn json_completion(bytes: &[u8]) -> Result<Completion, String> {
    let response: Value = serde_json::from_slice(bytes).map_err(|_| "Agent 模型返回了无效 JSON")?;
    let reason = response.pointer("/choices/0/finish_reason").and_then(Value::as_str);
    if let Some(reason) = reason { check_finish_reason(reason)?; }
    let message = response.pointer("/choices/0/message").filter(|value| value.is_object())
        .ok_or("Agent 模型没有返回有效消息")?;
    if let Some(reason) = reason {
        let has_calls = message["tool_calls"].as_array().is_some_and(|calls| !calls.is_empty());
        if (reason == "tool_calls") != has_calls {
            return Err("Agent 模型工具调用与结束状态不一致，工具未执行。".into());
        }
    }
    let mut public_message = json!({"role":"assistant"});
    for key in ["content", "refusal", "tool_calls"] {
        if let Some(value) = message.get(key) { public_message[key] = value.clone(); }
    }
    Ok(Completion { message: public_message, usage: usage_counters(&response["usage"]) })
}

/// Buffer bytes until an entire SSE line/event is available, then decode UTF-8.
/// A clean HTTP EOF is insufficient: tool arguments are usable only after a
/// successful finish_reason AND the provider's [DONE] sentinel.
#[derive(Default)]
struct Stream {
    pending: Vec<u8>,
    data: Vec<u8>,
    total_bytes: usize,
    content: String,
    refusal: String,
    calls: std::collections::BTreeMap<usize, Value>,
    usage: Value,
    finish_reason: Option<String>,
    done: bool,
}

impl Stream {
    fn feed(&mut self, bytes: &[u8], on_event: &mut impl FnMut(Event) -> Result<(), String>) -> Result<(), String> {
        self.total_bytes = self.total_bytes.saturating_add(bytes.len());
        if self.total_bytes > MAX_STREAM_RESPONSE_BYTES {
            return Err("Agent 模型流式传输超过 64 MiB 上限，未完成的工具未执行。请拆分任务后重试。".into());
        }
        // A proxy may coalesce many events into one HTTP chunk. Process bounded
        // slices so raising the wire ceiling does not increase parser buffering.
        for part in bytes.chunks(MAX_EVENT_BYTES) {
            self.pending.extend_from_slice(part);
            self.lines(false, on_event)?;
            if self.done { self.pending.clear(); break; }
        }
        Ok(())
    }

    fn lines(&mut self, eof: bool, on_event: &mut impl FnMut(Event) -> Result<(), String>) -> Result<(), String> {
        let mut start = 0;
        while let Some(relative) = self.pending[start..].iter().position(|byte| matches!(byte, b'\r' | b'\n')) {
            let end = start + relative;
            // A CR at a chunk boundary might be the first half of CRLF.
            if self.pending[end] == b'\r' && end + 1 == self.pending.len() && !eof { break; }
            let next = end + if self.pending[end] == b'\r' && self.pending.get(end + 1) == Some(&b'\n') { 2 } else { 1 };
            if self.data.len() + end - start > MAX_EVENT_BYTES { return Err("Agent 模型流式事件过大".into()); }
            if end == start {
                if !self.data.is_empty() {
                    self.event(on_event)?;
                    self.data.clear();
                }
            } else {
                let line = &self.pending[start..end];
                if let Some(value) = line.strip_prefix(b"data:") {
                    let value = value.strip_prefix(b" ").unwrap_or(value);
                    if !self.data.is_empty() { self.data.push(b'\n'); }
                    self.data.extend_from_slice(value);
                } else if line == b"data" {
                    self.data.push(b'\n');
                }
            }
            start = next;
            if self.done { break; }
        }
        self.pending.drain(..start);
        // A trailing CR waits for a possible LF in the next chunk, but is
        // already known to be a line delimiter rather than event payload.
        let pending_bytes = self.pending.len() - usize::from(self.pending.last() == Some(&b'\r'));
        if !self.done && self.data.len() + pending_bytes > MAX_EVENT_BYTES {
            return Err("Agent 模型流式事件过大".into());
        }
        Ok(())
    }

    fn event(&mut self, on_event: &mut impl FnMut(Event) -> Result<(), String>) -> Result<(), String> {
        let data = std::str::from_utf8(&self.data).map_err(|_| "Agent 模型流式响应编码无效")?.trim();
        if data == "[DONE]" {
            if self.finish_reason.is_none() { return Err("Agent 模型流式响应未完整结束，工具未执行。".into()); }
            self.done = true;
            return Ok(());
        }
        let event: Value = serde_json::from_str(data).map_err(|_| "Agent 模型返回了无效流式 JSON")?;
        if event.get("error").is_some_and(|value| !value.is_null()) {
            return Err("Agent 模型流式响应失败，工具未执行。".into());
        }
        if event["usage"].is_object() { self.usage = usage_counters(&event["usage"]); }
        let choices = event["choices"].as_array().ok_or("Agent 模型流式响应缺少 choices")?;
        for choice in choices {
            // Only the first completion belongs to this request's execution.
            if choice["index"].as_u64().unwrap_or(0) != 0 { continue; }
            let delta = &choice["delta"];
            if !delta.is_null() && !delta.is_object() { return Err("Agent 模型返回了无效流式增量".into()); }
            let old_text_length = self.content.len() + self.refusal.len();
            if self.finish_reason.is_some() && delta.as_object().is_some_and(|delta| !delta.is_empty()) {
                return Err("Agent 模型在结束后继续返回内容，工具未执行。".into());
            }
            for (key, target) in [("content", &mut self.content), ("refusal", &mut self.refusal)] {
                if let Some(value) = delta.get(key).filter(|value| !value.is_null()) {
                    let text = value.as_str().ok_or("Agent 模型返回了无效文本增量")?;
                    if target.len() + text.len() > MAX_TEXT_BYTES { return Err("Agent 模型回复过长".into()); }
                    target.push_str(text);
                }
            }
            if let Some(calls) = delta.get("tool_calls").filter(|value| !value.is_null()) {
                for part in calls.as_array().ok_or("Agent 模型返回了无效工具增量")? {
                    let index = part["index"].as_u64().filter(|index| *index < 8).ok_or("模型单次请求的工具过多或索引无效（最多 8 个）")? as usize;
                    if part.get("type").is_some_and(|kind| !kind.is_null() && kind != "function") {
                        return Err("模型返回了不支持的工具调用格式".into());
                    }
                    let call = self.calls.entry(index).or_insert_with(|| json!({"id":"","type":"function","function":{"name":"","arguments":""}}));
                    for (fragment, target, limit) in [
                        (&part["id"], "/id", 200),
                        (&part["function"]["name"], "/function/name", 200),
                        (&part["function"]["arguments"], "/function/arguments", MAX_ARGUMENT_BYTES),
                    ] {
                        if fragment.is_null() { continue; }
                        let text = fragment.as_str().ok_or("Agent 模型返回了无效工具参数增量")?;
                        let value = call.pointer_mut(target).unwrap();
                        let previous = value.as_str().unwrap();
                        if previous.len() + text.len() > limit { return Err("Agent 模型工具参数过大，请拆分任务。".into()); }
                        *value = json!(format!("{previous}{text}"));
                    }
                }
            }
            if let Some(reason) = choice.get("finish_reason").filter(|value| !value.is_null()) {
                let reason = reason.as_str().ok_or("Agent 模型返回了无效结束状态")?;
                check_finish_reason(reason)?;
                if self.finish_reason.is_some() { return Err("Agent 模型重复结束响应".into()); }
                self.finish_reason = Some(reason.into());
            }
            if self.content.len() + self.refusal.len() != old_text_length {
                on_event(Event::Delta(if self.content.is_empty() { self.refusal.clone() } else { self.content.clone() }))?;
            }
        }
        Ok(())
    }

    fn finish(mut self) -> Result<Completion, String> {
        if !self.done { self.lines(true, &mut |_| Ok(()))?; }
        if !self.done { return Err("Agent 模型流式响应中断，未完成的工具未执行。可发送“继续”重试。".into()); }
        if (self.finish_reason.as_deref() == Some("tool_calls")) != !self.calls.is_empty() {
            return Err("Agent 模型工具调用与结束状态不一致，工具未执行。".into());
        }
        let content = if self.content.is_empty() && !self.refusal.is_empty() { Value::Null } else { json!(self.content) };
        let mut message = json!({"role":"assistant","content":content});
        if !self.refusal.is_empty() { message["refusal"] = json!(self.refusal); }
        if !self.calls.is_empty() {
            if self.calls.keys().copied().ne(0..self.calls.len()) {
                return Err("Agent 模型工具调用索引不连续，工具未执行。".into());
            }
            message["tool_calls"] = json!(self.calls.into_values().collect::<Vec<_>>());
        }
        Ok(Completion { message, usage: self.usage })
    }
}

async fn attempt(
    client: &reqwest::Client, url: &str, cfg: &Value, body: &Value,
    on_event: &mut impl FnMut(Event) -> Result<(), String>,
) -> Result<Completion, Failure> {
    let mut request = client.post(url).json(body);
    if let Some(key) = cfg["api_key"].as_str().filter(|key| !key.is_empty()) {
        request = request.bearer_auth(key);
    }
    let mut response = request.send().await.map_err(|error| {
        if error.is_connect() { Failure::Retry(1) }
        else if error.is_timeout() { Failure::Fatal(format!("Agent 模型请求超时（{} 秒），已完成的操作和对话记录已保留。可发送“继续”接着处理，或在 Agent 设置中增加等待时间。", request_timeout_seconds(cfg))) }
        else { Failure::Fatal("无法连接 Agent 模型服务，请检查 Base URL、网络及服务状态。".into()) }
    })?;
    let status = response.status().as_u16();
    if !(200..300).contains(&status) {
        if matches!(status, 408 | 429 | 500 | 502 | 503 | 504) {
            // Do not retry sooner than Retry-After. Long waits require a later user retry.
            let delay = match response.headers().get(reqwest::header::RETRY_AFTER) {
                None => Some(1),
                Some(value) => value.to_str().ok().and_then(|value| value.parse::<u64>().ok()),
            };
            // Unsupported HTTP-date headers also defer to a later manual retry.
            if let Some(delay) = delay.filter(|delay| *delay <= 10) { return Err(Failure::Retry(delay.max(1))); }
        }
        return Err(Failure::Fatal(match status {
            401 | 403 => "Agent 模型认证失败，请检查 API Key 和模型权限。".into(),
            404 => "Agent 模型或接口不存在，请检查模型名称及 OpenAI 兼容 Base URL。".into(),
            429 => "Agent 模型限流或额度不足，请检查额度后重试。".into(),
            400 | 422 => "Agent 模型拒绝请求，请确认该模型和服务支持 OpenAI Chat Completions 工具调用；包含图片时还需要支持视觉输入。".into(),
            _ => format!("Agent 模型服务返回 HTTP {status}，请稍后重试。已完成操作已保留。"),
        }));
    }
    let streaming = response.headers().get(reqwest::header::CONTENT_TYPE).and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.split(';').next().unwrap_or("").trim().eq_ignore_ascii_case("text/event-stream"));
    if streaming {
        let mut stream = Stream::default();
        while let Some(chunk) = response.chunk().await.map_err(|_| Failure::Fatal("读取 Agent 模型流式响应失败，未完成的工具未执行。".into()))? {
            stream.feed(&chunk, on_event).map_err(Failure::Fatal)?;
            if stream.done { break; }
        }
        return stream.finish().map_err(Failure::Fatal);
    }
    // Some OpenAI-compatible providers ignore stream:true and return normal JSON.
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| Failure::Fatal("读取 Agent 模型响应失败".into()))? {
        if bytes.len() + chunk.len() > MAX_JSON_RESPONSE_BYTES { return Err(Failure::Fatal("Agent 模型 JSON 响应过大，请拆分任务后重试。".into())); }
        bytes.extend_from_slice(&chunk);
    }
    json_completion(&bytes).map_err(Failure::Fatal)
}

pub(super) async fn completion(
    client: &reqwest::Client, url: &str, cfg: &Value, messages: Vec<Value>, tools: &Value,
    cancel: &AtomicBool, mut on_event: impl FnMut(Event) -> Result<(), String>,
) -> Result<Completion, String> {
    let mut text_messages = messages.clone();
    for message in &mut text_messages {
        if let Some(parts) = message["content"].as_array_mut() { parts.retain(|part| part["type"] != "image_url"); }
    }
    if serde_json::to_vec(&text_messages).map_err(|_| "上下文编码失败")?.len() > MAX_CONTEXT + 100_000 {
        return Err("本次执行上下文已达上限，请创建新对话。".into());
    }
    let finalizing = tools.as_array().is_some_and(Vec::is_empty);
    let mut body = json!({"model":cfg["model"],"messages":messages,"stream":true,
        "stream_options":{"include_usage":true},"tool_choice":if finalizing {"none"} else {"auto"}});
    // DeepSeek requires complete reasoning_content round-tripping in thinking mode.
    // The Agent stores bounded public messages, so use ordinary tool calling.
    if cfg["provider"] == "deepseek" { body["thinking"] = json!({"type":"disabled"}); }
    if !finalizing { body["tools"] = tools.clone(); body["parallel_tool_calls"] = json!(false); }
    if body.to_string().len() > MAX_SESSION + 100_000 {
        return Err("本次执行上下文已达上限。请创建新对话，或拆分任务后继续。".into());
    }
    let work = async {
        for retry in 0..=2 {
            on_event(Event::Attempt)?;
            match attempt(client, url, cfg, &body, &mut on_event).await {
                Ok(completion) => return Ok(completion),
                Err(Failure::Fatal(error)) => return Err(error),
                Err(Failure::Retry(delay)) if retry < 2 => {
                    on_event(Event::Retrying)?;
                    tokio::time::sleep(Duration::from_secs(delay.max(1 << retry))).await;
                }
                Err(Failure::Retry(_)) => return Err("Agent 模型服务暂时不可用，自动重试 2 次后仍未恢复。已完成操作已保留，可稍后继续。".into()),
            }
        }
        unreachable!()
    };
    let cancelled = async {
        loop {
            if cancel.load(Ordering::SeqCst) { return; }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    };
    tokio::select! {
        biased;
        _ = cancelled => Err("执行已取消".into()),
        result = work => result,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn event(delta: Value, reason: Value) -> String {
        format!("data: {}\r\n\r\n", json!({"choices":[{"index":0,"delta":delta,"finish_reason":reason}]}))
    }

    #[test]
    fn utf8_and_crlf_split_at_every_byte_keep_public_text_and_usage() {
        let input = format!(": heartbeat\r\n\r\n{}{}{}data: {{\"choices\":[],\"usage\":{{\"prompt_tokens\":12,\"completion_tokens\":3,\"secret\":\"hidden\"}}}}\r\n\r\ndata: [DONE]\r\n\r\n",
            event(json!({"content":"你好","reasoning_content":"private"}), Value::Null),
            event(json!({"content":"，世界"}), Value::Null), event(json!({}), json!("stop")));
        let mut stream = Stream::default();
        let mut snapshots = Vec::new();
        for byte in input.as_bytes() {
            stream.feed(&[*byte], &mut |event| { if let Event::Delta(text) = event { snapshots.push(text); } Ok(()) }).unwrap();
        }
        let completion = stream.finish().unwrap();
        assert_eq!(snapshots, ["你好", "你好，世界"]);
        assert_eq!(completion.message, json!({"role":"assistant","content":"你好，世界"}));
        assert_eq!(completion.usage, json!({"prompt_tokens":12,"completion_tokens":3}));
    }

    #[test]
    fn multiline_events_and_interleaved_tools_reconstruct_in_index_order() {
        let input = format!("data: {{\"choices\":\ndata: [{{\"index\":0,\"delta\":{{\"role\":\"assistant\"}}}}]}}\n\n{}{}{}data: [DONE]\n\n",
            event(json!({"tool_calls":[{"index":1,"id":"second","type":"function","function":{"name":"app_request","arguments":"{\"method\":"}},{"index":0,"id":"first","function":{"name":"get_","arguments":"{"}}]}), Value::Null),
            event(json!({"tool_calls":[{"index":0,"function":{"name":"project","arguments":"}"}},{"index":1,"function":{"arguments":"\"GET\"}"}}]}), Value::Null),
            event(json!({}), json!("tool_calls")));
        let mut stream = Stream::default();
        for chunk in input.as_bytes().chunks(7) { stream.feed(chunk, &mut |_| Ok(())).unwrap(); }
        let completion = stream.finish().unwrap();
        assert_eq!(completion.message["tool_calls"], json!([
            {"id":"first","type":"function","function":{"name":"get_project","arguments":"{}"}},
            {"id":"second","type":"function","function":{"name":"app_request","arguments":"{\"method\":\"GET\"}"}}
        ]));
    }

    fn large_tool_stream() -> (String, Value) {
        let arguments = json!({"resource":"screenplays","method":"PATCH","id":1,
            "data":{"content":"窗外下着雨，主角走进教室。\n".repeat(400)}}).to_string();
        assert!(arguments.len() < MAX_ARGUMENT_BYTES);
        let call = json!({"id":"save-script","type":"function",
            "function":{"name":"app_request","arguments":arguments}});
        let mut input = event(json!({"tool_calls":[{"index":0,"id":call["id"],"type":"function",
            "function":{"name":"app_request","arguments":""}}]}), Value::Null);
        // Providers commonly emit single-character/token fragments; repeated
        // transport metadata can exceed 1 MB for a modest Chinese screenplay.
        for character in arguments.chars() {
            input.push_str(&format!("data: {}\n\n", json!({
                "id":"chatcmpl-screenplay-stream", "object":"chat.completion.chunk",
                "created":1, "model":"fixture-model",
                "choices":[{"index":0,"delta":{"tool_calls":[{"index":0,
                    "function":{"arguments":character.to_string()}}]},"finish_reason":null}]
            })));
        }
        assert!(input.len() > MAX_JSON_RESPONSE_BYTES);
        (input, call)
    }

    #[test]
    fn large_sse_envelopes_preserve_tools_with_fragmented_or_coalesced_http_chunks() {
        let (mut input, call) = large_tool_stream();
        input.push_str(&event(json!({}), json!("tool_calls")));
        input.push_str("data: [DONE]\n\n");
        for chunk_size in [97, input.len()] {
            let mut stream = Stream::default();
            for chunk in input.as_bytes().chunks(chunk_size) {
                stream.feed(chunk, &mut |_| Ok(())).unwrap();
                assert!(stream.pending.len() <= MAX_EVENT_BYTES);
            }
            let completion = stream.finish().unwrap();
            assert_eq!(completion.message["tool_calls"], json!([call]));
        }
    }

    #[test]
    fn near_limit_multiline_event_allows_crlf_split_at_internal_slice_boundary() {
        let first_payload_len = MAX_EVENT_BYTES / 2;
        let first_json = r#"{"choices":[]"#;
        let first_line = format!("data: {first_json}{}\n", " ".repeat(first_payload_len - first_json.len()));
        let second_payload_len = MAX_EVENT_BYTES - first_payload_len - "data: ".len();
        let second_line = format!("data: }}{}\r\n\r\n", " ".repeat(second_payload_len - 1));
        // Align the CR ending the second data line with an internal slice's
        // last byte. The CR is a delimiter, not another byte of event data.
        let cr_offset = first_line.len() + second_line.find('\r').unwrap();
        let prefix_len = 2 * MAX_EVENT_BYTES - 1 - cr_offset;
        let input = format!(":{}\n{first_line}{second_line}{}{}data: [DONE]\n\n",
            " ".repeat(prefix_len - 2), event(json!({"content":"完成"}), Value::Null),
            event(json!({}), json!("stop")));
        assert_eq!(input.find('\r'), Some(2 * MAX_EVENT_BYTES - 1));
        for chunk_size in [MAX_EVENT_BYTES, input.len()] {
            let mut stream = Stream::default();
            for chunk in input.as_bytes().chunks(chunk_size) {
                stream.feed(chunk, &mut |_| Ok(())).unwrap();
            }
            assert_eq!(stream.finish().unwrap().message, json!({"role":"assistant","content":"完成"}));
        }
    }

    #[test]
    fn discarded_reasoning_and_heartbeats_do_not_consume_the_public_text_budget() {
        let mut stream = Stream::default();
        let private = event(json!({"reasoning_content":"private".repeat(1000)}), Value::Null);
        let mut snapshots = Vec::new();
        let mut on_event = |event| { if let Event::Delta(text) = event { snapshots.push(text); } Ok(()) };
        for _ in 0..200 {
            stream.feed(b": heartbeat\n\n", &mut on_event).unwrap();
            stream.feed(private.as_bytes(), &mut on_event).unwrap();
        }
        assert!(stream.total_bytes > MAX_JSON_RESPONSE_BYTES);
        stream.feed(format!("{}{}data: [DONE]\n\n",
            event(json!({"content":"完成"}), Value::Null), event(json!({}), json!("stop"))).as_bytes(), &mut on_event).unwrap();
        assert_eq!(stream.finish().unwrap().message, json!({"role":"assistant","content":"完成"}));
        assert_eq!(snapshots, ["完成"]);
    }

    #[test]
    fn large_streams_still_require_successful_finish_and_done_before_releasing_tools() {
        let (input, _) = large_tool_stream();
        for suffix in [String::new(), event(json!({}), json!("tool_calls")),
            "data: [DONE]\n\n".into(), format!("{}data: [DONE]\n\n", event(json!({}), json!("length")))] {
            let mut stream = Stream::default();
            stream.feed(input.as_bytes(), &mut |_| Ok(())).unwrap();
            let result = stream.feed(suffix.as_bytes(), &mut |_| Ok(()));
            assert!(result.is_err() || stream.finish().is_err());
        }
    }

    #[test]
    fn incomplete_or_truncated_streams_never_release_tool_calls() {
        let call = event(json!({"tool_calls":[{"index":0,"id":"write","type":"function","function":{"name":"app_request","arguments":"{}"}}]}), Value::Null);
        for suffix in [String::new(), event(json!({}), json!("tool_calls")), "data: [DONE]\n\n".into(),
            format!("{}data: [DONE]\n\n", event(json!({}), json!("length"))),
            format!("{}data: [DONE]\n\n", event(json!({}), json!("stop")))] {
            let mut stream = Stream::default();
            let result = stream.feed(format!("{call}{suffix}").as_bytes(), &mut |_| Ok(()));
            assert!(result.is_err() || stream.finish().is_err());
        }
    }

    #[test]
    fn refusal_and_cr_only_line_endings_are_supported() {
        let input = format!("{}{}data: [DONE]\r\r",
            event(json!({"refusal":"无法完成该请求"}), Value::Null).replace("\r\n", "\r"),
            event(json!({}), json!("stop")).replace("\r\n", "\r"));
        let mut stream = Stream::default();
        stream.feed(input.as_bytes(), &mut |_| Ok(())).unwrap();
        let completion = stream.finish().unwrap();
        assert!(completion.message["content"].is_null());
        assert_eq!(completion.message["refusal"], "无法完成该请求");
    }

    #[test]
    fn capacity_limits_apply_before_dispatch() {
        let mut stream = Stream::default();
        assert!(stream.feed(&vec![b'x'; MAX_EVENT_BYTES + 1], &mut |_| Ok(())).is_err());
        for delta in [
            json!({"tool_calls":[{"index":8}]}),
            json!({"tool_calls":[{"index":0,"function":{"arguments":"x".repeat(MAX_ARGUMENT_BYTES + 1)}}]}),
            json!({"content":"x".repeat(MAX_TEXT_BYTES + 1)}),
        ] {
            let mut stream = Stream::default();
            assert!(stream.feed(event(delta, Value::Null).as_bytes(), &mut |_| Ok(())).is_err());
        }
    }

    #[test]
    fn stream_transport_budget_rejects_excess_even_when_no_output_is_retained() {
        let heartbeat = b": heartbeat\n\n";
        let mut stream = Stream { total_bytes: MAX_STREAM_RESPONSE_BYTES - heartbeat.len(), ..Stream::default() };
        stream.feed(heartbeat, &mut |_| Ok(())).unwrap();
        assert_eq!(stream.total_bytes, MAX_STREAM_RESPONSE_BYTES);
        let error = stream.feed(heartbeat, &mut |_| Ok(())).unwrap_err();
        assert!(error.contains("64 MiB"));
        assert!(stream.content.is_empty());
        assert!(stream.calls.is_empty());
    }

    #[test]
    fn accumulated_text_and_tool_arguments_remain_bounded_across_events() {
        for (key, limit, expected) in [("content", MAX_TEXT_BYTES, "回复过长"),
            ("refusal", MAX_TEXT_BYTES, "回复过长"), ("arguments", MAX_ARGUMENT_BYTES, "工具参数过大")] {
            let mut stream = Stream::default();
            let delta = |text: String| if key == "arguments" {
                json!({"tool_calls":[{"index":0,"function":{"arguments":text}}]})
            } else { json!({key:text}) };
            let fragment = event(delta("x".repeat(limit / 2)), Value::Null);
            for _ in 0..2 { stream.feed(fragment.as_bytes(), &mut |_| Ok(())).unwrap(); }
            let error = stream.feed(event(delta("界".into()), Value::Null).as_bytes(), &mut |_| Ok(())).unwrap_err();
            assert!(error.contains(expected), "{error}");
        }
    }

    #[test]
    fn provider_error_and_bad_encoding_are_not_treated_as_completion() {
        for input in [b"data: {\"error\":{\"message\":\"secret\"}}\n\n".as_slice(), b"data: \xff\n\n", b"data: invalid\n\n"] {
            let mut stream = Stream::default();
            assert!(stream.feed(input, &mut |_| Ok(())).is_err());
        }
    }

    #[test]
    fn json_fallback_retains_public_response_only() {
        let completion = json_completion(br#"{"choices":[{"message":{"role":"assistant","content":"done","reasoning_content":"private"},"finish_reason":"stop"}],"usage":{"total_tokens":5,"private":"secret"}}"#).unwrap();
        assert_eq!(completion.message, json!({"role":"assistant","content":"done"}));
        assert_eq!(completion.usage, json!({"total_tokens":5}));
        assert!(json_completion(br#"{"choices":[{"message":{"content":"partial"},"finish_reason":"length"}]}"#).is_err());
        assert!(json_completion(br#"{"choices":[{"message":{"tool_calls":[{}]},"finish_reason":"stop"}]}"#).is_err());
    }
}
