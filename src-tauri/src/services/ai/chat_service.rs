use super::tool_registry;
use crate::config;
use crate::models::ai::*;

const TRACE_RESULT_MAX_CHARS: usize = 2400;

/// 创建 HTTP 客户端（用于 DeepSeek API 请求）
fn build_http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))
}

/// 调用 AI 聊天接口，支持可选 tools
async fn call_ai_api(
    client: &reqwest::Client,
    api_key: &str,
    messages: &[AiChatMessage],
    tools: Option<&Vec<ToolDefinition>>,
) -> Result<AiResponse, String> {
    let ai_cfg = &config::get().ai;
    let body = AiChatRequest {
        model: ai_cfg.model.clone(),
        messages: messages.to_vec(),
        max_tokens: ai_cfg.max_tokens,
        tools: tools.cloned(),
    };

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

    response
        .json::<AiResponse>()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))
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

/// 进行带工具调用的对话，并返回轮次轨迹与最终总结。
pub async fn chat_with_tools(
    api_key: &str,
    messages: Vec<AiChatMessage>,
) -> Result<ChatWithToolsResponse, String> {
    let client = build_http_client()?;
    let tools = tool_registry::build_tool_definitions();
    let mut conversation = messages;
    let mut rounds: Vec<ToolRoundTrace> = Vec::new();

    for round_idx in 0..config::get().ai.max_tool_rounds {
        let ai_resp = call_ai_api(&client, api_key, &conversation, Some(&tools)).await?;

        let choice = ai_resp
            .choices
            .first()
            .ok_or_else(|| "No response from AI".to_string())?;

        if let Some(tool_calls) = &choice.message.tool_calls {
            if tool_calls.is_empty() {
                let summary = choice
                    .message
                    .content
                    .clone()
                    .ok_or_else(|| "No response from AI".to_string())?;

                return Ok(ChatWithToolsResponse { summary, rounds });
            }

            let thinking = choice
                .message
                .content
                .clone()
                .filter(|text| !text.trim().is_empty());

            let assistant_msg = AiChatMessage {
                role: "assistant".to_string(),
                content: thinking
                    .as_ref()
                    .map(|s| serde_json::Value::String(s.clone())),
                tool_calls: Some(tool_calls.clone()),
                tool_call_id: None,
                name: None,
            };
            conversation.push(assistant_msg);

            let mut round_trace = ToolRoundTrace {
                round: round_idx + 1,
                thinking,
                tool_calls: Vec::new(),
            };

            for tc in tool_calls {
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
            let summary = choice
                .message
                .content
                .clone()
                .ok_or_else(|| "No response from AI".to_string())?;

            return Ok(ChatWithToolsResponse { summary, rounds });
        }
    }

    let final_resp = call_ai_api(&client, api_key, &conversation, None).await?;
    let summary = final_resp
        .choices
        .first()
        .and_then(|c| c.message.content.clone())
        .ok_or_else(|| "No response from AI after tool calls".to_string())?;

    Ok(ChatWithToolsResponse { summary, rounds })
}
