//! Responses input and output use typed items. The public transcript still
//! uses the same messages and tool results as Chat Completions.
use super::*;
use model_transport::{Completion, Continuation, MAX_TEXT_BYTES};

pub(super) fn body(
    cfg: &Value,
    messages: Vec<Value>,
    tools: &Value,
    effort: Option<&str>,
) -> Value {
    let mut input = Vec::new();
    for mut message in messages {
        if let Some(Value::Array(output)) =
            message.as_object_mut().unwrap().remove("_response_output")
        {
            input.extend(output);
            continue;
        }
        if message["role"] == "tool" {
            input.push(json!({"type":"function_call_output","call_id":message["tool_call_id"],"output":message["content"]}));
            continue;
        }
        if let Some(parts) = message["content"].as_array_mut() {
            for part in parts {
                *part = if part["type"] == "image_url" {
                    json!({"type":"input_image","image_url":part["image_url"]["url"],"detail":"auto"})
                } else {
                    json!({"type":"input_text","text":part["text"]})
                };
            }
        }
        let calls = message.as_object_mut().unwrap().remove("tool_calls");
        if message["content"] != "" || calls.is_none() {
            input.push(message);
        }
        if let Some(Value::Array(calls)) = calls {
            input.extend(calls.into_iter().map(|call| {
                json!({"type":"function_call","call_id":call["id"],
                "name":call["function"]["name"],"arguments":call["function"]["arguments"]})
            }));
        }
    }
    let tools = tools
        .as_array()
        .unwrap()
        .iter()
        .map(|tool| {
            let mut function = tool["function"].clone();
            function["type"] = json!("function");
            function["strict"] = json!(false);
            function
        })
        .collect::<Vec<_>>();
    let mut body = json!({"model":cfg["model"],"input":input,"tools":tools,"parallel_tool_calls":false,
        "stream":true,"store":false,"include":["reasoning.encrypted_content"]});
    if let Some(effort) = effort {
        body["reasoning"] = json!({"effort":effort});
    }
    body
}

pub(super) fn completed(mut response: Value) -> Result<Completion, String> {
    if response["status"] != "completed" {
        return Err(
            if response["incomplete_details"]["reason"] == "max_output_tokens" {
                "Agent 模型输出被长度限制截断，请拆分任务后重试。"
            } else {
                "Agent 模型未完成 Responses 请求，工具未执行。"
            }
            .into(),
        );
    }
    let Some(Value::Array(output)) = response
        .as_object_mut()
        .and_then(|response| response.remove("output"))
    else {
        return Err("Agent 模型 Responses 缺少输出条目".into());
    };
    let mut content = String::new();
    let mut refusal = String::new();
    let mut calls = Vec::new();
    for item in &output {
        match item["type"].as_str() {
            Some("message") => {
                for part in item["content"]
                    .as_array()
                    .ok_or("Agent 模型返回了无效消息条目")?
                {
                    match part["type"].as_str() {
                        Some("output_text") => content
                            .push_str(part["text"].as_str().ok_or("Agent 模型返回了无效文本")?),
                        Some("refusal") => refusal.push_str(
                            part["refusal"]
                                .as_str()
                                .ok_or("Agent 模型返回了无效拒绝消息")?,
                        ),
                        _ => return Err("Agent 模型返回了不支持的消息内容".into()),
                    }
                }
            }
            Some("function_call") if item["status"].is_null() || item["status"] == "completed" => {
                calls.push(json!({"id":item["call_id"],"type":"function",
                    "function":{"name":item["name"],"arguments":item["arguments"]}}));
            }
            Some("reasoning") => {}
            _ => {
                return Err("Agent 模型返回了不支持或未完成的 Responses 条目，工具未执行。".into())
            }
        }
        if content.len() > MAX_TEXT_BYTES || refusal.len() > MAX_TEXT_BYTES {
            return Err("Agent 模型回复过长".into());
        }
    }
    let continuation = if calls.is_empty() {
        None
    } else {
        Some(Continuation::Responses(output))
    };
    let mut message = json!({"role":"assistant","content":content});
    if !refusal.is_empty() {
        message["refusal"] = json!(refusal);
        if content.is_empty() {
            message["content"] = Value::Null;
        }
    }
    if !calls.is_empty() {
        message["tool_calls"] = json!(calls);
    }
    let mut usage = json!({});
    for (input, output) in [
        ("input_tokens", "prompt_tokens"),
        ("output_tokens", "completion_tokens"),
        ("total_tokens", "total_tokens"),
    ] {
        if let Some(count) = response["usage"][input].as_u64() {
            usage[output] = json!(count);
        }
    }
    Ok(Completion {
        message,
        usage,
        continuation,
    })
}
