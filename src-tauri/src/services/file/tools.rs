use std::fs;
use std::path::{Path, PathBuf};

/// 安全校验路径：禁止路径遍历和系统关键目录访问
fn validate_path(path: &str) -> Result<PathBuf, String> {
    let p = PathBuf::from(path);
    let canonical = if p.exists() {
        p.canonicalize()
            .map_err(|e| format!("路径解析失败: {}", e))?
    } else {
        if let Some(parent) = p.parent() {
            if parent.as_os_str().is_empty() || !parent.exists() {
                return Err("父目录不存在".to_string());
            }
            let canonical_parent = parent
                .canonicalize()
                .map_err(|e| format!("父目录解析失败: {}", e))?;
            canonical_parent.join(p.file_name().unwrap_or_default())
        } else {
            return Err("无效路径".to_string());
        }
    };

    let path_str = canonical.to_string_lossy().to_lowercase();
    let blocked = [
        "\\windows\\",
        "/windows/",
        "\\system32",
        "/system32",
        "/etc/",
        "/usr/",
        "/bin/",
        "/sbin/",
        "\\program files",
    ];
    for b in &blocked {
        if path_str.contains(b) {
            return Err(format!("禁止访问系统目录: {}", b));
        }
    }
    Ok(canonical)
}

/// 列出目录内容，返回文件和子目录清单
pub fn list_directory(path: &str) -> String {
    let dir = match validate_path(path) {
        Ok(p) => p,
        Err(e) => return format!("操作失败: {}", e),
    };
    if !dir.is_dir() {
        return format!("路径不是目录: {}", path);
    }

    let entries = match fs::read_dir(&dir) {
        Ok(e) => e,
        Err(e) => return format!("读取目录失败: {}", e),
    };

    let mut dirs = Vec::new();
    let mut files = Vec::new();

    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        let meta = entry.metadata();
        if let Ok(m) = &meta {
            if m.is_dir() {
                dirs.push(format!("📁 {}/", name));
            } else {
                let size = format_size(m.len());
                files.push(format!("📄 {} ({})", name, size));
            }
        }
    }

    dirs.sort();
    files.sort();

    let mut output = format!("## 目录: {}\n\n", dir.display());
    if dirs.is_empty() && files.is_empty() {
        output.push_str("（空目录）\n");
    } else {
        for d in &dirs {
            output.push_str(&format!("{}\n", d));
        }
        if !dirs.is_empty() && !files.is_empty() {
            output.push('\n');
        }
        for f in &files {
            output.push_str(&format!("{}\n", f));
        }
        output.push_str(&format!(
            "\n共 {} 个文件夹, {} 个文件",
            dirs.len(),
            files.len()
        ));
    }
    output
}

/// 读取文件内容（文本），超长时截断
pub fn read_file(path: &str) -> String {
    let file_path = match validate_path(path) {
        Ok(p) => p,
        Err(e) => return format!("操作失败: {}", e),
    };
    if !file_path.is_file() {
        return format!("文件不存在: {}", path);
    }

    match fs::read_to_string(&file_path) {
        Ok(content) => {
            let max_chars = 100_000;
            let char_count = content.chars().count();
            if char_count > max_chars {
                let truncated: String = content.chars().take(max_chars).collect();
                format!(
                    "📄 {} ({} 字符，已截断)\n\n```\n{}\n```\n\n[内容已截断，原始长度: {} 字符]",
                    file_path.display(),
                    max_chars,
                    truncated,
                    char_count
                )
            } else {
                let ext = file_path.extension().and_then(|e| e.to_str()).unwrap_or("");
                format!(
                    "📄 {} ({} 字符)\n\n```{}\n{}\n```",
                    file_path.display(),
                    char_count,
                    ext,
                    content
                )
            }
        }
        Err(e) => format!("读取文件失败（可能不是文本文件）: {}", e),
    }
}

