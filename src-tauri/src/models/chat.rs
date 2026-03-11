use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{Mutex, RwLock, mpsc};
use warp::ws::Message;

/// 在线客户端映射：`user_id` → [`Client`]。
///
/// 使用 [`RwLock`] 保护以允许多个读者并发访问，仅在写入时独占锁定。
pub type Clients = Arc<RwLock<HashMap<String, Client>>>;

/// 服务端内存中的聊天消息历史列表。
///
/// 使用 [`Mutex`] 保护，确保并发写入时的数据一致性。
pub type Messages = Arc<Mutex<Vec<ChatMessage>>>;

/// 一个已建立 WebSocket 连接的在线客户端。
///
/// 持有用户身份信息与向该客户端推送消息所需的发送通道。
/// 克隆成本极低（仅克隆 `sender` 通道句柄），可安全地在异步任务间传递。
#[derive(Debug, Clone)]
pub struct Client {
    /// 客户端的唯一用户 ID，由客户端生成的稳定 UUID 标识。
    pub user_id: String,
    /// 客户端登录时使用的昵称。
    pub nickname: String,
    /// 向该客户端发送 WebSocket 消息的无界 MPSC 通道发送端。
    pub sender: mpsc::UnboundedSender<Message>,
}

/// 一条完整的聊天消息，用于服务端存储、WebSocket 广播与前端展示。
///
/// 支持文本、图片、视频和文件四种消息类型，通过 `msg_type` 字段区分。
/// 文件类消息的 `content` 字段存储服务器上的相对路径（如 `/files/xxx.png`）。
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ChatMessage {
    /// 消息的全局唯一标识符，由服务端在接收时通过 UUID v4 生成。
    pub id: String,
    /// 发送方的用户 ID。
    pub from_id: String,
    /// 发送方的昵称，用于在前端展示发送者名称。
    pub from_name: String,
    /// 接收方的用户 ID；群发消息时值为 `"all"`。
    pub to_id: String,
    /// 消息的主要内容：文本消息时为消息正文，文件类消息时为服务器相对路径。
    pub content: String,
    /// 消息类型，取值为 `"text"` / `"image"` / `"video"` / `"file"`。
    pub msg_type: String,
    /// 文件的原始文件名，仅文件类消息存在。
    pub file_name: Option<String>,
    /// 文件大小（字节），仅文件类消息存在，用于前端展示文件大小。
    pub file_size: Option<u64>,
    /// 消息创建时间的 Unix 时间戳（毫秒），由服务端写入。
    pub timestamp: i64,
}

/// 通用 WebSocket 事件包装结构，用于前后端之间的消息协议。
///
/// 所有通过 WebSocket 收发的消息均序列化为此结构，
/// 前端通过 `event` 字段区分事件类型，`data` 字段携带具体载荷。
#[derive(Debug, Serialize, Deserialize)]
pub struct WsEvent {
    /// 事件类型标识，例如 `"welcome"`、`"users"`、`"message"`、`"history"`、`"join"`。
    pub event: String,
    /// 事件携带的 JSON 载荷数据，具体结构由 `event` 字段决定。
    pub data: serde_json::Value,
}

/// 用户简要信息，用于向所有在线客户端广播当前在线用户列表。
///
/// 与 [`Client`] 的区别：不含发送通道，仅保留前端展示所需的公开字段。
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UserInfo {
    /// 用户的唯一 ID，与 [`Client::user_id`] 对应。
    pub user_id: String,
    /// 用户的昵称，与 [`Client::nickname`] 对应。
    pub nickname: String,
    /// 用户的客户端 IP 地址字符串，格式为点分十进制（如 `"192.168.1.5"`）。
    pub ip: String,
}
