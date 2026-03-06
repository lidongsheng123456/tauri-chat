mod models;
mod commands;
mod services;
mod server;
mod utils;

use server::state::ChatServer;
use services::mcp_server;

/// 聊天服务监听端口
const CHAT_PORT: u16 = 9120;
/// MCP 服务监听端口
const MCP_PORT: u16 = 9121;

/// 启动 Tauri 应用，初始化聊天服务和 MCP 服务
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
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
                server::routes::start_server(clients_clone, messages_clone, CHAT_PORT).await;
            });

            tauri::async_runtime::spawn(async move {
                mcp_server::start_mcp_server(MCP_PORT).await;
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::network_cmd::get_all_ips,
            commands::network_cmd::get_hostname,
            commands::network_cmd::get_server_port,
            commands::file_cmd::download_chat_file,
            commands::ai_cmd::chat_with_ai,
            commands::ai_cmd::has_api_key,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
