use std::net::SocketAddr;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::sync::{Mutex, mpsc};
use warp::ws::{Message, WebSocket};
use futures_util::{StreamExt, SinkExt};
use uuid::Uuid;

use crate::models::chat::*;
use crate::utils::filename::sanitize_filename;

/// 消息历史最大条数，超出则丢弃最旧
const MAX_MESSAGE_HISTORY: usize = 5000;
/// 昵称最大字符数
const MAX_NICKNAME_LEN: usize = 32;
/// 文本消息最大字符数
const MAX_TEXT_MESSAGE_LEN: usize = 10_000;

/// 将消息写入历史，超出上限时移除最旧记录
async fn store_message(messages: &Arc<Mutex<Vec<ChatMessage>>>, msg: ChatMessage) {
    let mut msgs = messages.lock().await;
    if msgs.len() >= MAX_MESSAGE_HISTORY {
        let drain_count = msgs.len() - MAX_MESSAGE_HISTORY + 1;
        msgs.drain(..drain_count);
    }
    msgs.push(msg);
}

/// 向相关客户端广播消息（私聊或群发）
async fn broadcast_message(clients: &Clients, msg: &ChatMessage, event_str: &str) {
    let senders: Vec<mpsc::UnboundedSender<Message>> = {
        let clients_read = clients.read().await;
        clients_read.values()
            .filter(|c| msg.to_id == "all" || c.user_id == msg.to_id || c.user_id == msg.from_id)
            .map(|c| c.sender.clone())
            .collect()
    };
    for sender in senders {
        let _ = sender.send(Message::text(event_str));
    }
}

/// 处理文件上传，保存到 chat_files 并广播消息
pub async fn handle_upload(
    body: bytes::Bytes,
    file_name: String,
    from_id: String,
    from_name: String,
    to_id: String,
    msg_type: String,
    clients: Clients,
    messages: Arc<Mutex<Vec<ChatMessage>>>,
) -> Result<impl warp::Reply, warp::Rejection> {
    let decoded_name = urlencoding::decode(&file_name)
        .map(|s| s.into_owned())
        .unwrap_or_else(|_| file_name.clone());

    let valid_types = ["text", "image", "video", "file"];
    if !valid_types.contains(&msg_type.as_str()) {
        return Ok(warp::reply::json(&serde_json::json!({"ok": false, "error": "invalid msg_type"})));
    }

    let ext = std::path::Path::new(&decoded_name)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_string();

    let stem = std::path::Path::new(&decoded_name)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("file");

    let saved_name = if ext.is_empty() {
        format!("{}_{}", Uuid::new_v4(), sanitize_filename(stem))
    } else {
        format!("{}_{}.{}", Uuid::new_v4(), sanitize_filename(stem), sanitize_filename(&ext))
    };

    let file_path = format!("./chat_files/{}", saved_name);
    if let Err(e) = tokio::fs::write(&file_path, &body).await {
        log::error!("Failed to write file {}: {}", file_path, e);
        return Ok(warp::reply::json(&serde_json::json!({"ok": false, "error": "file write failed"})));
    }

    let msg = ChatMessage {
        id: Uuid::new_v4().to_string(),
        from_id,
        from_name,
        to_id,
        content: format!("/files/{}", saved_name),
        msg_type,
        file_name: Some(decoded_name),
        file_size: Some(body.len() as u64),
        timestamp: chrono::Utc::now().timestamp_millis(),
    };

    store_message(&messages, msg.clone()).await;

    if let Ok(event_str) = serde_json::to_string(&WsEvent {
        event: "message".to_string(),
        data: serde_json::to_value(&msg).unwrap_or_default(),
    }) {
        broadcast_message(&clients, &msg, &event_str).await;
    }

    Ok(warp::reply::json(&serde_json::json!({"ok": true, "url": msg.content})))
}

/// 强制下载文件，设置 Content-Disposition 为 attachment
pub async fn handle_force_download(tail: warp::path::Tail) -> Result<impl warp::Reply, warp::Rejection> {
    let file_name = tail.as_str();
    if file_name.contains("..") || file_name.contains('/') || file_name.contains('\\') {
        return Err(warp::reject::not_found());
    }
    let file_path = format!("./chat_files/{}", file_name);
    let data = tokio::fs::read(&file_path).await.map_err(|_| warp::reject::not_found())?;

    let display_name = file_name
        .find('_')
        .map(|i| &file_name[i + 1..])
        .unwrap_or(file_name);

    let encoded_name = urlencoding::encode(display_name);

    Ok(warp::http::Response::builder()
        .header("Content-Type", "application/octet-stream")
        .header(
            "Content-Disposition",
            format!("attachment; filename=\"{}\"; filename*=UTF-8''{}", display_name, encoded_name),
        )
        .body(data)
        .unwrap())
}

