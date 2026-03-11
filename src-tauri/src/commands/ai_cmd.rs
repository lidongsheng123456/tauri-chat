use crate::models::ai::{AiChatMessage, AiStreamEvent};
use crate::services::ai::chat_service;
use tauri::Emitter;

/// 编译时通过环境变量 `DEEPSEEK_API_KEY` 嵌入的 API Key。
///
/// 未设置该环境变量时值为 `None`，程序将转而从 OS 凭据管理器读取。
const EMBEDDED_KEY: Option<&str> = option_env!("DEEPSEEK_API_KEY");

/// 前端通过 `chat_with_ai_stream` 命令传入的单条聊天消息。
///
/// 与 Rust 内部的 `AiChatMessage` 结构解耦，前端只需传递角色与文本内容。
#[derive(serde::Deserialize)]
pub struct FrontendAiMessage {
    /// 消息角色，取值为 `"user"`、`"assistant"` 或 `"system"`。
    pub role: String,
    /// 消息的纯文本内容。
    pub content: String,
}

/// 读取 API Key，优先使用编译时嵌入的密钥，其次从 OS 凭据管理器中获取。
///
/// # Returns
///
/// * `Ok(String)` - 成功读取到的 API Key 字符串。
///
/// # Errors
///
/// * 若编译时未嵌入密钥，且 OS 凭据管理器中也未配置，返回提示用户重新编译的错误信息。
/// * 若无法访问 OS 凭据管理器（权限不足或平台不支持），返回访问失败的错误信息。
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

/// 检查当前应用是否已配置有效的 AI API Key。
///
/// 依次尝试编译时嵌入的密钥与 OS 凭据管理器，任意一种方式可读取到非空密钥即返回 `true`。
///
/// # Returns
///
/// * `true`  - 已配置 API Key，AI 功能可正常使用。
/// * `false` - 未配置任何 API Key，前端应提示用户进行配置。
#[tauri::command]
pub fn has_api_key() -> bool {
    read_api_key().is_ok()
}

/// 启动流式 AI 聊天会话。
///
/// 在命令层校验 API Key 后立即返回，实际的 AI 推理与工具调用在后台异步任务中执行。
/// 流式进度通过 Tauri 事件 `"ai-stream"` 实时推送至前端，事件载荷类型为 `AiStreamEvent`：
///
/// * `token`       — AI 生成的文本增量片段（最终回答阶段逐字推送）
/// * `tool_status` — 当前正在执行的工具名称与轮次
/// * `done`        — 全部完成，携带所有工具调用轮次的完整轨迹
/// * `error`       — 流式处理过程中发生了不可恢复的错误
///
/// 前端通过 `message_id` 字段匹配当前会话的事件，避免并发请求时事件串扰。
///
/// # Arguments
///
/// * `app`        - Tauri 应用句柄，用于向前端窗口发射事件。
/// * `message_id` - 本次会话的唯一标识符，由前端生成并传入。
/// * `messages`   - 包含系统提示与对话历史的上下文消息列表。
///
/// # Returns
///
/// * `Ok(())` - API Key 校验通过，后台流式任务已成功启动。
///
/// # Errors
///
/// * 若 API Key 未配置或无法读取，命令层直接返回错误字符串，前端 `invoke` 将进入 catch 分支。
#[tauri::command]
pub async fn chat_with_ai_stream(
    app: tauri::AppHandle,
    message_id: String,
    messages: Vec<FrontendAiMessage>,
) -> Result<(), String> {
    let api_key = read_api_key()?;

    let ai_messages: Vec<AiChatMessage> = messages
        .into_iter()
        .map(|m| AiChatMessage::text(&m.role, &m.content))
        .collect();

    tauri::async_runtime::spawn(async move {
        if let Err(e) =
            chat_service::chat_with_tools_stream(&api_key, ai_messages, app.clone(), &message_id)
                .await
        {
            // chat_with_tools_stream 内部已发射 error 事件，此处兜底补发以防内部提前返回时漏发
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
