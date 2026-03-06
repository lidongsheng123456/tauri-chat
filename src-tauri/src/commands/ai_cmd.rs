use crate::models::ai::AiChatMessage;
use crate::services::ai::chat_service;

/// 编译时通过环境变量 DEEPSEEK_API_KEY 嵌入的 API Key
const EMBEDDED_KEY: Option<&str> = option_env!("DEEPSEEK_API_KEY");

/// 前端传入的 AI 聊天消息格式
#[derive(serde::Deserialize)]
pub struct FrontendAiMessage {
    pub role: String,
    pub content: String,
}

/// 读取 API Key：优先使用编译时嵌入的 Key，其次从 OS 凭据管理器读取
fn read_api_key() -> Result<String, String> {
    if let Some(key) = EMBEDDED_KEY {
        if !key.is_empty() {
            return Ok(key.to_string());
        }
    }
    let entry = keyring::Entry::new("lanchat", "deepseek_api_key")
        .map_err(|e| format!("凭据管理器访问失败: {}", e))?;
    entry
        .get_password()
        .map_err(|_| "未配置 API Key，请设置环境变量 DEEPSEEK_API_KEY 后重新编译".to_string())
}

/// 检查是否已配置 API Key（编译时嵌入 或 凭据管理器）
#[tauri::command]
pub fn has_api_key() -> bool {
    read_api_key().is_ok()
}

/// 调用 AI 聊天接口，API Key 从编译时嵌入或 OS 凭据管理器读取
#[tauri::command]
pub async fn chat_with_ai(messages: Vec<FrontendAiMessage>) -> Result<String, String> {
    let api_key = read_api_key()?;

    let ai_messages: Vec<AiChatMessage> = messages
        .into_iter()
        .map(|m| AiChatMessage::text(&m.role, &m.content))
        .collect();

    chat_service::chat_with_tools(&api_key, ai_messages).await
}
