use std::sync::OnceLock;

use super::tool_registry;
use crate::config;
use crate::models::ai::*;
use futures_util::StreamExt;
use tauri::Emitter;

const TRACE_RESULT_MAX_CHARS: usize = 2400;

/// 全局复用的 AI HTTP 客户端，连接池在应用生命周期内持续共享。
static HTTP_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

/// 获取全局 AI HTTP 客户端，首次调用时完成初始化。
///
/// # Returns
///
/// * `Ok(&'static reqwest::Client)` - 可复用的全局 HTTP 客户端引用。
///
/// # Errors
///
/// * 若 `reqwest::Client` 构建失败（极少见），进程将 panic，因为这属于不可恢复的初始化错误。
fn get_http_client() -> Result<&'static reqwest::Client, String> {
    Ok(HTTP_CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .build()
            .expect("Failed to create AI HTTP client")
    }))
}

// ─── 流式 SSE 内部辅助结构 ─────────────────────────────────────────────────────

/// 在 SSE 流解析过程中，用于按 `index` 归并同一个工具调用的各增量片段。
///
/// AI API 在流式模式下会将单次工具调用的 `id`、`name`、`arguments`
/// 分散在多个 chunk 中推送，需在本地累积完整后再执行。
struct PartialToolCall {
    /// 工具调用的唯一标识符，由首个包含 `id` 字段的 chunk 赋值。
    id: String,
    /// 调用类型，AI API 规范中固定为 `"function"`。
    call_type: String,
    /// 工具函数名称，从各 chunk 的 `function.name` 字段拼接而来。
    name: String,
    /// 工具参数 JSON 字符串，从各 chunk 的 `function.arguments` 字段拼接而来。
    arguments: String,
}