/// 处理 WebSocket 连接，处理 join、message 等事件
pub async fn handle_connection(
    ws: WebSocket,
    clients: Clients,
    messages: Arc<Mutex<Vec<ChatMessage>>>,
    addr: Option<SocketAddr>,
) {
    let (mut ws_tx, mut ws_rx) = ws.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<Message>();

    let ip = addr.map(|a| a.ip().to_string()).unwrap_or_default();

    let sender_closed = Arc::new(AtomicBool::new(false));
    let sender_closed_clone = sender_closed.clone();
    tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if ws_tx.send(msg).await.is_err() {
                break;
            }
        }
        sender_closed_clone.store(true, Ordering::Relaxed);
    });

    let mut nickname = String::new();
    let mut connected_user_id = String::new();

    while let Some(Ok(msg)) = ws_rx.next().await {
        if sender_closed.load(Ordering::Relaxed) {
            break;
        }

        if let Ok(text) = msg.to_str() {
            if text.len() > MAX_TEXT_MESSAGE_LEN + 1024 {
                log::warn!("Oversized message from {}, ignoring", connected_user_id);
                continue;
            }

            let event = match serde_json::from_str::<WsEvent>(text) {
                Ok(e) => e,
                Err(_) => continue,
            };

            match event.event.as_str() {
                "join" => {
                    nickname = event.data.get("nickname")
                        .and_then(|v| v.as_str())
                        .unwrap_or("Anonymous")
                        .to_string();

                    connected_user_id = event.data.get("client_id")
                        .and_then(|v| v.as_str())
                        .filter(|s| !s.is_empty() && s.len() <= 64)
                        .map(|s| s.to_string())
                        .unwrap_or_else(|| Uuid::new_v4().to_string());

                    clients.write().await.remove(&connected_user_id);

                    if nickname.len() > MAX_NICKNAME_LEN {
                        nickname = nickname.chars().take(MAX_NICKNAME_LEN).collect();
                    }

                    let client = Client {
                        user_id: connected_user_id.clone(),
                        nickname: nickname.clone(),
                        sender: tx.clone(),
                    };
                    clients.write().await.insert(connected_user_id.clone(), client);

                    if let Ok(welcome_str) = serde_json::to_string(&WsEvent {
                        event: "welcome".to_string(),
                        data: serde_json::json!({
                            "user_id": connected_user_id,
                            "nickname": nickname,
                            "ip": ip,
                        }),
                    }) {
                        let _ = tx.send(Message::text(welcome_str));
                    }

                    broadcast_user_list(&clients).await;

                    let history = messages.lock().await.clone();
                    if let Ok(history_str) = serde_json::to_string(&WsEvent {
                        event: "history".to_string(),
                        data: serde_json::to_value(&history).unwrap_or_default(),
                    }) {
                        let _ = tx.send(Message::text(history_str));
                    }
                }
                "message" => {
                    if let Ok(mut chat_msg) = serde_json::from_value::<ChatMessage>(event.data) {
                        chat_msg.id = Uuid::new_v4().to_string();
                        chat_msg.from_id = connected_user_id.clone();
                        chat_msg.from_name = nickname.clone();
                        chat_msg.timestamp = chrono::Utc::now().timestamp_millis();

                        if chat_msg.msg_type == "text" && chat_msg.content.len() > MAX_TEXT_MESSAGE_LEN {
                            chat_msg.content = chat_msg.content.chars().take(MAX_TEXT_MESSAGE_LEN).collect();
                        }

                        store_message(&messages, chat_msg.clone()).await;

                        if let Ok(event_str) = serde_json::to_string(&WsEvent {
                            event: "message".to_string(),
                            data: serde_json::to_value(&chat_msg).unwrap_or_default(),
                        }) {
                            broadcast_message(&clients, &chat_msg, &event_str).await;
                        }
                    }
                }
                _ => {}
            }
        }
    }

    clients.write().await.remove(&connected_user_id);
    broadcast_user_list(&clients).await;
    log::info!("User {} ({}) disconnected", nickname, connected_user_id);
}

/// 向所有客户端广播当前在线用户列表
async fn broadcast_user_list(clients: &Clients) {
    let (users, senders): (Vec<UserInfo>, Vec<mpsc::UnboundedSender<Message>>) = {
        let clients_read = clients.read().await;
        let users: Vec<UserInfo> = clients_read.values().map(|c| UserInfo {
            user_id: c.user_id.clone(),
            nickname: c.nickname.clone(),
            ip: String::new(),
        }).collect();
        let senders: Vec<_> = clients_read.values().map(|c| c.sender.clone()).collect();
        (users, senders)
    };
    let event_str = match serde_json::to_string(&WsEvent {
        event: "users".to_string(),
        data: serde_json::to_value(&users).unwrap_or_default(),
    }) {
        Ok(s) => s,
        Err(_) => return,
    };

    for sender in senders {
        let _ = sender.send(Message::text(&event_str));
    }
}
