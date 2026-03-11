/// 获取前端运行时所需的配置信息。
///
/// 从编译时嵌入的 `lanchat.config.json` 中提取前端关心的配置子集，
/// 避免将完整的后端配置结构暴露给前端。
///
/// # Returns
///
/// * `FrontendConfig` - 包含聊天端口、消息上限、WebSocket 重连参数等前端所需字段。
#[tauri::command]
pub fn get_frontend_config() -> crate::config::FrontendConfig {
    crate::config::frontend_config()
}
