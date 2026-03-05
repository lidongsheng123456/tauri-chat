mod server;

use server::ChatServer;
use serde::Serialize;

#[derive(Serialize)]
struct NetworkInterface {
    name: String,
    ip: String,
}

#[tauri::command]
fn get_all_ips() -> Vec<NetworkInterface> {
    let mut interfaces = Vec::new();
    if let Ok(list) = local_ip_address::list_afinet_netifas() {
        for (name, ip) in list {
            if ip.is_ipv4() && !ip.is_loopback() {
                interfaces.push(NetworkInterface {
                    name,
                    ip: ip.to_string(),
                });
            }
        }
    }
    if interfaces.is_empty() {
        interfaces.push(NetworkInterface {
            name: "localhost".to_string(),
            ip: "127.0.0.1".to_string(),
        });
    }
    interfaces
}

#[tauri::command]
fn get_hostname() -> String {
    hostname::get()
        .map(|h| h.to_string_lossy().to_string())
        .unwrap_or_else(|_| "Unknown".to_string())
}

#[tauri::command]
fn get_server_port() -> u16 {
    9120
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let server = ChatServer::new(9120);
    let clients = server.clients.clone();
    let messages = server.messages.clone();
    let port = server.port;

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

            // Start the WebSocket + HTTP server in background
            let clients_clone = clients.clone();
            let messages_clone = messages.clone();
            tauri::async_runtime::spawn(async move {
                ChatServer::start(clients_clone, messages_clone, port).await;
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_all_ips,
            get_hostname,
            get_server_port,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
