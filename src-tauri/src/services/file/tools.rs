use std::fs;
use std::path::{Path, PathBuf};

/// 对目标路径进行安全校验，防止路径遍历攻击与系统关键目录访问。
///
/// 对于已存在的路径，调用 [`std::fs::canonicalize`] 解析为绝对路径后进行黑名单比对；
/// 对于不存在的路径（如待创建的文件），解析其父目录的规范路径后再拼接文件名。
///
/// 黑名单包含以下系统目录（大小写不敏感）：
/// `\windows\`、`\system32`、`/etc/`、`/usr/`、`/bin/`、`/sbin/`、`\program files`。
///
/// # Arguments
///
/// * `path` - 待校验的路径字符串（绝对或相对路径均可）。
///
/// # Returns
///
/// * `Ok(PathBuf)` - 校验通过后的规范化绝对路径。
///
/// # Errors
///
/// * 若路径解析（`canonicalize`）失败，返回包含系统错误信息的字符串。
/// * 若父目录不存在，返回 `"父目录不存在"` 错误。
/// * 若路径命中系统目录黑名单，返回 `"禁止访问系统目录: <匹配项>"` 错误。
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

/// 列出指定目录下的所有文件与子目录，按名称排序后格式化为可读文本。
///
/// 子目录排在文件之前，各自按字母序排列。
/// 每条目录项以 `📁 <name>/` 格式显示，文件项以 `📄 <name> (<size>)` 格式显示。
/// 输出末尾附有汇总行：`共 N 个文件夹, M 个文件`。
///
/// # Arguments
///
/// * `path` - 需要列出内容的目录绝对路径字符串。
///
/// # Returns
///
/// * `String` - 包含目录内容清单的多行格式化字符串；
///   路径不合法、不存在或不是目录时返回包含错误原因的中文提示字符串。
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

/// 读取指定文件的文本内容，超过 10 万字符时自动截断并附加提示。
///
/// 文件内容以 Markdown 代码块格式包裹，代码块语言标识由文件扩展名决定（无扩展名时为空）。
/// 适用于查看代码、配置文件等纯文本内容；二进制文件会因 UTF-8 解析失败而返回错误提示。
///
/// # Arguments
///
/// * `path` - 需要读取的文件绝对路径字符串。
///
/// # Returns
///
/// * `String` - 以 Markdown 代码块包裹的文件内容字符串；
///   超长时截断并附加 `[内容已截断]` 提示；
///   路径不合法、文件不存在或为二进制文件时返回包含错误原因的中文提示字符串。
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

/// 将指定内容写入文件，文件不存在时自动创建，已存在时覆盖原有内容。
///
/// 若目标文件的父目录不存在，会尝试递归创建所有缺失的中间目录。
/// 写入成功后根据文件是否为新建返回 `"已创建"` 或 `"已更新"` 的状态提示。
///
/// # Arguments
///
/// * `path`    - 写入目标文件的绝对路径字符串，文件不存在时自动创建。
/// * `content` - 写入文件的完整文本内容，将覆盖原有内容（如存在）。
///
/// # Returns
///
/// * `String` - 成功时返回 `"✅ 文件已创建/已更新: <path> (<N> 字符)"` 格式的提示；
///   路径不合法、父目录创建失败或磁盘写入失败时返回包含错误原因的中文提示字符串。
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
                content.chars().count()
            )
        }
        Err(e) => format!("写入文件失败: {}", e),
    }
}

/// 创建指定目录，支持递归创建多级父目录。
///
/// 若目标目录已存在，直接返回 `⚠️ 目录已存在` 提示，不报错也不修改现有内容。
///
/// # Arguments
///
/// * `path` - 需要创建的目录绝对路径字符串，支持多级路径（如 `/a/b/c`）。
///
/// # Returns
///
/// * `String` - 成功时返回 `"✅ 目录已创建: <path>"` 提示；
///   目录已存在时返回 `"⚠️ 目录已存在: <path>"` 提示；
///   路径不合法或磁盘操作失败时返回包含错误原因的中文提示字符串。
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

/// 删除指定路径的文件或目录（目录将递归删除所有内容）。
///
/// 删除前会通过 [`validate_path`] 进行安全校验，防止误删系统关键目录。
/// 此操作不可逆，请谨慎使用。
///
/// # Arguments
///
/// * `path` - 需要删除的文件或目录的绝对路径字符串；目录将递归删除其所有子项。
///
/// # Returns
///
/// * `String` - 成功时返回 `"✅ 文件/目录已删除: <path>"` 提示；
///   路径不存在时返回 `"路径不存在: <path>"` 提示；
///   路径不合法或删除操作失败时返回包含错误原因的中文提示字符串。
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

/// 在指定目录下递归搜索文件名包含关键词的文件与目录，最多返回 100 条结果。
///
/// 搜索不区分大小写，以关键词的小写形式与文件名的小写形式进行包含匹配。
/// 以 `.` 开头的隐藏目录不会被递归搜索（但其自身名称若匹配仍会被收录）。
/// 结果按发现顺序排列（深度优先），并附有序号、图标与文件大小信息。
///
/// # Arguments
///
/// * `dir`     - 执行递归搜索的根目录绝对路径字符串。
/// * `keyword` - 文件名匹配关键词，不区分大小写。
///
/// # Returns
///
/// * `String` - 包含搜索结果列表的多行格式化字符串；
///   未找到匹配项时返回 `"在 <dir> 中未找到匹配「keyword」的文件"` 提示；
///   路径不合法或不是目录时返回包含错误原因的中文提示字符串。
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

/// 递归搜索目录，将匹配关键词的路径追加到 `results`，达到 `max` 条时提前终止。
///
/// 采用深度优先遍历策略：先检查当前目录的直接子项，再递归进入子目录。
/// 跳过以 `.` 开头的隐藏目录，避免搜索 `.git`、`.cargo` 等大型隐藏目录。
///
/// # Arguments
///
/// * `dir`     - 当前递归遍历的目录路径。
/// * `keyword` - 已转为小写的搜索关键词，与文件名小写形式进行包含匹配。
/// * `results` - 用于收集匹配结果的路径列表，由调用方传入并在递归中共享。
/// * `max`     - 结果数量上限，达到此数量后所有递归调用立即返回。
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

/// 将字节数格式化为人类可读的文件大小字符串。
///
/// 使用 1024 进制转换，依次尝试 B、KB、MB、GB 四个量级，
/// 选取最合适的单位并保留 1 位小数（GB 保留 2 位）。
///
/// # Arguments
///
/// * `bytes` - 文件的字节数。
///
/// # Returns
///
/// * `String` - 格式化后的文件大小字符串，例如 `"1.5 KB"`、`"2.0 MB"`。
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
