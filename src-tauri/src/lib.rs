mod commands;
pub mod config;
mod models;
mod server;
mod services;
mod utils;

use server::state::ChatServer;
use services::mcp_server;

/// 初始化并启动 Tauri 应用，同时在后台异步启动聊天服务与 MCP 服务。
///
/// 执行顺序如下：
/// 1. 读取全局配置（`lanchat.config.json`）获取各服务端口号。
/// 2. 创建 [`ChatServer`] 实例，持有客户端列表与消息历史的共享状态。
/// 3. 构建 Tauri 应用，注册所有 Tauri Command 与插件。
/// 4. 在 `setup` 回调中通过 `tauri::async_runtime::spawn` 并发启动：
///    - 聊天 HTTP/WebSocket 服务（端口由 `chat_port` 决定）
///    - MCP JSON-RPC 服务（端口由 `mcp_port` 决定）
/// 5. 进入 Tauri 主事件循环，直至用户关闭应用窗口。
///
/// # Returns
///
/// 此函数正常情况下不会返回（阻塞于 Tauri 事件循环）。
///
/// # Errors
///
/// * 若 Tauri 运行时初始化失败（如无法创建窗口或注册插件），将以 `expect` 触发 panic。
///   该错误属于不可恢复的启动错误，程序无法继续运行。
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let cfg = config::get();
    let chat_port = cfg.server.chat_port;
    let mcp_port = cfg.server.mcp_port;

    let chat_server = ChatServer::new();
    let clients = chat_server.clients.clone();
    let messages = chat_server.messages.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(move |app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            let clients_clone = clients.clone();
            let messages_clone = messages.clone();
            tauri::async_runtime::spawn(async move {
                server::routes::start_server(clients_clone, messages_clone, chat_port).await;
            });

            tauri::async_runtime::spawn(async move {
                mcp_server::start_mcp_server(mcp_port).await;
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::network_cmd::get_all_ips,
            commands::network_cmd::get_hostname,
            commands::file_cmd::download_chat_file,
            commands::ai_cmd::chat_with_ai_stream,
            commands::ai_cmd::has_api_key,
            commands::config_cmd::get_frontend_config,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
