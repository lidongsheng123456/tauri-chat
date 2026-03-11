use serde::Serialize;

/// 本机网络接口信息，用于在登录界面展示可选的监听地址。
///
/// 由 [`crate::services::network_service::get_all_ips`] 生成，
/// 序列化后通过 Tauri Command `get_all_ips` 返回给前端。
#[derive(Serialize)]
pub struct NetworkInterface {
    /// 网络接口的操作系统名称，例如 `"以太网"` 或 `"WLAN"`。
    pub name: String,
    /// 该接口绑定的 IPv4 地址字符串，格式为点分十进制（如 `"192.168.1.100"`）。
    pub ip: String,
}
