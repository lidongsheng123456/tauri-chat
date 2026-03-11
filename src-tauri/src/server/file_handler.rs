use std::sync::Arc;
use tokio::sync::Mutex;
use uuid::Uuid;

use super::ws_handler::{broadcast_message, store_message};
use crate::models::chat::*;
use crate::utils::filename::sanitize_filename;

/// 处理客户端通过 HTTP POST `/upload` 端点上传的文件，保存到本地并广播消息。
///
/// 执行流程：
/// 1. 对 `x-file-name` 请求头进行 URL 解码，还原原始文件名。
/// 2. 校验 `x-msg-type` 是否为合法枚举值（`text` / `image` / `video` / `file`）。
/// 3. 提取文件扩展名，生成 `<UUID>_<stem>.<ext>` 格式的唯一存储文件名，
///    防止同名文件覆盖；文件名中的非法字符通过 [`sanitize_filename`] 清理。
/// 4. 将文件字节写入 `./chat_files/<saved_name>`。
/// 5. 构造 [`ChatMessage`] 并追加到内存历史，同时广播给相关客户端。
/// 6. 返回 `{ "ok": true, "url": "/files/<saved_name>" }` JSON 响应。
///
/// # Arguments
///
/// * `body`      - 请求体原始字节，即文件的二进制内容。
/// * `file_name` - `x-file-name` 请求头，URL 编码的原始文件名。
/// * `from_id`   - `x-from-id` 请求头，上传方的用户 ID。
/// * `from_name` - `x-from-name` 请求头，上传方的昵称。
/// * `to_id`     - `x-to-id` 请求头，接收方的用户 ID；群聊时为 `"all"`。
/// * `msg_type`  - `x-msg-type` 请求头，消息类型标识。
/// * `clients`   - 当前所有在线客户端的共享映射表，用于广播消息。
/// * `messages`  - 服务端内存中的消息历史共享列表。
///
/// # Returns
///
/// * `Ok(warp::reply::Json)` - 始终返回 JSON 响应体，成功时含 `url` 字段，失败时含 `error` 字段。
///
/// # Errors
///
/// * 若 `msg_type` 不合法，返回 `{"ok": false, "error": "invalid msg_type"}`。
/// * 若文件写入磁盘失败，返回 `{"ok": false, "error": "file write failed"}`。
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

    store_message(&messages, msg.clone()).await;

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

/// 处理 `GET /download/<filename>` 请求，将文件以附件形式强制下载。
///
/// 与 `/files/*` 静态路由不同，此端点会设置 `Content-Disposition: attachment`
/// 响应头，强制浏览器弹出"另存为"对话框，而非在浏览器内直接预览。
/// 文件名采用 RFC 5987 的 `filename*=UTF-8''<encoded>` 格式，正确处理非 ASCII 文件名。
///
/// 出于安全考虑，`filename` 参数不得包含路径遍历字符（`..`、`/`、`\`），
/// 违反此规则时直接返回 404，防止任意文件读取漏洞。
///
/// # Arguments
///
/// * `tail` - URL 路径尾部，即 `/download/` 之后的文件名部分（不含路径分隔符）。
///
/// # Returns
///
/// * `Ok(warp::http::Response<Vec<u8>>)` - 包含文件内容与下载响应头的 HTTP 响应。
///
/// # Errors
///
/// * 若 `filename` 包含 `..`、`/`、`\`，返回 404 拒绝访问。
/// * 若目标文件不存在或读取失败，返回 404。
/// * 若构造 HTTP 响应体失败（极少见），返回 404。
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

    // 去除 UUID 前缀，将 "<uuid>_<original>" 还原为 "<original>" 用于展示
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
