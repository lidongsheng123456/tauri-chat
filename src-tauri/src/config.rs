use serde::Deserialize;
use std::sync::OnceLock;

/// 编译时嵌入根目录的配置文件
const CONFIG_JSON: &str = include_str!("../../lanchat.config.json");

/// 全局配置单例
static CONFIG: OnceLock<AppConfig> = OnceLock::new();

/// 应用全局配置
#[derive(Deserialize, Clone, Debug)]
pub struct AppConfig {
    pub server: ServerConfig,
    pub ai: AiConfig,
    pub scraper: ScraperConfig,
    pub chat: ChatConfig,
    pub websocket: WebSocketConfig,
}

/// 服务端口配置
#[derive(Deserialize, Clone, Debug)]
pub struct ServerConfig {
    pub chat_port: u16,
    pub mcp_port: u16,
}

/// AI 接口配置
#[derive(Deserialize, Clone, Debug)]
pub struct AiConfig {
    pub api_url: String,
    pub model: String,
    pub max_tokens: u32,
    pub max_tool_rounds: usize,
}

/// 网页抓取配置
#[derive(Deserialize, Clone, Debug)]
pub struct ScraperConfig {
    pub max_content_length: usize,
    pub request_timeout_secs: u64,
    pub user_agent: String,
}

/// 聊天参数配置
#[derive(Deserialize, Clone, Debug)]
pub struct ChatConfig {
    pub max_message_history: usize,
    pub max_nickname_length: usize,
    pub max_text_message_length: usize,
    pub max_context_messages: usize,
    pub max_stored_messages: usize,
}

/// WebSocket 重连配置
#[derive(Deserialize, Clone, Debug)]
pub struct WebSocketConfig {
    pub max_reconnect_delay_ms: u32,
    pub base_reconnect_delay_ms: u32,
}

/// 获取全局配置引用（首次调用时解析 JSON）
pub fn get() -> &'static AppConfig {
    CONFIG.get_or_init(|| serde_json::from_str(CONFIG_JSON).expect("lanchat.config.json 解析失败"))
}

/// 返回前端所需的配置子集（JSON 序列化）
#[derive(serde::Serialize)]
pub struct FrontendConfig {
    pub chat_port: u16,
    pub max_context_messages: usize,
    pub max_stored_messages: usize,
    pub max_reconnect_delay_ms: u32,
    pub base_reconnect_delay_ms: u32,
}

/// 构建前端配置
pub fn frontend_config() -> FrontendConfig {
    let c = get();
    FrontendConfig {
        chat_port: c.server.chat_port,
        max_context_messages: c.chat.max_context_messages,
        max_stored_messages: c.chat.max_stored_messages,
        max_reconnect_delay_ms: c.websocket.max_reconnect_delay_ms,
        base_reconnect_delay_ms: c.websocket.base_reconnect_delay_ms,
    }
}
