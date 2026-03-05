use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::sync::{Mutex, RwLock};
use warp::ws::{Message, WebSocket};
use warp::Filter;
use futures_util::{StreamExt, SinkExt};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use tokio::sync::mpsc;

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

        // File upload endpoint
        let upload_clients = clients_filter.clone();
        let upload_route = warp::path("upload")
            .and(warp::post())
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

        // Use a custom TcpListener with SO_REUSEADDR to avoid "address already in use" errors
        let addr: std::net::SocketAddr = ([0, 0, 0, 0], port).into();
        let listener = match tokio::net::TcpListener::bind(addr).await {
            Ok(l) => l,
            Err(e) => {
                log::error!("Failed to bind to port {}: {}. Port may be in use.", port, e);
                // Retry after a short delay
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
    // Ensure chat_files directory exists
    let _ = tokio::fs::create_dir_all("./chat_files").await;

    let ext = std::path::Path::new(&file_name)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_string();

    let saved_name = if ext.is_empty() {
        format!("{}_{}", Uuid::new_v4(), sanitize_filename(&file_name))
    } else {
        format!("{}.{}", format!("{}_{}", Uuid::new_v4(), sanitize_filename(
            std::path::Path::new(&file_name).file_stem().and_then(|s| s.to_str()).unwrap_or("file")
        )), ext)
    };
    let file_path = format!("./chat_files/{}", saved_name);
    tokio::fs::write(&file_path, &body).await.map_err(|_| warp::reject::reject())?;

    let msg = ChatMessage {
        id: Uuid::new_v4().to_string(),
        from_id: from_id.clone(),
        from_name: from_name.clone(),
        to_id: to_id.clone(),
        content: format!("/files/{}", saved_name),
        msg_type,
        file_name: Some(file_name),
        file_size: Some(body.len() as u64),
        timestamp: chrono::Utc::now().timestamp_millis(),
    };

    // Store message
    messages.lock().await.push(msg.clone());

    // Broadcast to relevant clients
    let event = WsEvent {
        event: "message".to_string(),
        data: serde_json::to_value(&msg).unwrap(),
    };
    let event_str = serde_json::to_string(&event).unwrap();
    let clients_read = clients.read().await;
    for (_, client) in clients_read.iter() {
        if msg.to_id == "all" || client.user_id == msg.to_id || client.user_id == msg.from_id {
            let _ = client.sender.send(Message::text(&event_str));
        }
    }

    Ok(warp::reply::json(&serde_json::json!({"ok": true, "url": msg.content})))
}

fn sanitize_filename(name: &str) -> String {
    name.chars()
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

    // Spawn sender task
    tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if ws_tx.send(msg).await.is_err() {
                break;
            }
        }
    });

    let mut nickname = String::new();
    let connected_user_id = user_id.clone();

    while let Some(Ok(msg)) = ws_rx.next().await {
        if let Ok(text) = msg.to_str() {
            if let Ok(event) = serde_json::from_str::<WsEvent>(text) {
                match event.event.as_str() {
                    "join" => {
                        nickname = event.data.get("nickname")
                            .and_then(|v| v.as_str())
                            .unwrap_or("Anonymous")
                            .to_string();

                        let client = Client {
                            user_id: connected_user_id.clone(),
                            nickname: nickname.clone(),
                            sender: tx.clone(),
                        };
                        clients.write().await.insert(connected_user_id.clone(), client);

                        // Send user their ID
                        let welcome = WsEvent {
                            event: "welcome".to_string(),
                            data: serde_json::json!({
                                "user_id": connected_user_id,
                                "nickname": nickname,
                                "ip": ip,
                            }),
                        };
                        let _ = tx.send(Message::text(serde_json::to_string(&welcome).unwrap()));

                        // Broadcast user list
                        broadcast_user_list(&clients).await;

                        // Send chat history
                        let history = messages.lock().await.clone();
                        let history_event = WsEvent {
                            event: "history".to_string(),
                            data: serde_json::to_value(&history).unwrap(),
                        };
                        let _ = tx.send(Message::text(serde_json::to_string(&history_event).unwrap()));
                    }
                    "message" => {
                        if let Ok(mut chat_msg) = serde_json::from_value::<ChatMessage>(event.data) {
                            chat_msg.id = Uuid::new_v4().to_string();
                            chat_msg.from_id = connected_user_id.clone();
                            chat_msg.from_name = nickname.clone();
                            chat_msg.timestamp = chrono::Utc::now().timestamp_millis();

                            messages.lock().await.push(chat_msg.clone());

                            let broadcast_event = WsEvent {
                                event: "message".to_string(),
                                data: serde_json::to_value(&chat_msg).unwrap(),
                            };
                            let event_str = serde_json::to_string(&broadcast_event).unwrap();

                            let clients_read = clients.read().await;
                            for (_, client) in clients_read.iter() {
                                if chat_msg.to_id == "all" || client.user_id == chat_msg.to_id || client.user_id == chat_msg.from_id {
                                    let _ = client.sender.send(Message::text(&event_str));
                                }
                            }
                        }
                    }
                    _ => {}
                }
            }
        }
    }

    // Client disconnected
    clients.write().await.remove(&connected_user_id);
    broadcast_user_list(&clients).await;
    log::info!("User {} disconnected", connected_user_id);
}

async fn broadcast_user_list(clients: &Clients) {
    let clients_read = clients.read().await;
    let users: Vec<UserInfo> = clients_read.values().map(|c| UserInfo {
        user_id: c.user_id.clone(),
        nickname: c.nickname.clone(),
        ip: String::new(),
    }).collect();

    let event = WsEvent {
        event: "users".to_string(),
        data: serde_json::to_value(&users).unwrap(),
    };
    let event_str = serde_json::to_string(&event).unwrap();

    for (_, client) in clients_read.iter() {
        let _ = client.sender.send(Message::text(&event_str));
    }
}
