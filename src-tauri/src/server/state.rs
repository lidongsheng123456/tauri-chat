use crate::models::chat::{Clients, Messages};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{Mutex, RwLock};

/// 聊天服务的共享运行时状态，持有客户端连接表与消息历史的线程安全引用。
///
/// `ChatServer` 在应用启动时创建一次，其内部的 `Arc` 引用计数指针
/// 会被克隆后分别传入 WebSocket 路由处理器与文件上传处理器，
/// 确保所有请求处理器共享同一份状态。
pub struct ChatServer {
    /// 当前所有在线客户端的映射表：`user_id` → [`crate::models::chat::Client`]。
    ///
    /// 使用 `RwLock` 保护，允许多个处理器并发读取在线列表，
    /// 仅在客户端加入或断开时独占写锁。
    pub clients: Clients,

    /// 服务端内存中维护的聊天消息历史列表。
    ///
    /// 使用 `Mutex` 保护，确保并发写入时的数据一致性。
    /// 列表长度由配置项 `chat.max_message_history` 控制，超出时自动淘汰最旧记录。
    pub messages: Messages,
}

impl ChatServer {
    /// 创建一个空的聊天服务状态实例。
    ///
    /// 初始化空的客户端映射表与消息历史列表，
    /// 两者均被 `Arc` 包裹以便在异步任务间低成本克隆共享。
    ///
    /// # Returns
    ///
    /// * [`ChatServer`] - 包含空客户端表与空消息列表的新实例。
    pub fn new() -> Self {
        Self {
            clients: Arc::new(RwLock::new(HashMap::new())),
            messages: Arc::new(Mutex::new(Vec::new())),
        }
    }
}
