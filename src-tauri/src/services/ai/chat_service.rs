use std::sync::OnceLock;

use super::tool_registry;
use crate::config;
use crate::models::ai::*;
use futures_util::StreamExt;
use tauri::Emitter;

const TRACE_RESULT_MAX_CHARS: usize = 2400;

/// 全局复用的 HTTP 客户端（连接池跨请求共享，避免每次重建）
static HTTP_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

/// 获取全局 HTTP 客户端，首次调用时初始化
fn get_http_client() -> Result<&'static reqwest::Client, String> {
    Ok(HTTP_CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .build()
            .expect("Failed to create AI HTTP client")
    }))
}

// ─── 流式 SSE 内部辅助结构 ─────────────────────────────────────────────────────

/// 用于在 SSE 流中累积单个工具调用的各增量片段
struct PartialToolCall {
    id: String,
    call_type: String,
    name: String,
    arguments: String,
}

/// 调用流式 AI API，逐 token 通过 Tauri 事件推送给前端。
///
/// 返回值：`(accumulated_content, completed_tool_calls, finish_reason)`
/// - `accumulated_content`：本轮模型生成的全部文本（含工具轮的 thinking）
/// - `completed_tool_calls`：本轮调用的工具列表（finish_reason == "tool_calls" 时非空）
/// - `finish_reason`：`"stop"` | `"tool_calls"` | 其他
async fn call_ai_api_stream(
    api_key: &str,
    messages: &[AiChatMessage],
    tools: Option<&Vec<ToolDefinition>>,
    app: &tauri::AppHandle,
    // 预分配好的 owned message_id，避免在热路径中重复 to_string()
    mid: &str,
) -> Result<(String, Vec<ToolCall>, String), String> {
    let ai_cfg = &config::get().ai;
    let client = get_http_client()?;

    // 构造请求体（手动 json! 以便附加 stream 字段）
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
    let mut sse_buf = String::new(); // 未处理字节缓冲（跨 chunk 保留不完整行）
    let mut content_buf = String::new(); // 本轮累积文本
    let mut partial_tools: Vec<Option<PartialToolCall>> = Vec::new(); // 按 index 归并
    let mut finish_reason = String::from("stop");
    let mut done = false;

    while let Some(chunk_result) = byte_stream.next().await {
        if done {
            break;
        }
        let bytes = chunk_result.map_err(|e| format!("Stream read error: {}", e))?;
        sse_buf.push_str(&String::from_utf8_lossy(&bytes));

        // 游标扫描：在同一个 chunk 内处理所有完整行，不逐行分配新 String
        // 每个 chunk 只在结尾做一次截断，总体复杂度从 O(n²) 降为 O(n)
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

            // 用 serde_json::Value 宽松解析，避免 schema 细节不匹配
            let chunk: serde_json::Value = match serde_json::from_str(data) {
                Ok(v) => v,
                Err(_) => continue,
            };

            let choice = &chunk["choices"][0];

            // 更新 finish_reason
            if let Some(reason) = choice["finish_reason"].as_str() {
                if !reason.is_empty() {
                    finish_reason = reason.to_string();
                }
            }

            let delta = &choice["delta"];

            // ── 文本 token ──
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

            // ── 工具调用增量 ──
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

        // 丢弃已消费的字节，保留不完整的尾部行供下次 chunk 拼接
        if cursor > 0 {
            sse_buf.drain(..cursor);
        }
    }

    // 将累积的 PartialToolCall 转为完整的 ToolCall（保持 index 顺序）
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

/// 带工具调用的流式对话主逻辑。
///
/// 策略：
/// - 每轮均使用流式 API；工具调用轮次的 Token 事件由前端在收到 ToolStatus 时清除。
/// - finish_reason == "tool_calls"  → 执行工具，继续下一轮
/// - finish_reason == "stop"        → 最终回答已流式推送完毕，发送 Done 事件
pub async fn chat_with_tools_stream(
    api_key: &str,
    messages: Vec<AiChatMessage>,
    app: tauri::AppHandle,
    message_id: &str,
) -> Result<(), String> {
    let tools = tool_registry::build_tool_definitions();
    let mut conversation = messages;
    let mut rounds: Vec<ToolRoundTrace> = Vec::new();

    // 预分配一次，避免在每次 emit 调用时重复 to_string()
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
            // ── 工具调用轮次 ──────────────────────────────────────────────────
            let thinking = if content.trim().is_empty() {
                None
            } else {
                Some(content.clone())
            };

            // 将 assistant 消息（含工具调用）加入上下文
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
                // 通知前端当前正在执行的工具
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
            // ── 最终回答（Token 已实时推送完毕）────────────────────────────
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

    // ── 超过最大工具轮次，强制发起不带工具的最终流式请求 ──────────────────────
    if let Err(e) = call_ai_api_stream(
        api_key,
        &conversation,
        None, // 不传工具，强制生成文本回答
        &app,
        &mid,
    )
    .await
    {
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

/// 解析工具参数 JSON；若解析失败则保留原始入参与错误信息。
fn parse_tool_args(raw: &str) -> serde_json::Value {
    match serde_json::from_str::<serde_json::Value>(raw) {
        Ok(v) => v,
        Err(e) => serde_json::json!({
            "_raw": raw,
            "_parse_error": e.to_string()
        }),
    }
}

/// 截断工具结果长度，避免前端轨迹渲染内容过大。
fn truncate_for_trace(content: &str) -> String {
    let total_len = content.chars().count();
    if total_len <= TRACE_RESULT_MAX_CHARS {
        return content.to_string();
    }

    let truncated: String = content.chars().take(TRACE_RESULT_MAX_CHARS).collect();
    let omitted = total_len.saturating_sub(TRACE_RESULT_MAX_CHARS);
    format!("{}\n\n... (truncated {} chars)", truncated, omitted)
}
