use crate::models::ai::AiChatMessage;
use crate::services::ai_service;

/// 前端传入的 AI 聊天消息格式
#[derive(serde::Deserialize)]
pub struct FrontendAiMessage {
    pub role: String,
    pub content: String,
}

/// 调用 AI 聊天接口，支持工具调用（网页抓取等）
#[tauri::command]
pub async fn chat_with_ai(api_key: String, messages: Vec<FrontendAiMessage>) -> Result<String, String> {
    let ai_messages: Vec<AiChatMessage> = messages
        .into_iter()
        .map(|m| AiChatMessage::text(&m.role, &m.content))
        .collect();

    ai_service::chat_with_tools(&api_key, ai_messages).await
}
