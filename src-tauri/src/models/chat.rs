use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{Mutex, RwLock, mpsc};
use warp::ws::Message;

/// 在线客户端映射：user_id -> Client
pub type Clients = Arc<RwLock<HashMap<String, Client>>>;
/// 聊天消息历史
pub type Messages = Arc<Mutex<Vec<ChatMessage>>>;

/// WebSocket 连接的客户端，包含用户 ID、昵称和发送通道
#[derive(Debug, Clone)]
pub struct Client {
    pub user_id: String,
    pub nickname: String,
    pub sender: mpsc::UnboundedSender<Message>,
}

/// 单条聊天消息
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ChatMessage {
    pub id: String,
    pub from_id: String,
    pub from_name: String,
    pub to_id: String,
    pub content: String,
    pub msg_type: String,
    pub file_name: Option<String>,
    pub file_size: Option<u64>,
    pub timestamp: i64,
}

/// WebSocket 事件，包含事件类型和 JSON 数据
#[derive(Debug, Serialize, Deserialize)]
pub struct WsEvent {
    pub event: String,
    pub data: serde_json::Value,
}

/// 用户简要信息，用于在线列表展示
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UserInfo {
    pub user_id: String,
    pub nickname: String,
    pub ip: String,
}
