use futures_util::{SinkExt, StreamExt};
use std::net::SocketAddr;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::sync::{Mutex, mpsc};
use uuid::Uuid;
use warp::ws::{Message, WebSocket};

use crate::config;
use crate::models::chat::*;

/// 将消息写入历史，超出上限时移除最旧记录
async fn store_message(messages: &Arc<Mutex<Vec<ChatMessage>>>, msg: ChatMessage) {
    let max_history = config::get().chat.max_message_history;
    let mut msgs = messages.lock().await;
    if msgs.len() >= max_history {
        let drain_count = msgs.len() - max_history + 1;
        msgs.drain(..drain_count);
    }
    msgs.push(msg);
}

/// 向相关客户端广播消息（私聊或群发）
pub(crate) async fn broadcast_message(clients: &Clients, msg: &ChatMessage, event_str: &str) {
    let senders: Vec<mpsc::UnboundedSender<Message>> = {
        let clients_read = clients.read().await;
        clients_read
            .values()
            .filter(|c| msg.to_id == "all" || c.user_id == msg.to_id || c.user_id == msg.from_id)
            .map(|c| c.sender.clone())
            .collect()
    };
    for sender in senders {
        let _ = sender.send(Message::text(event_str));
    }
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
            if ws_tx.send(msg).await.is_err() { break; }
        }
        sender_closed_clone.store(true, Ordering::Relaxed);
    });

    let mut nickname = String::new();
    let mut connected_user_id = String::new();

    while let Some(Ok(msg)) = ws_rx.next().await {
        if sender_closed.load(Ordering::Relaxed) { break; }

        if let Ok(text) = msg.to_str() {
            let max_text_len = config::get().chat.max_text_message_length;
            if text.len() > max_text_len + 1024 {
                log::warn!("Oversized message from {}, ignoring", connected_user_id);
                continue;
            }

            let event = match serde_json::from_str::<WsEvent>(text) {
                Ok(e) => e,
                Err(_) => continue,
            };

            match event.event.as_str() {
                "join" => handle_join(
                    &event, &clients, &messages, &tx, &ip,
                    &mut nickname, &mut connected_user_id,
                ).await,
                "message" => handle_chat_message(
                    &event, &clients, &messages,
                    &connected_user_id, &nickname, max_text_len,
                ).await,
                _ => {}
            }
        }
    }

    clients.write().await.remove(&connected_user_id);
    broadcast_user_list(&clients).await;
    log::info!("User {} ({}) disconnected", nickname, connected_user_id);
}

/// 处理 join 事件：注册客户端、发送 welcome 和历史消息
async fn handle_join(
    event: &WsEvent,
    clients: &Clients,
    messages: &Arc<Mutex<Vec<ChatMessage>>>,
    tx: &mpsc::UnboundedSender<Message>,
    ip: &str,
    nickname: &mut String,
    connected_user_id: &mut String,
) {
    *nickname = event.data.get("nickname")
        .and_then(|v| v.as_str())
        .unwrap_or("Anonymous")
        .to_string();

    *connected_user_id = event.data.get("client_id")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty() && s.len() <= 64)
        .map(|s| s.to_string())
        .unwrap_or_else(|| Uuid::new_v4().to_string());

    clients.write().await.remove(connected_user_id.as_str());

    let max_nick = config::get().chat.max_nickname_length;
    if nickname.len() > max_nick {
        *nickname = nickname.chars().take(max_nick).collect();
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

    broadcast_user_list(clients).await;

    let history = messages.lock().await.clone();
    if let Ok(history_str) = serde_json::to_string(&WsEvent {
        event: "history".to_string(),
        data: serde_json::to_value(&history).unwrap_or_default(),
    }) {
        let _ = tx.send(Message::text(history_str));
    }
}

/// 处理 message 事件：校验、存储、广播聊天消息
async fn handle_chat_message(
    event: &WsEvent,
    clients: &Clients,
    messages: &Arc<Mutex<Vec<ChatMessage>>>,
    user_id: &str,
    nickname: &str,
    max_text_len: usize,
) {
    if let Ok(mut chat_msg) = serde_json::from_value::<ChatMessage>(event.data.clone()) {
        chat_msg.id = Uuid::new_v4().to_string();
        chat_msg.from_id = user_id.to_string();
        chat_msg.from_name = nickname.to_string();
        chat_msg.timestamp = chrono::Utc::now().timestamp_millis();

        if chat_msg.msg_type == "text" && chat_msg.content.len() > max_text_len {
            chat_msg.content = chat_msg.content.chars().take(max_text_len).collect();
        }

        store_message(messages, chat_msg.clone()).await;

        if let Ok(event_str) = serde_json::to_string(&WsEvent {
            event: "message".to_string(),
            data: serde_json::to_value(&chat_msg).unwrap_or_default(),
        }) {
            broadcast_message(clients, &chat_msg, &event_str).await;
        }
    }
}

/// 向所有客户端广播当前在线用户列表
async fn broadcast_user_list(clients: &Clients) {
    let (users, senders): (Vec<UserInfo>, Vec<mpsc::UnboundedSender<Message>>) = {
        let clients_read = clients.read().await;
        let users: Vec<UserInfo> = clients_read.values()
            .map(|c| UserInfo { user_id: c.user_id.clone(), nickname: c.nickname.clone(), ip: String::new() })
            .collect();
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
