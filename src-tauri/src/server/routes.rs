use std::net::SocketAddr;
use std::sync::Arc;
use tokio::sync::Mutex;
use warp::Filter;

use crate::models::chat::{ChatMessage, Clients};
use crate::server::{file_handler, ws_handler};

/// 启动聊天 HTTP/WebSocket 服务，注册 `/ws`、`/upload`、`/download`、`/files` 四条路由。
///
/// 在应用 `setup` 回调中通过 `tauri::async_runtime::spawn` 在后台运行，不阻塞主线程。
/// 首次启动时若端口绑定失败，会等待 2 秒后自动重试一次；
/// 重试仍失败则记录错误日志并放弃启动（不 panic，避免影响主进程）。
///
/// 路由说明：
/// - `GET  /ws`       — WebSocket 升级端点，处理客户端连接、join、message 事件。
/// - `POST /upload`   — 文件上传端点，保存文件并向相关客户端广播消息。
/// - `GET  /files/*`  — 静态文件服务，直接提供 `./chat_files/` 目录下的文件。
/// - `GET  /download/*` — 强制下载端点，设置 `Content-Disposition: attachment`。
///
/// # Arguments
///
/// * `clients`  - 当前所有在线客户端的共享映射表。
/// * `messages` - 服务端内存中的消息历史共享列表。
/// * `port`     - 服务监听端口，来源于 `lanchat.config.json` 的 `server.chat_port`。
///
/// # Returns
///
/// 此函数在正常情况下不会返回（持续运行直至进程退出）。
pub async fn start_server(clients: Clients, messages: Arc<Mutex<Vec<ChatMessage>>>, port: u16) {
    if let Err(e) = tokio::fs::create_dir_all("./chat_files").await {
        log::error!("Failed to create chat_files directory: {}", e);
    }

    let clients_filter = warp::any().map(move || clients.clone());
    let messages_filter = {
        let msgs = messages.clone();
        warp::any().map(move || msgs.clone())
    };

    let ws_route = warp::path("ws")
        .and(warp::ws())
        .and(clients_filter.clone())
        .and(messages_filter.clone())
        .and(warp::addr::remote())
        .map(
            |ws: warp::ws::Ws,
             clients: Clients,
             messages: Arc<Mutex<Vec<ChatMessage>>>,
             addr: Option<SocketAddr>| {
                ws.on_upgrade(move |socket| {
                    ws_handler::handle_connection(socket, clients, messages, addr)
                })
            },
        );

    let upload_clients = clients_filter.clone();
    let upload_route = warp::path("upload")
        .and(warp::post())
        .and(warp::body::bytes())
        .and(warp::header::<String>("x-file-name"))
        .and(warp::header::<String>("x-from-id"))
        .and(warp::header::<String>("x-from-name"))
        .and(warp::header::<String>("x-to-id"))
        .and(warp::header::<String>("x-msg-type"))
        .and(upload_clients)
        .and(messages_filter.clone())
        .and_then(file_handler::handle_upload);

    let download_route = warp::path("files").and(warp::fs::dir("./chat_files"));

    let force_download_route = warp::path("download")
        .and(warp::path::tail())
        .and(warp::get())
        .and_then(file_handler::handle_force_download);

    let cors = warp::cors()
        .allow_any_origin()
        .allow_headers(vec![
            "content-type",
            "x-file-name",
            "x-from-id",
            "x-from-name",
            "x-to-id",
            "x-msg-type",
        ])
        .allow_methods(vec!["GET", "POST", "OPTIONS"]);

    let routes = ws_route
        .or(upload_route)
        .or(force_download_route)
        .or(download_route)
        .with(cors);

    log::info!("Chat server starting on port {}", port);

    let addr: std::net::SocketAddr = ([0, 0, 0, 0], port).into();
    let listener = match tokio::net::TcpListener::bind(addr).await {
        Ok(l) => l,
        Err(e) => {
            log::error!(
                "Failed to bind to port {}: {}. Port may be in use.",
                port,
                e
            );
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            match tokio::net::TcpListener::bind(addr).await {
                Ok(l) => l,
                Err(e2) => {
                    log::error!("Retry failed: {}. Server not started.", e2);
                    return;
                }
            }
        }
    };
    let incoming = tokio_stream::wrappers::TcpListenerStream::new(listener);
    warp::serve(routes).run_incoming(incoming).await;
}
