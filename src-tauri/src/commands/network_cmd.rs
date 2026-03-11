use crate::models::network::NetworkInterface;
use crate::services::network_service;

/// 获取本机所有非回环的 IPv4 网络接口列表。
///
/// 遍历系统所有网络接口，过滤掉回环地址（127.x.x.x）与 IPv6 地址，
/// 若无任何可用接口则自动返回 `127.0.0.1` 作为后备。
///
/// # Returns
///
/// * `Vec<NetworkInterface>` - 可用的网络接口列表，每项包含接口名称与 IPv4 地址。
///   列表至少包含一项（后备的 localhost）。
#[tauri::command]
pub fn get_all_ips() -> Vec<NetworkInterface> {
    network_service::get_all_ips()
}

/// 获取本机的操作系统主机名。
///
/// # Returns
///
/// * `String` - 主机名字符串；若系统调用失败则返回 `"Unknown"`。
#[tauri::command]
pub fn get_hostname() -> String {
    network_service::get_hostname()
}
