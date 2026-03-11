use serde::{Deserialize, Serialize};

/// 单次工具执行的完整轨迹，序列化后发送至前端用于展示调用详情。
#[derive(Serialize, Clone, Debug)]
pub struct ToolCallTrace {
    /// 工具调用的唯一标识符，与 AI 响应中的 `tool_call_id` 对应。
    pub tool_call_id: String,
    /// 被调用工具的名称，例如 `"web_search"`、`"read_file"`。
    pub tool_name: String,
    /// 工具调用时传入的参数，保留原始 JSON 结构以便前端渲染。
    pub arguments: serde_json::Value,
    /// 工具执行后返回的结果文本（超长时已截断）。
    pub result: String,
}

/// 一轮工具调用的完整轨迹，包含本轮的思考文本与所有工具执行记录。
///
/// 一次 AI 对话可能经历多轮工具调用，每轮对应一个 `ToolRoundTrace`。
#[derive(Serialize, Clone, Debug)]
pub struct ToolRoundTrace {
    /// 轮次编号，从 1 开始递增。
    pub round: usize,
    /// 模型在决定调用工具前生成的思考文本，为空时序列化时省略该字段。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thinking: Option<String>,
    /// 本轮中所有工具调用的执行轨迹列表。
    pub tool_calls: Vec<ToolCallTrace>,
}

