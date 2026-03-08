use std::sync::Arc;
use tokio::sync::Mutex;
use uuid::Uuid;

use super::ws_handler::broadcast_message;
use crate::models::chat::*;
use crate::utils::filename::sanitize_filename;

/// 处理文件上传，保存到 chat_files 并广播消息
pub async fn handle_upload(
    body: bytes::Bytes,
    file_name: String,
    from_id: String,
    from_name: String,
    to_id: String,
    msg_type: String,
    clients: Clients,
    messages: Arc<Mutex<Vec<ChatMessage>>>,
) -> Result<impl warp::Reply, warp::Rejection> {
    let decoded_name = urlencoding::decode(&file_name)
        .map(|s| s.into_owned())
        .unwrap_or_else(|_| file_name.clone());

    let valid_types = ["text", "image", "video", "file"];
    if !valid_types.contains(&msg_type.as_str()) {
        return Ok(warp::reply::json(
            &serde_json::json!({"ok": false, "error": "invalid msg_type"}),
        ));
    }

    let ext = std::path::Path::new(&decoded_name)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_string();

    let stem = std::path::Path::new(&decoded_name)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("file");

    let saved_name = if ext.is_empty() {
        format!("{}_{}", Uuid::new_v4(), sanitize_filename(stem))
    } else {
        format!(
            "{}_{}.{}",
            Uuid::new_v4(),
            sanitize_filename(stem),
            sanitize_filename(&ext)
        )
    };

    let file_path = format!("./chat_files/{}", saved_name);
    if let Err(e) = tokio::fs::write(&file_path, &body).await {
        log::error!("Failed to write file {}: {}", file_path, e);
        return Ok(warp::reply::json(
            &serde_json::json!({"ok": false, "error": "file write failed"}),
        ));
    }

    let msg = ChatMessage {
        id: Uuid::new_v4().to_string(),
        from_id,
        from_name,
        to_id,
        content: format!("/files/{}", saved_name),
        msg_type,
        file_name: Some(decoded_name),
        file_size: Some(body.len() as u64),
        timestamp: chrono::Utc::now().timestamp_millis(),
    };

    {
        let mut msgs = messages.lock().await;
        msgs.push(msg.clone());
    }

    if let Ok(event_str) = serde_json::to_string(&WsEvent {
        event: "message".to_string(),
        data: serde_json::to_value(&msg).unwrap_or_default(),
    }) {
        broadcast_message(&clients, &msg, &event_str).await;
    }

    Ok(warp::reply::json(
        &serde_json::json!({"ok": true, "url": msg.content}),
    ))
}

/// 强制下载文件，设置 Content-Disposition 为 attachment
pub async fn handle_force_download(
    tail: warp::path::Tail,
) -> Result<impl warp::Reply, warp::Rejection> {
    let file_name = tail.as_str();
    if file_name.contains("..") || file_name.contains('/') || file_name.contains('\\') {
        return Err(warp::reject::not_found());
    }

    let file_path = format!("./chat_files/{}", file_name);
    let data = tokio::fs::read(&file_path)
        .await
        .map_err(|_| warp::reject::not_found())?;

    let display_name = file_name
        .find('_')
        .map(|i| &file_name[i + 1..])
        .unwrap_or(file_name);
    let encoded_name = urlencoding::encode(display_name);

    warp::http::Response::builder()
        .header("Content-Type", "application/octet-stream")
        .header(
            "Content-Disposition",
            format!(
                "attachment; filename=\"{}\"; filename*=UTF-8''{}",
                display_name, encoded_name
            ),
        )
        .body(data)
        .map_err(|_| warp::reject::not_found())
}
