use std::net::SocketAddr;
use std::sync::Arc;
use tokio::sync::Mutex;
use warp::Filter;

use crate::models::chat::{ChatMessage, Clients};
use crate::server::handlers;

/// 启动聊天 HTTP/WebSocket 服务，注册 ws、upload、download、files 等路由
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
                    handlers::handle_connection(socket, clients, messages, addr)
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
        .and_then(handlers::handle_upload);

    let download_route = warp::path("files").and(warp::fs::dir("./chat_files"));

    let force_download_route = warp::path("download")
        .and(warp::path::tail())
        .and(warp::get())
        .and_then(handlers::handle_force_download);

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
