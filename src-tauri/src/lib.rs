mod server;

use server::ChatServer;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

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

#[tauri::command]
async fn download_chat_file(file_path: String, file_name: String, server_url: String) -> Result<String, String> {
    // file_path is like "/files/uuid_filename.ext"
    let stored_name = file_path
        .strip_prefix("/files/")
        .unwrap_or(&file_path);

    // Prevent path traversal
    if stored_name.contains("..") || stored_name.contains('\\') {
        return Err("Invalid file path".to_string());
    }

    // Get user's Downloads directory
    let downloads_dir = dirs::download_dir()
        .unwrap_or_else(|| dirs::home_dir().unwrap_or_else(|| PathBuf::from(".")));

    let mut dest = downloads_dir.join(&file_name);

    // If file already exists, append a number
    if dest.exists() {
        let stem = std::path::Path::new(&file_name)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("file")
            .to_string();
        let ext = std::path::Path::new(&file_name)
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| format!(".{}", e))
            .unwrap_or_default();
        let mut counter = 1;
        loop {
            dest = downloads_dir.join(format!("{}({}){}", stem, counter, ext));
            if !dest.exists() { break; }
            counter += 1;
        }
    }

    // Try local file first (server machine)
    let local_src = PathBuf::from("./chat_files").join(stored_name);
    if local_src.exists() {
        tokio::fs::copy(&local_src, &dest)
            .await
            .map_err(|e| format!("Failed to save file: {}", e))?;
        return Ok(dest.to_string_lossy().to_string());
    }

    // Fallback: download from server via HTTP (remote machine)
    // Use no_proxy() to avoid system proxy intercepting LAN requests (causes 502 on Windows)
    let client = reqwest::Client::builder()
        .no_proxy()
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;
    let url = format!("http://{}/files/{}", server_url, stored_name);
    let response = client.get(&url)
        .send()
        .await
        .map_err(|e| format!("Download request failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Server returned HTTP {}", response.status()));
    }

    let data = response.bytes()
        .await
        .map_err(|e| format!("Failed to read response: {}", e))?;

    tokio::fs::write(&dest, &data)
        .await
        .map_err(|e| format!("Failed to write file: {}", e))?;

    Ok(dest.to_string_lossy().to_string())
}

// ---- AI Chat ----

#[derive(Deserialize)]
struct AiChoice {
    message: AiMessage,
}

#[derive(Deserialize)]
struct AiMessage {
    content: String,
}

#[derive(Deserialize)]
struct AiResponse {
    choices: Vec<AiChoice>,
}

#[derive(Serialize)]
struct AiChatRequest {
    model: String,
    messages: Vec<AiChatMessage>,
    max_tokens: u32,
}

#[derive(Serialize, Deserialize, Clone)]
struct AiChatMessage {
    role: String,
    content: String,
}

#[tauri::command]
async fn chat_with_ai(api_key: String, messages: Vec<AiChatMessage>) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .no_proxy()
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;
    let body = AiChatRequest {
        model: "LongCat-Flash-Chat".to_string(),
        messages,
        max_tokens: 4000,
    };

    let response = client
        .post("https://api.longcat.chat/openai/v1/chat/completions")
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("API error ({}): {}", status, text));
    }

    let ai_resp: AiResponse = response.json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    ai_resp.choices.first()
        .map(|c| c.message.content.clone())
        .ok_or_else(|| "No response from AI".to_string())
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
            download_chat_file,
            chat_with_ai,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
