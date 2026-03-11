use std::path::PathBuf;

/// 将聊天中的文件下载保存到本机系统下载目录。
///
/// 优先从应用本地缓存目录（`./chat_files/`）复制文件，
/// 若本地缓存不存在则通过 HTTP 从聊天服务器拉取。
/// 目标文件名与本地已有文件冲突时，自动追加递增数字后缀
/// （如 `file(1).txt`、`file(2).txt`）避免覆盖已有文件。
///
/// # Arguments
///
/// * `file_path`  - 文件在服务器上的相对路径，格式通常为 `/files/<filename>`；
///   会自动剥离 `/files/` 前缀以获取存储文件名。
/// * `file_name`  - 保存到本地时使用的目标显示文件名（原始文件名，不含 UUID 前缀）。
/// * `server_url` - 聊天服务器地址，格式为 `host:port`（如 `192.168.1.1:9120`），
///   本地缓存不存在时用于构造 HTTP 下载 URL。
///
/// # Returns
///
/// * `Ok(String)` - 文件成功保存后的本地绝对路径字符串。
///
/// # Errors
///
/// * 若 `file_path` 中含有路径遍历字符（`..` 或 `\`），返回 `"Invalid file path"` 错误。
/// * 若本地 `copy` 操作失败，返回包含系统错误信息的字符串。
/// * 若 HTTP 下载请求发送失败，返回包含网络错误信息的字符串。
/// * 若服务器返回非 2xx 状态码，返回 `"Server returned HTTP <状态码>"` 错误。
/// * 若读取响应体或写入本地文件失败，返回对应的错误信息字符串。
pub async fn download_file(
    file_path: &str,
    file_name: &str,
    server_url: &str,
) -> Result<String, String> {
    let stored_name = file_path.strip_prefix("/files/").unwrap_or(file_path);

    if stored_name.contains("..") || stored_name.contains('\\') {
        return Err("Invalid file path".to_string());
    }

    let downloads_dir = dirs::download_dir()
        .unwrap_or_else(|| dirs::home_dir().unwrap_or_else(|| PathBuf::from(".")));

    let safe_name = std::path::Path::new(file_name)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("download");

    let mut dest = downloads_dir.join(safe_name);

    // 目标路径已存在时，追加递增数字后缀避免覆盖（如 file(1).txt、file(2).txt）
    if dest.exists() {
        let stem = std::path::Path::new(safe_name)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("file")
            .to_string();
        let ext = std::path::Path::new(safe_name)
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| format!(".{}", e))
            .unwrap_or_default();
        let mut counter = 1;
        loop {
            dest = downloads_dir.join(format!("{}({}){}", stem, counter, ext));
            if !dest.exists() {
                break;
            }
            counter += 1;
        }
    }

    // 优先从本地缓存复制，避免不必要的网络请求
    let local_src = PathBuf::from("./chat_files").join(stored_name);
    if local_src.exists() {
        tokio::fs::copy(&local_src, &dest)
            .await
            .map_err(|e| format!("Failed to save file: {}", e))?;
        return Ok(dest.to_string_lossy().to_string());
    }

    // 本地缓存不存在，从服务器拉取文件内容
    let client = reqwest::Client::builder()
        .no_proxy()
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;
    let url = format!("http://{}/files/{}", server_url, stored_name);
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Download request failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Server returned HTTP {}", response.status()));
    }

    let data = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read response: {}", e))?;

    tokio::fs::write(&dest, &data)
        .await
        .map_err(|e| format!("Failed to write file: {}", e))?;

    Ok(dest.to_string_lossy().to_string())
}
