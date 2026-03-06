use crate::models::network::NetworkInterface;

/// 获取本机所有非回环的 IPv4 网络接口
///
/// 若无可用网络接口，返回 localhost 作为后备
#[tauri::command]
pub fn get_all_ips() -> Vec<NetworkInterface> {
    let mut interfaces = Vec::new();
    if let Ok(list) = local_ip_address::list_afinet_netifas() {
        for (name, ip) in list {
            if ip.is_ipv4() && !ip.is_loopback() {
                interfaces.push(NetworkInterface {
                    name,
                    ip: ip.to_string(),
                });
            }
        }
    }
    if interfaces.is_empty() {
        interfaces.push(NetworkInterface {
            name: "localhost".to_string(),
            ip: "127.0.0.1".to_string(),
        });
    }
    interfaces
}

/// 获取本机主机名
#[tauri::command]
pub fn get_hostname() -> String {
    hostname::get()
        .map(|h| h.to_string_lossy().to_string())
        .unwrap_or_else(|_| "Unknown".to_string())
}

/// 返回聊天服务端口号
#[tauri::command]
pub fn get_server_port() -> u16 {
    9120
}
