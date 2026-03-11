use futures_util::{SinkExt, StreamExt};
use std::net::SocketAddr;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::sync::{Mutex, mpsc};
use uuid::Uuid;
use warp::ws::{Message, WebSocket};

use crate::config;
use crate::models::chat::*;

/// 将一条消息追加到内存历史列表，超出上限时移除最旧的记录。
///
/// 采用批量 `drain` 策略：计算需要删除的条数后一次性删除，
/// 比逐条 `remove(0)` 的性能更好（O(n) vs O(n²)）。
///
/// # Arguments
///
/// * `messages` - 服务端共享的消息历史列表。
/// * `msg`      - 需要追加的聊天消息。
pub(crate) async fn store_message(messages: &Arc<Mutex<Vec<ChatMessage>>>, msg: ChatMessage) {
    let max_history = config::get().chat.max_message_history;
    let mut msgs = messages.lock().await;
    if msgs.len() >= max_history {
        let drain_count = msgs.len() - max_history + 1;
        msgs.drain(..drain_count);
    }
    msgs.push(msg);
}

/// 将消息广播给所有相关客户端（私聊或群发）。
///
/// 通过读锁一次性收集所有目标客户端的发送通道，
/// 释放读锁后再逐一发送，避免在持锁期间执行耗时的 IO 操作。
///
/// 目标客户端筛选规则：
/// - `to_id == "all"` — 发送给所有在线客户端（群聊）。
/// - 其他值           — 仅发送给 `to_id` 与 `from_id` 匹配的客户端（私聊双方均收到）。
///
/// # Arguments
///
/// * `clients`   - 当前所有在线客户端的共享映射表。
/// * `msg`       - 需要广播的聊天消息，用于筛选目标客户端。
/// * `event_str` - 已序列化好的 JSON 事件字符串，将原样发送给各目标客户端。
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

/// 处理单个 WebSocket 连接的完整生命周期：连接建立、事件分发、断线清理。
///
/// 每个新连接在独立的异步任务中运行此函数。内部维护一对 MPSC 通道用于解耦
/// 接收循环与发送循环：发送循环在单独的 `tokio::spawn` 任务中运行，
/// 通过 `AtomicBool` 感知发送端已关闭的状态。
///
/// 支持的 WebSocket 事件：
/// - `"join"`    — 注册客户端身份，发送 `welcome`、在线列表与历史消息。
/// - `"message"` — 转发聊天消息，写入历史并广播给目标客户端。
///
/// # Arguments
///
/// * `ws`       - 已升级的 WebSocket 连接对象。
/// * `clients`  - 当前所有在线客户端的共享映射表。
/// * `messages` - 服务端内存中的消息历史共享列表。
/// * `addr`     - 客户端的远程套接字地址，用于记录 IP 信息。
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
                "join" => {
                    handle_join(
                        &event,
                        &clients,
                        &messages,
                        &tx,
                        &ip,
                        &mut nickname,
                        &mut connected_user_id,
                    )
                    .await
                }
                "message" => {
                    handle_chat_message(
                        &event,
                        &clients,
                        &messages,
                        &connected_user_id,
                        &nickname,
                        max_text_len,
                    )
                    .await
                }
                _ => {}
            }
        }
    }

    clients.write().await.remove(&connected_user_id);
    broadcast_user_list(&clients).await;
    log::info!("User {} ({}) disconnected", nickname, connected_user_id);
}

/// 处理客户端的 `join` 事件：注册身份、发送欢迎消息与历史记录。
///
/// 执行流程：
/// 1. 从事件数据中解析昵称（超长时截断至配置上限）与 `client_id`。
/// 2. 若 `client_id` 对应的旧连接已存在，先将其从客户端表中移除（顶号重连）。
/// 3. 将新 [`Client`] 写入客户端表。
/// 4. 向该客户端发送 `welcome` 事件（含分配的 `user_id`）。
/// 5. 向所有客户端广播最新在线用户列表。
/// 6. 向该客户端发送历史消息列表。
///
/// # Arguments
///
/// * `event`             - 已解析的 `join` WebSocket 事件。
/// * `clients`           - 当前所有在线客户端的共享映射表。
/// * `messages`          - 服务端内存中的消息历史共享列表。
/// * `tx`                - 当前连接的 MPSC 发送端，用于向本客户端推送消息。
/// * `ip`                - 客户端的 IPv4 地址字符串。
/// * `nickname`          - 可变引用，用于写入解析后的昵称，供断线日志使用。
/// * `connected_user_id` - 可变引用，用于写入当前连接的 `user_id`，供后续事件处理使用。
async fn handle_join(
    event: &WsEvent,
    clients: &Clients,
    messages: &Arc<Mutex<Vec<ChatMessage>>>,
    tx: &mpsc::UnboundedSender<Message>,
    ip: &str,
    nickname: &mut String,
    connected_user_id: &mut String,
) {
    *nickname = event
        .data
        .get("nickname")
        .and_then(|v| v.as_str())
        .unwrap_or("Anonymous")
        .to_string();

    *connected_user_id = event
        .data
        .get("client_id")
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
    clients
        .write()
        .await
        .insert(connected_user_id.clone(), client);

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

/// 处理客户端的 `message` 事件：校验、存储并广播聊天消息。
///
/// 服务端会覆盖客户端提交的 `id`、`from_id`、`from_name`、`timestamp` 字段，
/// 防止客户端伪造发送方身份或时间戳。
/// 文本消息超过 `max_text_len` 时，内容会被截断至上限长度。
///
/// # Arguments
///
/// * `event`       - 已解析的 `message` WebSocket 事件。
/// * `clients`     - 当前所有在线客户端的共享映射表。
/// * `messages`    - 服务端内存中的消息历史共享列表。
/// * `user_id`     - 当前连接的发送方用户 ID（来自 `join` 事件时写入的值）。
/// * `nickname`    - 当前连接的发送方昵称。
/// * `max_text_len` - 文本消息的最大字符数限制，来源于配置项 `chat.max_text_message_length`。
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

/// 向所有在线客户端广播当前在线用户列表。
///
/// 通过读锁一次性收集用户信息与发送通道后立即释放锁，
/// 随后在锁外完成序列化与发送，避免持锁期间的 IO 阻塞。
/// 广播的 `UserInfo` 不含 IP 地址（隐私保护）。
///
/// # Arguments
///
/// * `clients` - 当前所有在线客户端的共享映射表。
async fn broadcast_user_list(clients: &Clients) {
    let (users, senders): (Vec<UserInfo>, Vec<mpsc::UnboundedSender<Message>>) = {
        let clients_read = clients.read().await;
        let users: Vec<UserInfo> = clients_read
            .values()
            .map(|c| UserInfo {
                user_id: c.user_id.clone(),
                nickname: c.nickname.clone(),
                ip: String::new(),
            })
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
