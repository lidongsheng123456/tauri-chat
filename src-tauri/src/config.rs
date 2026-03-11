use serde::Deserialize;
use std::sync::OnceLock;

/// 编译时从项目根目录嵌入的配置文件内容。
const CONFIG_JSON: &str = include_str!("../../lanchat.config.json");

/// 全局配置单例，首次调用 [`get`] 时完成初始化。
static CONFIG: OnceLock<AppConfig> = OnceLock::new();

/// 应用全局配置，对应 `lanchat.config.json` 的顶层结构。
#[derive(Deserialize, Clone, Debug)]
pub struct AppConfig {
    /// 服务端口相关配置。
    pub server: ServerConfig,
    /// AI 接口相关配置。
    pub ai: AiConfig,
    /// 网页抓取相关配置。
    pub scraper: ScraperConfig,
    /// 聊天行为相关配置。
    pub chat: ChatConfig,
    /// WebSocket 重连相关配置。
    pub websocket: WebSocketConfig,
}

/// 服务监听端口配置。
#[derive(Deserialize, Clone, Debug)]
pub struct ServerConfig {
    /// 聊天 HTTP/WebSocket 服务的监听端口。
    pub chat_port: u16,
    /// MCP（Model Context Protocol）服务的监听端口。
    pub mcp_port: u16,
}

/// AI 接口调用配置。
#[derive(Deserialize, Clone, Debug)]
pub struct AiConfig {
    /// AI API 的请求端点 URL，例如 DeepSeek 的 Chat Completions 地址。
    pub api_url: String,
    /// 使用的模型标识符，例如 `"deepseek-chat"`。
    pub model: String,
    /// 单次请求允许生成的最大 token 数量。
    pub max_tokens: u32,
    /// 单次对话中允许进行工具调用的最大轮次数，超出后强制生成文本回答。
    pub max_tool_rounds: usize,
}

/// 网页内容抓取配置。
#[derive(Deserialize, Clone, Debug)]
pub struct ScraperConfig {
    /// 单次抓取允许返回的最大字符数，超出部分将被截断。
    pub max_content_length: usize,
    /// HTTP 请求超时时间（秒）。
    pub request_timeout_secs: u64,
    /// 发起 HTTP 请求时使用的 User-Agent 字符串。
    pub user_agent: String,
}

/// 聊天功能行为参数配置。
#[derive(Deserialize, Clone, Debug)]
pub struct ChatConfig {
    /// 服务端内存中保留的最大历史消息条数。
    pub max_message_history: usize,
    /// 用户昵称允许的最大字符长度。
    pub max_nickname_length: usize,
    /// 单条文本消息允许的最大字符长度。
    pub max_text_message_length: usize,
    /// 发送给 AI 的上下文中最多携带的历史消息条数。
    pub max_context_messages: usize,
    /// 本地持久化存储的最大消息条数，超出时删除最旧的记录。
    pub max_stored_messages: usize,
}

/// WebSocket 断线重连策略配置。
#[derive(Deserialize, Clone, Debug)]
pub struct WebSocketConfig {
    /// 重连等待时间的最大上限（毫秒），采用指数退避策略时不会超过此值。
    pub max_reconnect_delay_ms: u32,
    /// 重连等待时间的初始基准值（毫秒）。
    pub base_reconnect_delay_ms: u32,
}

/// 获取全局应用配置的静态引用。
///
/// 首次调用时将 `lanchat.config.json` 解析为 [`AppConfig`] 并缓存；
/// 后续调用直接返回缓存的引用，无额外开销。
///
/// # Returns
///
/// * `&'static AppConfig` - 全局配置的静态引用，生命周期与进程相同。
///
/// # Errors
///
/// * 若 `lanchat.config.json` 内容不符合 [`AppConfig`] 的结构，进程将 panic，
///   因为配置文件格式错误属于不可恢复的初始化问题。
pub fn get() -> &'static AppConfig {
    CONFIG.get_or_init(|| serde_json::from_str(CONFIG_JSON).expect("lanchat.config.json 解析失败"))
}

/// 暴露给前端的配置子集，仅包含前端运行时实际需要的字段。
///
/// 通过 Tauri Command `get_frontend_config` 序列化后发送至前端，
/// 避免将完整的后端配置结构（含敏感字段）暴露给渲染进程。
#[derive(serde::Serialize)]
pub struct FrontendConfig {
    /// 聊天服务的监听端口，前端用于构造 WebSocket 连接地址。
    pub chat_port: u16,
    /// 发送给 AI 的上下文中最多携带的历史消息条数。
    pub max_context_messages: usize,
    /// 本地持久化存储的最大消息条数。
    pub max_stored_messages: usize,
    /// WebSocket 重连等待时间的最大上限（毫秒）。
    pub max_reconnect_delay_ms: u32,
    /// WebSocket 重连等待时间的初始基准值（毫秒）。
    pub base_reconnect_delay_ms: u32,
}

/// 从全局配置中提取并构建前端所需的配置子集。
///
/// # Returns
///
/// * [`FrontendConfig`] - 包含前端运行时所需字段的配置结构体实例。
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
