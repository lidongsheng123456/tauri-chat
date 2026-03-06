use crate::services::file::download;

/// 下载聊天文件到本地下载目录，支持本地缓存或远程拉取
#[tauri::command]
pub async fn download_chat_file(
    file_path: String,
    file_name: String,
    server_url: String,
) -> Result<String, String> {
    download::download_file(&file_path, &file_name, &server_url).await
}
