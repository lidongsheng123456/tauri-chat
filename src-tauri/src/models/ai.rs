use serde::{Deserialize, Serialize};

/// AI 响应中的单个选项，包含一条消息
#[derive(Deserialize)]
pub struct AiChoice {
    pub message: AiMessage,
}

/// AI 消息内容，可能包含文本或工具调用
#[derive(Deserialize)]
pub struct AiMessage {
    pub content: Option<String>,
    pub tool_calls: Option<Vec<ToolCall>>,
}

/// AI API 完整响应，包含 choices 数组
#[derive(Deserialize)]
pub struct AiResponse {
    pub choices: Vec<AiChoice>,
}

/// 发送给 AI API 的聊天请求体
#[derive(Serialize)]
pub struct AiChatRequest {
    pub model: String,
    pub messages: Vec<AiChatMessage>,
    pub max_tokens: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tools: Option<Vec<ToolDefinition>>,
}

/// 单次工具执行轨迹，用于前端展示。
#[derive(Serialize, Clone, Debug)]
pub struct ToolCallTrace {
    pub tool_call_id: String,
    pub tool_name: String,
    pub arguments: serde_json::Value,
    pub result: String,
}

/// 一轮工具调用轨迹（思考文本 + 工具执行列表）。
#[derive(Serialize, Clone, Debug)]
pub struct ToolRoundTrace {
    pub round: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thinking: Option<String>,
    pub tool_calls: Vec<ToolCallTrace>,
}

/// 返回给前端的完整对话结果。
#[derive(Serialize, Clone, Debug)]
pub struct ChatWithToolsResponse {
    pub summary: String,
    pub rounds: Vec<ToolRoundTrace>,
}

/// 单条聊天消息，支持文本、工具调用与工具结果。
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AiChatMessage {
    pub role: String,
    pub content: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<ToolCall>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

impl AiChatMessage {
    /// 构造纯文本消息
    pub fn text(role: &str, content: &str) -> Self {
        Self {
            role: role.to_string(),
            content: Some(serde_json::Value::String(content.to_string())),
            tool_calls: None,
            tool_call_id: None,
            name: None,
        }
    }

    /// 构造工具调用结果消息
    pub fn tool_result(tool_call_id: &str, name: &str, content: &str) -> Self {
        Self {
            role: "tool".to_string(),
            content: Some(serde_json::Value::String(content.to_string())),
            tool_calls: None,
            tool_call_id: Some(tool_call_id.to_string()),
            name: Some(name.to_string()),
        }
    }
}

/// 工具调用，包含 id、类型和函数参数
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ToolCall {
    pub id: String,
    #[serde(rename = "type")]
    pub call_type: String,
    pub function: ToolFunction,
}

/// 工具函数调用参数，name 与 arguments（JSON 字符串）
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ToolFunction {
    pub name: String,
    pub arguments: String,
}

/// 工具定义，用于 API 请求中的 tools 数组
#[derive(Serialize, Clone)]
pub struct ToolDefinition {
    #[serde(rename = "type")]
    pub tool_type: String,
    pub function: ToolFunctionDef,
}

/// 工具函数定义，包含名称、描述和参数 schema
#[derive(Serialize, Clone)]
pub struct ToolFunctionDef {
    pub name: String,
    pub description: String,
    pub parameters: serde_json::Value,
}

/// browse_website 工具的参数
#[derive(Deserialize)]
pub struct BrowseArgs {
    pub url: String,
}

/// fetch_url_raw 工具的参数
#[derive(Deserialize)]
pub struct FetchRawArgs {
    pub url: String,
}

/// web_search 工具的参数
#[derive(Deserialize)]
pub struct SearchArgs {
    pub query: String,
}

/// extract_webpage_images 工具的参数
#[derive(Deserialize)]
pub struct ExtractImagesArgs {
    pub url: String,
}

/// get_current_datetime 工具的参数
#[derive(Deserialize)]
pub struct DatetimeArgs {
    pub timezone: Option<String>,
}

/// encode_decode 工具的参数
#[derive(Deserialize)]
pub struct EncodeDecodeArgs {
    pub action: String,
    pub encoding: String,
    pub text: String,
}

/// get_ip_geolocation 工具的参数
#[derive(Deserialize)]
pub struct IpGeoArgs {
    pub ip: Option<String>,
}

/// text_stats 工具的参数
#[derive(Deserialize)]
pub struct TextStatsArgs {
    pub text: String,
}

/// list_directory 工具的参数
#[derive(Deserialize)]
pub struct ListDirArgs {
    pub path: String,
}

/// read_file 工具的参数
#[derive(Deserialize)]
pub struct ReadFileArgs {
    pub path: String,
}

/// write_file 工具的参数
#[derive(Deserialize)]
pub struct WriteFileArgs {
    pub path: String,
    pub content: String,
}

/// create_directory 工具的参数
#[derive(Deserialize)]
pub struct CreateDirArgs {
    pub path: String,
}

/// delete_path 工具的参数
#[derive(Deserialize)]
pub struct DeletePathArgs {
    pub path: String,
}

/// search_files 工具的参数
#[derive(Deserialize)]
pub struct SearchFilesArgs {
    pub directory: String,
    pub keyword: String,
}
