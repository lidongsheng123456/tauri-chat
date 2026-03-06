use crate::config;
use crate::models::ai::*;
use crate::services::{tools_service, web_scraper, web_search};

/// 快捷创建工具定义
fn tool(name: &str, desc: &str, params: serde_json::Value) -> ToolDefinition {
    ToolDefinition {
        tool_type: "function".to_string(),
        function: ToolFunctionDef {
            name: name.to_string(),
            description: desc.to_string(),
            parameters: params,
        },
    }
}

/// 构建 AI 可调用的全部工具定义列表
fn build_tool_definitions() -> Vec<ToolDefinition> {
    vec![
        tool(
            "browse_website",
            "抓取并解析网页内容，返回标题、正文和链接。用于获取网站的完整资料。",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "url": { "type": "string", "description": "要浏览的网页 URL" }
                },
                "required": ["url"]
            }),
        ),
        tool(
            "fetch_url_raw",
            "获取 URL 的原始文本内容，适用于 API 接口或 JSON 数据。",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "url": { "type": "string", "description": "要获取的 URL" }
                },
                "required": ["url"]
            }),
        ),
        tool(
            "web_search",
            "搜索互联网，返回相关网页结果列表。当用户询问最新信息、不确定的事实、或需要查找资料时使用。",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "搜索关键词" }
                },
                "required": ["query"]
            }),
        ),
        tool(
            "extract_webpage_images",
            "提取网页中的所有图片 URL 和描述信息。用于获取网页上的图片列表。",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "url": { "type": "string", "description": "要提取图片的网页 URL" }
                },
                "required": ["url"]
            }),
        ),
        tool(
            "get_current_datetime",
            "获取当前精确的日期和时间、星期几、时区和 Unix 时间戳。当用户询问现在几点、今天日期、今天星期几时使用。",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "timezone": { "type": "string", "description": "时区名称（可选，默认系统时区）" }
                }
            }),
        ),
        tool(
            "encode_decode",
            "对文本进行编码或解码。支持 base64、url、hex 三种编码格式。",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "action": { "type": "string", "enum": ["encode", "decode"], "description": "操作类型" },
                    "encoding": { "type": "string", "enum": ["base64", "url", "hex"], "description": "编码格式" },
                    "text": { "type": "string", "description": "要编码或解码的文本" }
                },
                "required": ["action", "encoding", "text"]
            }),
        ),
        tool(
            "get_ip_geolocation",
            "查询 IP 地址的地理位置信息（国家、城市、ISP、经纬度）。不传 IP 则查询当前出口 IP。",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "ip": { "type": "string", "description": "要查询的 IP 地址（可选，不传则查当前 IP）" }
                }
            }),
        ),
        tool(
            "text_stats",
            "统计文本的字符数、中文字符数、英文单词数、行数和字节数。",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "text": { "type": "string", "description": "要统计的文本内容" }
                },
                "required": ["text"]
            }),
        ),
    ]
}

/// 执行单次工具调用，返回结果字符串
async fn execute_tool_call(tool_call: &ToolCall) -> String {
    let args = &tool_call.function.arguments;
    match tool_call.function.name.as_str() {
        "browse_website" => match serde_json::from_str::<BrowseArgs>(args) {
            Ok(a) => web_scraper::browse_website(&a.url).await,
            Err(e) => format!("参数解析失败: {}", e),
        },
        "fetch_url_raw" => match serde_json::from_str::<FetchRawArgs>(args) {
            Ok(a) => web_scraper::fetch_url_raw(&a.url).await,
            Err(e) => format!("参数解析失败: {}", e),
        },
        "web_search" => match serde_json::from_str::<SearchArgs>(args) {
            Ok(a) => web_search::web_search(&a.query).await,
            Err(e) => format!("参数解析失败: {}", e),
        },
        "extract_webpage_images" => match serde_json::from_str::<ExtractImagesArgs>(args) {
            Ok(a) => web_search::extract_webpage_images(&a.url).await,
            Err(e) => format!("参数解析失败: {}", e),
        },
        "get_current_datetime" => match serde_json::from_str::<DatetimeArgs>(args) {
            Ok(a) => tools_service::get_current_datetime(a.timezone.as_deref()),
            Err(e) => format!("参数解析失败: {}", e),
        },
        "encode_decode" => match serde_json::from_str::<EncodeDecodeArgs>(args) {
            Ok(a) => tools_service::encode_decode(&a.action, &a.encoding, &a.text),
            Err(e) => format!("参数解析失败: {}", e),
        },
        "get_ip_geolocation" => match serde_json::from_str::<IpGeoArgs>(args) {
            Ok(a) => tools_service::get_ip_geolocation(a.ip.as_deref()).await,
            Err(e) => format!("参数解析失败: {}", e),
        },
        "text_stats" => match serde_json::from_str::<TextStatsArgs>(args) {
            Ok(a) => tools_service::text_stats(&a.text),
            Err(e) => format!("参数解析失败: {}", e),
        },
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
    let tools = build_tool_definitions();
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
                let result = execute_tool_call(tc).await;
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
