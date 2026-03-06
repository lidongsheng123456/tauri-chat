use serde::Serialize;

/// 网络接口信息，包含接口名称和 IP 地址
#[derive(Serialize)]
pub struct NetworkInterface {
    pub name: String,
    pub ip: String,
}
