/// 返回前端所需的配置信息
#[tauri::command]
pub fn get_frontend_config() -> crate::config::FrontendConfig {
    crate::config::frontend_config()
}
