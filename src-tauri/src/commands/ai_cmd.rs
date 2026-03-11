use crate::models::ai::{AiChatMessage, AiStreamEvent};
use crate::services::ai::chat_service;
use tauri::Emitter;

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

/// 流式 AI 聊天接口。
///
/// 立即校验 API Key 并在后台 spawn 异步任务，命令本身立即返回 Ok(())。
/// 流式进度通过 Tauri 事件 `"ai-stream"` 推送给前端，事件载荷为 `AiStreamEvent`：
///   - `token`       — 新增文本 token（逐字推送）
///   - `tool_status` — 正在执行某工具
///   - `done`        — 全部完成，携带工具轮次轨迹
///   - `error`       — 发生错误
///
/// 前端通过 `message_id` 字段区分不同会话，避免并发时事件串扰。
#[tauri::command]
pub async fn chat_with_ai_stream(
    app: tauri::AppHandle,
    message_id: String,
    messages: Vec<FrontendAiMessage>,
) -> Result<(), String> {
    // 在命令层立即校验 API Key，失败直接返回错误（前端 invoke 会 catch）
    let api_key = read_api_key()?;

    let ai_messages: Vec<AiChatMessage> = messages
        .into_iter()
        .map(|m| AiChatMessage::text(&m.role, &m.content))
        .collect();

    // spawn 后台任务，命令立即返回，流式事件通过 app.emit 异步推送
    tauri::async_runtime::spawn(async move {
        if let Err(e) =
            chat_service::chat_with_tools_stream(&api_key, ai_messages, app.clone(), &message_id)
                .await
        {
            // 若 chat_with_tools_stream 内部已 emit error 则此处重复发送无害
            let _ = app.emit(
                "ai-stream",
                AiStreamEvent::Error {
                    message_id: message_id.clone(),
                    message: e,
                },
            );
        }
    });

    Ok(())
}