/// 向 AI API 发起一次流式请求，将收到的文本 token 实时通过 Tauri 事件推送至前端。
///
/// 使用游标扫描方式解析 SSE 字节流：在每个 HTTP chunk 内遍历所有完整行，
/// 仅在 chunk 末尾执行一次缓冲区截断，总体复杂度为 O(n)。
///
/// 若本轮模型选择调用工具（`finish_reason == "tool_calls"`），则文本 token
/// 为模型的思考内容，已通过 `Token` 事件推送至前端；前端在收到后续 `ToolStatus`
/// 事件时应清空这些思考文本。
///
/// # Arguments
///
/// * `api_key`  - DeepSeek API 鉴权密钥。
/// * `messages` - 本轮请求的完整上下文消息列表。
/// * `tools`    - 可供模型调用的工具定义列表，传 `None` 时强制模型生成文本回答。
/// * `app`      - Tauri 应用句柄，用于向前端发射 `Token` 事件。
/// * `mid`      - 当前流式会话的消息 ID（预分配，避免热路径重复分配）。
///
/// # Returns
///
/// * `Ok((content, tool_calls, finish_reason))`:
///   * `content`       - 本轮模型生成的全部文本（含工具轮的思考内容）。
///   * `tool_calls`    - 本轮解析完成的工具调用列表，`finish_reason == "stop"` 时为空。
///   * `finish_reason` - 模型停止原因，`"stop"` 表示正常结束，`"tool_calls"` 表示需执行工具。
///
/// # Errors
///
/// * 若 HTTP 请求发送失败，返回网络错误信息。
/// * 若 AI API 返回非 2xx 状态码，返回包含状态码与响应体的错误信息。
/// * 若流式数据读取中途发生 IO 错误，返回对应错误信息。
async fn call_ai_api_stream(
    api_key: &str,
    messages: &[AiChatMessage],
    tools: Option<&Vec<ToolDefinition>>,
    app: &tauri::AppHandle,
    mid: &str,
) -> Result<(String, Vec<ToolCall>, String), String> {
    let ai_cfg = &config::get().ai;
    let client = get_http_client()?;

    let mut body = serde_json::json!({
        "model": ai_cfg.model,
        "messages": messages,
        "max_tokens": ai_cfg.max_tokens,
        "stream": true,
    });
    if let Some(t) = tools {
        body["tools"] = serde_json::to_value(t).unwrap_or(serde_json::Value::Null);
    }

    let response = client
        .post(&ai_cfg.api_url)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("API error ({}): {}", status, text));
    }

    let mut byte_stream = response.bytes_stream();
    let mut sse_buf = String::new(); // 跨 chunk 保留尚未处理的不完整行
    let mut content_buf = String::new();
    let mut partial_tools: Vec<Option<PartialToolCall>> = Vec::new(); // 按 index 归并工具调用增量
    let mut finish_reason = String::from("stop");
    let mut done = false;

    while let Some(chunk_result) = byte_stream.next().await {
        if done {
            break;
        }
        let bytes = chunk_result.map_err(|e| format!("Stream read error: {}", e))?;
        sse_buf.push_str(&String::from_utf8_lossy(&bytes));

        // 游标扫描当前 chunk 内所有完整行，避免逐行重新分配 sse_buf（O(n²) → O(n)）
        let mut cursor = 0;
        loop {
            let Some(rel) = sse_buf[cursor..].find('\n') else {
                break;
            };
            let end = cursor + rel;
            let line = sse_buf[cursor..end].trim_end_matches('\r');
            cursor = end + 1;

            if line.is_empty() {
                continue;
            }

            let data = match line.strip_prefix("data: ") {
                Some(d) => d.trim(),
                None => continue,
            };

            if data == "[DONE]" {
                done = true;
                break;
            }

            // 宽松解析为 Value，避免因 API 响应 schema 细节变化导致整体解析失败
            let chunk: serde_json::Value = match serde_json::from_str(data) {
                Ok(v) => v,
                Err(_) => continue,
            };

            let choice = &chunk["choices"][0];

            if let Some(reason) = choice["finish_reason"].as_str() {
                if !reason.is_empty() {
                    finish_reason = reason.to_string();
                }
            }

            let delta = &choice["delta"];

            // ── 文本 token：实时推送至前端 ──
            if let Some(content) = delta["content"].as_str() {
                if !content.is_empty() {
                    content_buf.push_str(content);
                    let _ = app.emit(
                        "ai-stream",
                        AiStreamEvent::Token {
                            message_id: mid.to_string(),
                            content: content.to_string(),
                        },
                    );
                }
            }

            // ── 工具调用增量：按 index 归并到 partial_tools ──
            if let Some(tc_array) = delta["tool_calls"].as_array() {
                for tc_val in tc_array {
                    let index = tc_val["index"].as_u64().unwrap_or(0) as usize;
                    while partial_tools.len() <= index {
                        partial_tools.push(None);
                    }
                    let entry = partial_tools[index].get_or_insert_with(|| PartialToolCall {
                        id: String::new(),
                        call_type: "function".to_string(),
                        name: String::new(),
                        arguments: String::new(),
                    });
                    if let Some(id) = tc_val["id"].as_str() {
                        entry.id = id.to_string();
                    }
                    if let Some(t) = tc_val["type"].as_str() {
                        entry.call_type = t.to_string();
                    }
                    if let Some(name) = tc_val["function"]["name"].as_str() {
                        entry.name.push_str(name);
                    }
                    if let Some(args) = tc_val["function"]["arguments"].as_str() {
                        entry.arguments.push_str(args);
                    }
                }
            }
        }

        // 丢弃已消费字节，保留尾部不完整行供下次 chunk 拼接
        if cursor > 0 {
            sse_buf.drain(..cursor);
        }
    }

    let tool_calls: Vec<ToolCall> = partial_tools
        .into_iter()
        .flatten()
        .map(|tc| ToolCall {
            id: tc.id,
            call_type: tc.call_type,
            function: ToolFunction {
                name: tc.name,
                arguments: tc.arguments,
            },
        })
        .collect();

    Ok((content_buf, tool_calls, finish_reason))
}

