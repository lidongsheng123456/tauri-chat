use crate::models::ai::*;
use crate::services::web_scraper;

/// AI API 端点
const AI_API_URL: &str = "https://api.deepseek.com/chat/completions";
/// 默认模型
const AI_MODEL: &str = "deepseek-chat";
/// 单次请求最大 token 数
const MAX_TOKENS: u32 = 4000;
/// 工具调用最大轮次
const MAX_TOOL_ROUNDS: usize = 5;

/// 构建 AI 可调用的工具定义列表（browse_website、fetch_url_raw）
fn build_tool_definitions() -> Vec<ToolDefinition> {
    vec![
        ToolDefinition {
            tool_type: "function".to_string(),
            function: ToolFunctionDef {
                name: "browse_website".to_string(),
                description: "抓取并解析网页内容，返回网页标题、正文文本和链接列表。用于获取网站的完整资料。".to_string(),
                parameters: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "url": {
                            "type": "string",
                            "description": "要浏览的网页 URL，例如 https://example.com"
                        }
                    },
                    "required": ["url"]
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".to_string(),
            function: ToolFunctionDef {
                name: "fetch_url_raw".to_string(),
                description: "获取 URL 的原始文本内容，适用于 API 接口或 JSON 数据。".to_string(),
                parameters: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "url": {
                            "type": "string",
                            "description": "要获取的 URL"
                        }
                    },
                    "required": ["url"]
                }),
            },
        },
    ]
}

/// 执行单次工具调用，返回结果字符串
async fn execute_tool_call(tool_call: &ToolCall) -> String {
    match tool_call.function.name.as_str() {
        "browse_website" => {
            match serde_json::from_str::<BrowseArgs>(&tool_call.function.arguments) {
                Ok(args) => web_scraper::browse_website(&args.url).await,
                Err(e) => format!("参数解析失败: {}", e),
            }
        }
        "fetch_url_raw" => {
            match serde_json::from_str::<FetchRawArgs>(&tool_call.function.arguments) {
                Ok(args) => web_scraper::fetch_url_raw(&args.url).await,
                Err(e) => format!("参数解析失败: {}", e),
            }
        }
        other => format!("未知工具: {}", other),
    }
}

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
    let body = AiChatRequest {
        model: AI_MODEL.to_string(),
        messages: messages.to_vec(),
        max_tokens: MAX_TOKENS,
        tools: tools.cloned(),
    };

    let response = client
        .post(AI_API_URL)
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

    response.json::<AiResponse>()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))
}

/// 从 AI 消息中提取文本内容
fn extract_content(msg: &AiMessage) -> Option<String> {
    msg.content.clone()
}

/// 带工具调用的 AI 对话，支持多轮工具调用
pub async fn chat_with_tools(api_key: &str, messages: Vec<AiChatMessage>) -> Result<String, String> {
    let client = build_http_client()?;
    let tools = build_tool_definitions();
    let mut conversation = messages;

    for _round in 0..MAX_TOOL_ROUNDS {
        let ai_resp = call_ai_api(&client, api_key, &conversation, Some(&tools)).await?;

        let choice = ai_resp.choices.first()
            .ok_or_else(|| "No response from AI".to_string())?;

        if let Some(tool_calls) = &choice.message.tool_calls {
            if tool_calls.is_empty() {
                return extract_content(&choice.message)
                    .ok_or_else(|| "No response from AI".to_string());
            }

            let assistant_msg = AiChatMessage {
                role: "assistant".to_string(),
                content: choice.message.content.as_ref()
                    .map(|s| serde_json::Value::String(s.clone())),
                tool_calls: Some(tool_calls.clone()),
                tool_call_id: None,
                name: None,
            };
            conversation.push(assistant_msg);

            for tc in tool_calls {
                let result = execute_tool_call(tc).await;
                conversation.push(AiChatMessage::tool_result(&tc.id, &tc.function.name, &result));
            }
        } else {
            return extract_content(&choice.message)
                .ok_or_else(|| "No response from AI".to_string());
        }
    }

    let final_resp = call_ai_api(&client, api_key, &conversation, None).await?;
    final_resp.choices.first()
        .and_then(|c| extract_content(&c.message))
        .ok_or_else(|| "No response from AI after tool calls".to_string())
}