/// 发送给 AI API 的单条聊天消息，支持纯文本、工具调用请求与工具执行结果三种角色。
///
/// `content` 使用 `serde_json::Value` 以兼容 AI API 中文本与结构化内容两种格式。
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AiChatMessage {
    /// 消息角色，取值为 `"user"` / `"assistant"` / `"system"` / `"tool"`。
    pub role: String,
    /// 消息内容，纯文本时为 JSON 字符串，结构化内容时为 JSON 对象。
    pub content: Option<serde_json::Value>,
    /// 工具调用列表，仅 `assistant` 角色且模型发起工具调用时存在。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<ToolCall>>,
    /// 工具调用的唯一标识符，仅 `tool` 角色的结果消息中存在。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    /// 工具名称，仅 `tool` 角色的结果消息中存在。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

impl AiChatMessage {
    /// 构造一条纯文本聊天消息。
    ///
    /// # Arguments
    ///
    /// * `role`    - 消息角色，通常为 `"user"`、`"assistant"` 或 `"system"`。
    /// * `content` - 消息的纯文本内容。
    ///
    /// # Returns
    ///
    /// * 填充好角色与文本内容的 `AiChatMessage` 实例，其余字段均为 `None`。
    pub fn text(role: &str, content: &str) -> Self {
        Self {
            role: role.to_string(),
            content: Some(serde_json::Value::String(content.to_string())),
            tool_calls: None,
            tool_call_id: None,
            name: None,
        }
    }

    /// 构造一条工具执行结果消息，用于将工具输出回传给 AI 模型。
    ///
    /// # Arguments
    ///
    /// * `tool_call_id` - 对应 AI 请求中 `tool_calls[].id` 的唯一标识符。
    /// * `name`         - 被调用工具的函数名称。
    /// * `content`      - 工具执行后返回的结果文本。
    ///
    /// # Returns
    ///
    /// * 角色为 `"tool"` 且携带结果内容的 `AiChatMessage` 实例。
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

/// AI API 响应中的单次工具调用，包含调用标识与函数名称及参数。
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ToolCall {
    /// 工具调用的唯一标识符，后续工具结果消息中须以此 ID 回传。
    pub id: String,
    /// 调用类型，AI API 规范中固定为 `"function"`。
    #[serde(rename = "type")]
    pub call_type: String,
    /// 被调用的函数名称与序列化后的参数字符串。
    pub function: ToolFunction,
}

/// 工具调用中的函数名称与 JSON 参数，由 AI 模型生成。
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ToolFunction {
    /// 工具函数的注册名称，与 `ToolDefinition` 中的 `name` 对应。
    pub name: String,
    /// 工具参数的 JSON 序列化字符串，需自行解析为具体类型。
    pub arguments: String,
}

/// 向 AI API 注册的单个工具定义，遵循 OpenAI Function Calling 规范。
#[derive(Serialize, Clone)]
pub struct ToolDefinition {
    /// 工具类型，AI API 规范中固定为 `"function"`。
    #[serde(rename = "type")]
    pub tool_type: String,
    /// 工具的函数级详细定义，包含名称、描述与参数 schema。
    pub function: ToolFunctionDef,
}

/// 工具函数的详细定义，用于告知 AI 模型工具的能力与调用方式。
#[derive(Serialize, Clone)]
pub struct ToolFunctionDef {
    /// 工具的唯一注册名称，AI 模型调用时将以此名称标识。
    pub name: String,
    /// 对工具功能的自然语言描述，供 AI 模型判断何时调用该工具。
    pub description: String,
    /// 工具参数的 JSON Schema 定义，描述参数名称、类型与是否必填。
    pub parameters: serde_json::Value,
}

// ─── 工具参数结构体 ───────────────────────────────────────────────────────────
// 以下结构体用于反序列化 AI 模型生成的工具调用参数，每个结构体对应一个工具。

/// `browse_website` 工具的调用参数。
#[derive(Deserialize)]
pub struct BrowseArgs {
    /// 需要抓取并解析的目标网页 URL。
    pub url: String,
}

/// `fetch_url_raw` 工具的调用参数。
#[derive(Deserialize)]
pub struct FetchRawArgs {
    /// 需要获取原始文本内容的目标 URL。
    pub url: String,
}

/// `web_search` 工具的调用参数。
#[derive(Deserialize)]
pub struct SearchArgs {
    /// 搜索关键词，将提交至 DuckDuckGo 进行查询。
    pub query: String,
}

/// `extract_webpage_images` 工具的调用参数。
#[derive(Deserialize)]
pub struct ExtractImagesArgs {
    /// 需要提取图片的目标网页 URL。
    pub url: String,
}

/// `get_current_datetime` 工具的调用参数。
#[derive(Deserialize)]
pub struct DatetimeArgs {
    /// 可选的时区标识，为空时使用系统本地时区。
    pub timezone: Option<String>,
}

/// `encode_decode` 工具的调用参数。
#[derive(Deserialize)]
pub struct EncodeDecodeArgs {
    /// 操作类型，取值为 `"encode"` 或 `"decode"`。
    pub action: String,
    /// 编码格式，取值为 `"base64"`、`"url"` 或 `"hex"`。
    pub encoding: String,
    /// 待处理的原始文本内容。
    pub text: String,
}

/// `get_ip_geolocation` 工具的调用参数。
#[derive(Deserialize)]
pub struct IpGeoArgs {
    /// 待查询的 IP 地址，为空时查询当前出口 IP。
    pub ip: Option<String>,
}

/// `text_stats` 工具的调用参数。
#[derive(Deserialize)]
pub struct TextStatsArgs {
    /// 需要进行统计分析的文本内容。
    pub text: String,
}

/// `list_directory` 工具的调用参数。
#[derive(Deserialize)]
pub struct ListDirArgs {
    /// 需要列出内容的目录绝对路径。
    pub path: String,
}

/// `read_file` 工具的调用参数。
#[derive(Deserialize)]
pub struct ReadFileArgs {
    /// 需要读取的文件绝对路径。
    pub path: String,
}

/// `write_file` 工具的调用参数。
#[derive(Deserialize)]
pub struct WriteFileArgs {
    /// 写入目标文件的绝对路径，不存在时自动创建。
    pub path: String,
    /// 写入文件的完整文本内容，将覆盖原有内容。
    pub content: String,
}

/// `create_directory` 工具的调用参数。
#[derive(Deserialize)]
pub struct CreateDirArgs {
    /// 需要创建的目录绝对路径，支持递归创建多级目录。
    pub path: String,
}

/// `delete_path` 工具的调用参数。
#[derive(Deserialize)]
pub struct DeletePathArgs {
    /// 需要删除的文件或目录的绝对路径，目录将递归删除。
    pub path: String,
}

/// `search_files` 工具的调用参数。
#[derive(Deserialize)]
pub struct SearchFilesArgs {
    /// 执行递归搜索的根目录绝对路径。
    pub directory: String,
    /// 文件名匹配关键词，不区分大小写。
    pub keyword: String,
}

// ─── 前端流式事件 ─────────────────────────────────────────────────────────────

/// 通过 Tauri 事件系统向前端实时推送的流式 AI 进度事件。
///
/// 使用内部标签 `"type"` 区分变体，前端通过 `message_id` 字段匹配当前会话，
/// 避免多个并发请求的事件相互干扰。对应前端监听的事件名为 `"ai-stream"`。
#[derive(Serialize, Clone, Debug)]
#[serde(tag = "type")]
pub enum AiStreamEvent {
    /// AI 模型生成了一段新的文本 token，在最终回答阶段逐字推送。
    #[serde(rename = "token")]
    Token {
        /// 当前流式会话的消息唯一标识符。
        message_id: String,
        /// 本次推送的增量文本片段。
        content: String,
    },

    /// AI 模型正在执行某个工具，前端据此显示工具执行状态指示器。
    ///
    /// 前端收到此事件后应清空之前流式输出的思考文本，切换为工具状态视图。
    #[serde(rename = "tool_status")]
    ToolStatus {
        /// 当前流式会话的消息唯一标识符。
        message_id: String,
        /// 工具执行状态的描述文本，例如 `"正在调用: web_search"`。
        status: String,
        /// 当前所在的工具调用轮次编号，从 1 开始。
        round: usize,
    },

    /// 全部轮次执行完毕，最终回答已通过 `Token` 事件实时写入，此事件仅补充工具轨迹。
    #[serde(rename = "done")]
    Done {
        /// 当前流式会话的消息唯一标识符。
        message_id: String,
        /// 本次对话中所有工具调用轮次的完整轨迹列表，无工具调用时为空数组。
        rounds: Vec<ToolRoundTrace>,
    },

    /// 流式处理过程中发生了不可恢复的错误。
    #[serde(rename = "error")]
    Error {
        /// 当前流式会话的消息唯一标识符。
        message_id: String,
        /// 错误的详细描述信息。
        message: String,
    },
}
