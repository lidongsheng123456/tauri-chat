use crate::services::file::download;

/// 将聊天中的文件下载保存到本机下载目录。
///
/// 优先从应用本地缓存目录（`./chat_files/`）复制文件，
/// 若本地缓存不存在则通过 HTTP 从聊天服务器拉取。
/// 目标文件名与本地已有文件冲突时，自动追加数字后缀（如 `file(1).txt`）避免覆盖。
///
/// # Arguments
///
/// * `file_path`  - 文件在服务器上的相对路径，格式通常为 `/files/<filename>`。
/// * `file_name`  - 保存到本地时使用的目标文件名。
/// * `server_url` - 聊天服务器地址（含端口），格式为 `host:port`，用于构造 HTTP 下载 URL。
///
/// # Returns
///
/// * `Ok(String)` - 文件成功保存后的本地绝对路径字符串。
///
/// # Errors
///
/// * 若 `file_path` 包含路径遍历字符（`..` 或 `\`），返回非法路径错误。
/// * 若本地下载目录不可写或磁盘写入失败，返回对应的 IO 错误信息。
/// * 若远程 HTTP 请求失败或服务器返回非 2xx 状态码，返回对应的网络错误信息。
#[tauri::command]
pub async fn download_chat_file(
    file_path: String,
    file_name: String,
    server_url: String,
) -> Result<String, String> {
    download::download_file(&file_path, &file_name, &server_url).await
}
