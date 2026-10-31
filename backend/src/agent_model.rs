//! Model transport is cancellable, including response reads and retry backoff.
//! Only inference requests are retried; business tools must never be replayed here.
use super::*;

pub(super) struct Completion {
    pub message: Value,
    pub usage: Value,
}

enum Failure {
    Retry(u64),
    Fatal(String),
}

async fn attempt(client: &reqwest::Client, url: &str, cfg: &Value, body: &Value) -> Result<Completion, Failure> {
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
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| Failure::Fatal("读取 Agent 模型响应失败".into()))? {
        if bytes.len() + chunk.len() > 1_000_000 { return Err(Failure::Fatal("Agent 模型响应过大".into())); }
        bytes.extend_from_slice(&chunk);
    }
    let response: Value = serde_json::from_slice(&bytes).map_err(|_| Failure::Fatal("Agent 模型返回了无效 JSON".into()))?;
    if response.pointer("/choices/0/finish_reason").and_then(Value::as_str) == Some("length") {
        return Err(Failure::Fatal("Agent 模型输出被长度限制截断，请拆分任务后重试。".into()));
    }
    let message = response.pointer("/choices/0/message").filter(|value| value.is_object())
        .ok_or_else(|| Failure::Fatal("Agent 模型没有返回有效消息".into()))?.clone();
    // Whitelist counters: provider metadata must not enter persisted state unchecked.
    let mut usage = json!({});
    for key in ["prompt_tokens", "completion_tokens", "total_tokens"] {
        if let Some(count) = response["usage"][key].as_u64() { usage[key] = json!(count); }
    }
    Ok(Completion { message, usage })
}

pub(super) async fn completion(
    client: &reqwest::Client, url: &str, cfg: &Value, messages: Vec<Value>, tools: &Value,
    cancel: &AtomicBool, mut on_attempt: impl FnMut(bool) -> Result<(), String>,
) -> Result<Completion, String> {
    let mut text_messages = messages.clone();
    for message in &mut text_messages {
        if let Some(parts) = message["content"].as_array_mut() { parts.retain(|part| part["type"] != "image_url"); }
    }
    if serde_json::to_vec(&text_messages).map_err(|_| "上下文编码失败")?.len() > MAX_CONTEXT + 100_000 {
        return Err("本次执行上下文已达上限，请创建新对话。".into());
    }
    let finalizing = tools.as_array().is_some_and(Vec::is_empty);
    let mut body = json!({"model":cfg["model"],"messages":messages,"tool_choice":if finalizing {"none"} else {"auto"}});
    if !finalizing { body["tools"] = tools.clone(); body["parallel_tool_calls"] = json!(false); }
    if body.to_string().len() > MAX_SESSION + 100_000 {
        return Err("本次执行上下文已达上限。请创建新对话，或拆分任务后继续。".into());
    }
    let work = async {
        for retry in 0..=2 {
            on_attempt(false)?;
            match attempt(client, url, cfg, &body).await {
                Ok(completion) => return Ok(completion),
                Err(Failure::Fatal(error)) => return Err(error),
                Err(Failure::Retry(delay)) if retry < 2 => {
                    on_attempt(true)?;
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
