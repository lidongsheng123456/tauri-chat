use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::sync::{Mutex, RwLock};
use warp::ws::{Message, WebSocket};
use warp::Filter;
use futures_util::{StreamExt, SinkExt};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use tokio::sync::mpsc;

// ---- Configuration Constants ----
const MAX_UPLOAD_SIZE: u64 = 100 * 1024 * 1024; // 100 MB
const MAX_MESSAGE_HISTORY: usize = 5000;
const MAX_NICKNAME_LEN: usize = 32;
const MAX_TEXT_MESSAGE_LEN: usize = 10_000;

pub type Clients = Arc<RwLock<HashMap<String, Client>>>;

#[derive(Debug, Clone)]
pub struct Client {
    pub user_id: String,
    pub nickname: String,
    pub sender: mpsc::UnboundedSender<Message>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ChatMessage {
    pub id: String,
    pub from_id: String,
    pub from_name: String,
    pub to_id: String, // "all" for broadcast
    pub content: String,
    pub msg_type: String, // "text", "image", "video", "file"
    pub file_name: Option<String>,
    pub file_size: Option<u64>,
    pub timestamp: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WsEvent {
    pub event: String,
    pub data: serde_json::Value,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UserInfo {
    pub user_id: String,
    pub nickname: String,
    pub ip: String,
}

pub struct ChatServer {
    pub port: u16,
    pub clients: Clients,
    pub messages: Arc<Mutex<Vec<ChatMessage>>>,
}

impl ChatServer {
    pub fn new(port: u16) -> Self {
        Self {
            port,
            clients: Arc::new(RwLock::new(HashMap::new())),
            messages: Arc::new(Mutex::new(Vec::new())),
        }
    }

    pub async fn start(clients: Clients, messages: Arc<Mutex<Vec<ChatMessage>>>, port: u16) {
        // Ensure chat_files directory exists once at startup
        if let Err(e) = tokio::fs::create_dir_all("./chat_files").await {
            log::error!("Failed to create chat_files directory: {}", e);
        }

        let clients_filter = warp::any().map(move || clients.clone());
        let messages_filter = {
            let msgs = messages.clone();
            warp::any().map(move || msgs.clone())
        };

        let ws_route = warp::path("ws")
            .and(warp::ws())
            .and(clients_filter.clone())
            .and(messages_filter.clone())
            .and(warp::addr::remote())
            .map(|ws: warp::ws::Ws, clients: Clients, messages: Arc<Mutex<Vec<ChatMessage>>>, addr: Option<SocketAddr>| {
                ws.on_upgrade(move |socket| handle_connection(socket, clients, messages, addr))
            });

        // File upload endpoint with size limit
        let upload_clients = clients_filter.clone();
        let upload_route = warp::path("upload")
            .and(warp::post())
            .and(warp::body::content_length_limit(MAX_UPLOAD_SIZE))
            .and(warp::body::bytes())
            .and(warp::header::<String>("x-file-name"))
            .and(warp::header::<String>("x-from-id"))
            .and(warp::header::<String>("x-from-name"))
            .and(warp::header::<String>("x-to-id"))
            .and(warp::header::<String>("x-msg-type"))
            .and(upload_clients)
            .and(messages_filter.clone())
            .and_then(handle_upload);

        // File download endpoint
        let download_route = warp::path("files")
            .and(warp::fs::dir("./chat_files"));

        let cors = warp::cors()
            .allow_any_origin()
            .allow_headers(vec!["content-type", "x-file-name", "x-from-id", "x-from-name", "x-to-id", "x-msg-type"])
            .allow_methods(vec!["GET", "POST", "OPTIONS"]);

        let routes = ws_route.or(upload_route).or(download_route).with(cors);

        log::info!("Chat server starting on port {}", port);

        let addr: std::net::SocketAddr = ([0, 0, 0, 0], port).into();
        let listener = match tokio::net::TcpListener::bind(addr).await {
            Ok(l) => l,
            Err(e) => {
                log::error!("Failed to bind to port {}: {}. Port may be in use.", port, e);
                tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                match tokio::net::TcpListener::bind(addr).await {
                    Ok(l) => l,
                    Err(e2) => {
                        log::error!("Retry failed: {}. Server not started.", e2);
                        return;
                    }
                }
            }
        };
        let incoming = tokio_stream::wrappers::TcpListenerStream::new(listener);
        warp::serve(routes).run_incoming(incoming).await;
    }
}

/// Store a message with bounded history (evicts oldest when full)
async fn store_message(messages: &Arc<Mutex<Vec<ChatMessage>>>, msg: ChatMessage) {
    let mut msgs = messages.lock().await;
    if msgs.len() >= MAX_MESSAGE_HISTORY {
        let drain_count = msgs.len() - MAX_MESSAGE_HISTORY + 1;
        msgs.drain(..drain_count);
    }
    msgs.push(msg);
}

/// Broadcast a message event to relevant clients, releasing the lock quickly
async fn broadcast_message(clients: &Clients, msg: &ChatMessage, event_str: &str) {
    let senders: Vec<mpsc::UnboundedSender<Message>> = {
        let clients_read = clients.read().await;
        clients_read.values()
            .filter(|c| msg.to_id == "all" || c.user_id == msg.to_id || c.user_id == msg.from_id)
            .map(|c| c.sender.clone())
            .collect()
    };
    // Send outside the lock to minimize contention
    for sender in senders {
        let _ = sender.send(Message::text(event_str));
    }
}

async fn handle_upload(
    body: bytes::Bytes,
    file_name: String,
    from_id: String,
    from_name: String,
    to_id: String,
    msg_type: String,
    clients: Clients,
    messages: Arc<Mutex<Vec<ChatMessage>>>,
) -> Result<impl warp::Reply, warp::Rejection> {
    // Decode the URL-encoded filename
    let decoded_name = urlencoding::decode(&file_name)
        .map(|s| s.into_owned())
        .unwrap_or_else(|_| file_name.clone());

    // Validate msg_type
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

    // Store with bounded history
    store_message(&messages, msg.clone()).await;

    // Broadcast to relevant clients
    if let Ok(event_str) = serde_json::to_string(&WsEvent {
        event: "message".to_string(),
        data: serde_json::to_value(&msg).unwrap_or_default(),
    }) {
        broadcast_message(&clients, &msg, &event_str).await;
    }

    Ok(warp::reply::json(&serde_json::json!({"ok": true, "url": msg.content})))
}

fn sanitize_filename(name: &str) -> String {
    name.chars()
        .take(100) // Limit filename length
        .map(|c| if c.is_alphanumeric() || c == '.' || c == '-' || c == '_' { c } else { '_' })
        .collect()
}

async fn handle_connection(
    ws: WebSocket,
    clients: Clients,
    messages: Arc<Mutex<Vec<ChatMessage>>>,
    addr: Option<SocketAddr>,
) {
    let (mut ws_tx, mut ws_rx) = ws.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<Message>();

    let user_id = Uuid::new_v4().to_string();
    let ip = addr.map(|a| a.ip().to_string()).unwrap_or_default();

    // Spawn sender task with graceful shutdown
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
    let connected_user_id = user_id.clone();

    while let Some(Ok(msg)) = ws_rx.next().await {
        // Skip if sender task has closed
        if sender_closed.load(Ordering::Relaxed) {
            break;
        }

        if let Ok(text) = msg.to_str() {
            // Reject oversized messages early
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

                    // Sanitize nickname length
                    if nickname.len() > MAX_NICKNAME_LEN {
                        nickname = nickname.chars().take(MAX_NICKNAME_LEN).collect();
                    }

                    let client = Client {
                        user_id: connected_user_id.clone(),
                        nickname: nickname.clone(),
                        sender: tx.clone(),
                    };
                    clients.write().await.insert(connected_user_id.clone(), client);

                    // Send user their ID
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

                    // Broadcast user list
                    broadcast_user_list(&clients).await;

                    // Send chat history
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
                        // Server-side enforcement: override fields to prevent spoofing
                        chat_msg.id = Uuid::new_v4().to_string();
                        chat_msg.from_id = connected_user_id.clone();
                        chat_msg.from_name = nickname.clone();
                        chat_msg.timestamp = chrono::Utc::now().timestamp_millis();

                        // Validate text content length
                        if chat_msg.msg_type == "text" && chat_msg.content.len() > MAX_TEXT_MESSAGE_LEN {
                            chat_msg.content = chat_msg.content.chars().take(MAX_TEXT_MESSAGE_LEN).collect();
                        }

                        // Store with bounded history
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

    // Client disconnected
    clients.write().await.remove(&connected_user_id);
    broadcast_user_list(&clients).await;
    log::info!("User {} ({}) disconnected", nickname, connected_user_id);
}

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
    // Build event string outside the lock
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
