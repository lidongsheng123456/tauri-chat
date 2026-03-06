use crate::models::network::NetworkInterface;
use crate::services::network_service;

/// 获取本机所有非回环的 IPv4 网络接口
#[tauri::command]
pub fn get_all_ips() -> Vec<NetworkInterface> {
    network_service::get_all_ips()
}

/// 获取本机主机名
#[tauri::command]
pub fn get_hostname() -> String {
    network_service::get_hostname()
}

/// 返回聊天服务端口号
#[tauri::command]
pub fn get_server_port() -> u16 {
    network_service::get_server_port()
}