/// 写入文件内容（新建或覆盖）
pub fn write_file(path: &str, content: &str) -> String {
    let file_path = match validate_path(path) {
        Ok(p) => p,
        Err(e) => return format!("操作失败: {}", e),
    };

    if let Some(parent) = file_path.parent() {
        if !parent.exists() {
            if let Err(e) = fs::create_dir_all(parent) {
                return format!("创建父目录失败: {}", e);
            }
        }
    }

    let existed = file_path.exists();
    match fs::write(&file_path, content) {
        Ok(_) => {
            let action = if existed { "已更新" } else { "已创建" };
            format!(
                "✅ 文件{}: {} ({} 字符)",
                action,
                file_path.display(),
                content.len()
            )
        }
        Err(e) => format!("写入文件失败: {}", e),
    }
}

/// 创建目录（支持递归创建）
pub fn create_directory(path: &str) -> String {
    let dir_path = match validate_path(path) {
        Ok(p) => p,
        Err(e) => return format!("操作失败: {}", e),
    };

    if dir_path.exists() {
        return format!("⚠️ 目录已存在: {}", dir_path.display());
    }

    match fs::create_dir_all(&dir_path) {
        Ok(_) => format!("✅ 目录已创建: {}", dir_path.display()),
        Err(e) => format!("创建目录失败: {}", e),
    }
}

/// 删除文件或目录
pub fn delete_path(path: &str) -> String {
    let target = match validate_path(path) {
        Ok(p) => p,
        Err(e) => return format!("操作失败: {}", e),
    };

    if !target.exists() {
        return format!("路径不存在: {}", path);
    }

    if target.is_dir() {
        match fs::remove_dir_all(&target) {
            Ok(_) => format!("✅ 目录已删除: {}", target.display()),
            Err(e) => format!("删除目录失败: {}", e),
        }
    } else {
        match fs::remove_file(&target) {
            Ok(_) => format!("✅ 文件已删除: {}", target.display()),
            Err(e) => format!("删除文件失败: {}", e),
        }
    }
}

/// 在目录中搜索文件名匹配关键词的文件（递归，最多 100 条）
pub fn search_files(dir: &str, keyword: &str) -> String {
    let search_dir = match validate_path(dir) {
        Ok(p) => p,
        Err(e) => return format!("操作失败: {}", e),
    };
    if !search_dir.is_dir() {
        return format!("路径不是目录: {}", dir);
    }

    let lower_kw = keyword.to_lowercase();
    let mut results = Vec::new();
    search_recursive(&search_dir, &lower_kw, &mut results, 100);

    if results.is_empty() {
        return format!(
            "在 {} 中未找到匹配「{}」的文件",
            search_dir.display(),
            keyword
        );
    }

    let mut output = format!(
        "## 搜索结果：「{}」\n\n目录: {}\n\n",
        keyword,
        search_dir.display()
    );
    for (i, path) in results.iter().enumerate() {
        let rel = path.strip_prefix(&search_dir).unwrap_or(path);
        let meta = fs::metadata(path);
        let size = meta
            .as_ref()
            .map(|m| format_size(m.len()))
            .unwrap_or_default();
        let icon = if path.is_dir() { "📁" } else { "📄" };
        output.push_str(&format!(
            "{}. {} {} ({})\n",
            i + 1,
            icon,
            rel.display(),
            size
        ));
    }
    output.push_str(&format!("\n共找到 {} 个匹配项", results.len()));
    output
}

/// 递归搜索实现
fn search_recursive(dir: &Path, keyword: &str, results: &mut Vec<PathBuf>, max: usize) {
    if results.len() >= max {
        return;
    }
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        if results.len() >= max {
            return;
        }
        let name = entry.file_name().to_string_lossy().to_lowercase();
        let path = entry.path();
        if name.contains(keyword) {
            results.push(path.clone());
        }
        if path.is_dir() && !name.starts_with('.') {
            search_recursive(&path, keyword, results, max);
        }
    }
}

/// 格式化文件大小
fn format_size(bytes: u64) -> String {
    if bytes < 1024 {
        return format!("{} B", bytes);
    }
    if bytes < 1024 * 1024 {
        return format!("{:.1} KB", bytes as f64 / 1024.0);
    }
    if bytes < 1024 * 1024 * 1024 {
        return format!("{:.1} MB", bytes as f64 / (1024.0 * 1024.0));
    }
    format!("{:.2} GB", bytes as f64 / (1024.0 * 1024.0 * 1024.0))
}
