use crate::models::network::NetworkInterface;

/// 获取本机所有非回环的 IPv4 网络接口列表。
///
/// 遍历操作系统所有网络接口，过滤掉回环地址（`127.x.x.x`）与 IPv6 地址，
/// 仅保留可用于局域网通信的 IPv4 接口。
/// 若系统上没有任何可用接口（如纯虚拟机环境），自动追加 `127.0.0.1` 作为后备，
/// 确保返回列表至少包含一项。
///
/// # Returns
///
/// * `Vec<NetworkInterface>` - 可用网络接口列表，每项包含接口名称与 IPv4 地址字符串。
///   列表长度至少为 1（后备的 localhost 条目）。
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

/// 获取本机的操作系统主机名。
///
/// 调用系统 API 读取主机名并转换为 UTF-8 字符串；
/// 若系统调用失败（权限不足或平台不支持），返回字面量 `"Unknown"` 作为后备值。
///
/// # Returns
///
/// * `String` - 主机名字符串；系统调用失败时返回 `"Unknown"`。
pub fn get_hostname() -> String {
    hostname::get()
        .map(|h| h.to_string_lossy().to_string())
        .unwrap_or_else(|_| "Unknown".to_string())
}
