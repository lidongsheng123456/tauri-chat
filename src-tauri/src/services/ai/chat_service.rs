use crate::config;
use crate::models::ai::*;
use super::tool_registry;

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

/// 带工具调用的 AI 对话，支持多轮工具调用
pub async fn chat_with_tools(
    api_key: &str,
    messages: Vec<AiChatMessage>,
) -> Result<String, String> {
    let client = build_http_client()?;
    let tools = tool_registry::build_tool_definitions();
    let mut conversation = messages;

    for _round in 0..config::get().ai.max_tool_rounds {
        let ai_resp = call_ai_api(&client, api_key, &conversation, Some(&tools)).await?;

        let choice = ai_resp
            .choices
            .first()
            .ok_or_else(|| "No response from AI".to_string())?;

        if let Some(tool_calls) = &choice.message.tool_calls {
            if tool_calls.is_empty() {
                return choice
                    .message
                    .content
                    .clone()
                    .ok_or_else(|| "No response from AI".to_string());
            }

            let assistant_msg = AiChatMessage {
                role: "assistant".to_string(),
                content: choice
                    .message
                    .content
                    .as_ref()
                    .map(|s| serde_json::Value::String(s.clone())),
                tool_calls: Some(tool_calls.clone()),
                tool_call_id: None,
                name: None,
            };
            conversation.push(assistant_msg);

            for tc in tool_calls {
                let args_value: serde_json::Value =
                    serde_json::from_str(&tc.function.arguments).unwrap_or_default();
                let result = tool_registry::execute_tool(&tc.function.name, args_value).await;
                conversation.push(AiChatMessage::tool_result(
                    &tc.id,
                    &tc.function.name,
                    &result,
                ));
            }
        } else {
            return choice
                .message
                .content
                .clone()
                .ok_or_else(|| "No response from AI".to_string());
        }
    }

    let final_resp = call_ai_api(&client, api_key, &conversation, None).await?;
    final_resp
        .choices
        .first()
        .and_then(|c| c.message.content.clone())
        .ok_or_else(|| "No response from AI after tool calls".to_string())
}