/// 执行带工具调用能力的多轮流式对话，通过 Tauri 事件向前端实时推送进度。
///
/// 每轮均使用流式 API；根据 `finish_reason` 决定后续行为：
///
/// * `"tool_calls"` — 执行本轮所有工具调用，将结果追加至上下文后继续下一轮。
/// * `"stop"`       — 最终回答已通过 `Token` 事件实时推送完毕，发送 `Done` 事件结束会话。
///
/// 若达到最大工具调用轮次上限（`max_tool_rounds`），强制发起一次不带工具定义的
/// 流式请求，迫使模型直接生成文本回答。
///
/// # Arguments
///
/// * `api_key`    - DeepSeek API 鉴权密钥。
/// * `messages`   - 初始上下文消息列表，包含系统提示与对话历史。
/// * `app`        - Tauri 应用句柄，用于向前端发射流式进度事件。
/// * `message_id` - 当前流式会话的消息唯一标识符，用于前端按会话过滤事件。
///
/// # Returns
///
/// * `Ok(())` - 对话正常结束，`Done` 事件已发射。
///
/// # Errors
///
/// * 若任意轮次的 HTTP 请求失败，返回错误信息并同时向前端发射 `Error` 事件。
/// * 若 AI API 返回非 2xx 状态码，返回包含状态码的错误信息。
pub async fn chat_with_tools_stream(
    api_key: &str,
    messages: Vec<AiChatMessage>,
    app: tauri::AppHandle,
    message_id: &str,
) -> Result<(), String> {
    let tools = tool_registry::build_tool_definitions();
    let mut conversation = messages;
    let mut rounds: Vec<ToolRoundTrace> = Vec::new();

    // 预分配一次，避免在每次 emit 时重复调用 to_string()
    let mid = message_id.to_string();

    let emit_err = |msg: String| {
        let _ = app.emit(
            "ai-stream",
            AiStreamEvent::Error {
                message_id: mid.clone(),
                message: msg,
            },
        );
    };

    for round_idx in 0..config::get().ai.max_tool_rounds {
        let (content, tool_calls, finish_reason) =
            match call_ai_api_stream(api_key, &conversation, Some(&tools), &app, &mid).await {
                Ok(v) => v,
                Err(e) => {
                    emit_err(e.clone());
                    return Err(e);
                }
            };

        if finish_reason == "tool_calls" && !tool_calls.is_empty() {
            let thinking = if content.trim().is_empty() {
                None
            } else {
                Some(content.clone())
            };

            conversation.push(AiChatMessage {
                role: "assistant".to_string(),
                content: thinking
                    .as_ref()
                    .map(|s| serde_json::Value::String(s.clone())),
                tool_calls: Some(tool_calls.clone()),
                tool_call_id: None,
                name: None,
            });

            let mut round_trace = ToolRoundTrace {
                round: round_idx + 1,
                thinking,
                tool_calls: Vec::new(),
            };

            for tc in &tool_calls {
                let _ = app.emit(
                    "ai-stream",
                    AiStreamEvent::ToolStatus {
                        message_id: mid.clone(),
                        status: format!("正在调用: {}", tc.function.name),
                        round: round_idx + 1,
                    },
                );

                let args_value = parse_tool_args(&tc.function.arguments);
                let result =
                    tool_registry::execute_tool(&tc.function.name, args_value.clone()).await;

                round_trace.tool_calls.push(ToolCallTrace {
                    tool_call_id: tc.id.clone(),
                    tool_name: tc.function.name.clone(),
                    arguments: args_value,
                    result: truncate_for_trace(&result),
                });

                conversation.push(AiChatMessage::tool_result(
                    &tc.id,
                    &tc.function.name,
                    &result,
                ));
            }

            rounds.push(round_trace);
        } else {
            let _ = app.emit(
                "ai-stream",
                AiStreamEvent::Done {
                    message_id: mid,
                    rounds,
                },
            );
            return Ok(());
        }
    }

    // 超出最大工具轮次，不传工具定义以强制模型生成文本回答
    if let Err(e) = call_ai_api_stream(api_key, &conversation, None, &app, &mid).await {
        emit_err(e.clone());
        return Err(e);
    }

    let _ = app.emit(
        "ai-stream",
        AiStreamEvent::Done {
            message_id: mid,
            rounds,
        },
    );

    Ok(())
}

/// 将工具参数字符串解析为 JSON Value。
///
/// # Arguments
///
/// * `raw` - AI 模型生成的工具参数 JSON 字符串。
///
/// # Returns
///
/// * 解析成功时返回对应的 `serde_json::Value`。
/// * 解析失败时返回包含 `_raw` 原始字符串与 `_parse_error` 错误信息的 JSON 对象，
///   确保调用链不中断，同时保留调试信息。
fn parse_tool_args(raw: &str) -> serde_json::Value {
    match serde_json::from_str::<serde_json::Value>(raw) {
        Ok(v) => v,
        Err(e) => serde_json::json!({
            "_raw": raw,
            "_parse_error": e.to_string()
        }),
    }
}

/// 截断工具执行结果的文本长度，防止超长内容导致前端轨迹渲染卡顿。
///
/// # Arguments
///
/// * `content` - 工具执行返回的原始文本结果。
///
/// # Returns
///
/// * 若内容未超过 `TRACE_RESULT_MAX_CHARS`，原样返回。
/// * 若超过上限，截取前 `TRACE_RESULT_MAX_CHARS` 个字符，并在末尾追加省略提示行。
fn truncate_for_trace(content: &str) -> String {
    let total_len = content.chars().count();
    if total_len <= TRACE_RESULT_MAX_CHARS {
        return content.to_string();
    }

    let truncated: String = content.chars().take(TRACE_RESULT_MAX_CHARS).collect();
    let omitted = total_len.saturating_sub(TRACE_RESULT_MAX_CHARS);
    format!("{}\n\n... (truncated {} chars)", truncated, omitted)
}
