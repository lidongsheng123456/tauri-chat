use std::path::PathBuf;

/// 下载聊天文件到本地下载目录，优先本地缓存，否则从远程拉取
pub async fn download_file(file_path: &str, file_name: &str, server_url: &str) -> Result<String, String> {
    let stored_name = file_path
        .strip_prefix("/files/")
        .unwrap_or(file_path);

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
            if !dest.exists() { break; }
            counter += 1;
        }
    }

    let local_src = PathBuf::from("./chat_files").join(stored_name);
    if local_src.exists() {
        tokio::fs::copy(&local_src, &dest)
            .await
            .map_err(|e| format!("Failed to save file: {}", e))?;
        return Ok(dest.to_string_lossy().to_string());
    }

    let client = reqwest::Client::builder()
        .no_proxy()
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;
    let url = format!("http://{}/files/{}", server_url, stored_name);
    let response = client.get(&url)
        .send()
        .await
        .map_err(|e| format!("Download request failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Server returned HTTP {}", response.status()));
    }

    let data = response.bytes()
        .await
        .map_err(|e| format!("Failed to read response: {}", e))?;

    tokio::fs::write(&dest, &data)
        .await
        .map_err(|e| format!("Failed to write file: {}", e))?;

    Ok(dest.to_string_lossy().to_string())
}
