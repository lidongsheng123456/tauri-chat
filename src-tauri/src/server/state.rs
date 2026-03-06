use crate::models::chat::{Clients, Messages};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{Mutex, RwLock};

/// 聊天服务状态，包含客户端列表和消息历史
pub struct ChatServer {
    pub clients: Clients,
    pub messages: Messages,
}

impl ChatServer {
    /// 创建新的聊天服务实例
    pub fn new() -> Self {
        Self {
            clients: Arc::new(RwLock::new(HashMap::new())),
            messages: Arc::new(Mutex::new(Vec::new())),
        }
    }
}
