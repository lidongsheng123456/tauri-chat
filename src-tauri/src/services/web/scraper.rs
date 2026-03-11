use crate::config;
use scraper::{Html, Selector};
use std::sync::OnceLock;

/// 全局复用的 scraper HTTP 客户端，连接池在应用生命周期内持续共享。
static HTTP_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

/// 在 UTF-8 字符串中按字符数安全截取前缀切片，避免在多字节字符边界处切断导致 panic。
///
/// 与直接使用字节索引切片（`&s[..n]`）不同，此函数通过 `char_indices` 定位
/// 第 `max_chars` 个字符对应的字节偏移量，确保截断点始终落在合法的字符边界上。
///
/// # Arguments
///
/// * `s`         - 原始字符串切片。
/// * `max_chars` - 允许保留的最大 Unicode 字符数。
///
/// # Returns
///
/// * 若字符数未超过 `max_chars`，返回原始切片（零拷贝）。
/// * 若超过，返回前 `max_chars` 个字符对应的字节范围切片。
pub(crate) fn truncate_safe(s: &str, max_chars: usize) -> &str {
    if s.chars().count() <= max_chars {
        return s;
    }
    let end = s
        .char_indices()
        .nth(max_chars)
        .map(|(i, _)| i)
        .unwrap_or(s.len());
    &s[..end]
}

/// 获取全局复用的 scraper HTTP 客户端，首次调用时完成初始化。
///
/// 客户端配置来源于 `lanchat.config.json` 的 `scraper` 节：
/// 超时时间（`request_timeout_secs`）与 User-Agent（`user_agent`）在首次调用时一次性写入，
/// 后续调用直接返回缓存引用，无额外开销。
///
/// # Returns
///
/// * `Ok(&'static reqwest::Client)` - 全局复用的 HTTP 客户端静态引用。
///
/// # Errors
///
/// * 若 `reqwest::Client` 构建失败（极少见），进程将 panic，属于不可恢复的初始化错误。
pub(crate) fn get_client() -> Result<&'static reqwest::Client, String> {
    Ok(HTTP_CLIENT.get_or_init(|| {
        let cfg = &config::get().scraper;
        reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(cfg.request_timeout_secs))
            .user_agent(&cfg.user_agent)
            .build()
            .expect("Failed to create HTTP client")
    }))
}

/// 校验 URL 合法性，拒绝非 HTTP/HTTPS 协议与内网地址，防止 SSRF 攻击。
///
/// 内网地址黑名单包括：`localhost`、`127.0.0.1`、`0.0.0.0`、`[::1]`
/// 以及 `192.168.*`、`10.*`、`172.*` 三个私有 IP 段。
///
/// # Arguments
///
/// * `url` - 待校验的目标 URL 字符串。
///
/// # Returns
///
/// * `Ok(())` - URL 合法，可以安全发起外部请求。
///
/// # Errors
///
/// * 若 URL 格式无法解析，返回 `"URL 格式错误: <原因>"` 错误。
/// * 若协议不是 `http` 或 `https`，返回 `"不支持的协议: <scheme>"` 错误。
/// * 若主机名命中内网地址黑名单，返回 `"不允许访问内网地址"` 错误。
/// * 若 URL 缺少主机名部分，返回 `"URL 缺少主机名"` 错误。
fn validate_url(url: &str) -> Result<(), String> {
    let parsed = url::Url::parse(url).map_err(|e| format!("URL 格式错误: {}", e))?;
    match parsed.scheme() {
        "http" | "https" => {}
        s => return Err(format!("不支持的协议: {}", s)),
    }
    if let Some(host) = parsed.host_str() {
        if host == "localhost"
            || host == "127.0.0.1"
            || host == "0.0.0.0"
            || host.starts_with("192.168.")
            || host.starts_with("10.")
            || host.starts_with("172.")
            || host == "[::1]"
        {
            return Err("不允许访问内网地址".to_string());
        }
    } else {
        return Err("URL 缺少主机名".to_string());
    }
    Ok(())
}

/// 抓取指定网页并解析为结构化可读文本，包含标题、正文与链接列表。
///
/// 内部调用 [`fetch_and_parse`]；若抓取或解析过程中出现任何错误，
/// 返回包含错误原因的中文提示字符串，而非向上抛出错误。
///
/// # Arguments
///
/// * `url` - 需要抓取并解析的目标网页 URL（需通过 SSRF 校验）。
///
/// # Returns
///
/// * `String` - 包含网页标题、正文内容与链接列表的多行 Markdown 格式字符串；
///   抓取失败时返回 `"抓取网页失败: <原因>"` 提示字符串。
pub async fn browse_website(url: &str) -> String {
    match fetch_and_parse(url).await {
        Ok(content) => content,
        Err(e) => format!("抓取网页失败: {}", e),
    }
}

/// 获取指定 URL 的原始响应文本，适用于 JSON API 或纯文本资源。
///
/// 内容超过配置项 `scraper.max_content_length` 字符数时，
/// 使用 [`truncate_safe`] 截断并在末尾附加截断提示行。
///
/// # Arguments
///
/// * `url` - 需要获取原始内容的目标 URL（需通过 SSRF 校验）。
///
/// # Returns
///
/// * `String` - URL 的原始响应文本（超长时截断）；
///   请求失败时返回 `"获取 URL 内容失败: <原因>"` 提示字符串。
pub async fn fetch_url_raw(url: &str) -> String {
    match fetch_raw(url).await {
        Ok(content) => {
            let max_len = config::get().scraper.max_content_length;
            let char_count = content.chars().count();
            if char_count > max_len {
                format!(
                    "{}\n\n[内容已截断，原始长度: {} 字符]",
                    truncate_safe(&content, max_len),
                    char_count
                )
            } else {
                content
            }
        }
        Err(e) => format!("获取 URL 内容失败: {}", e),
    }
}

/// 对 URL 进行 SSRF 校验后发起 GET 请求，返回响应文本。
///
/// 所有来自外部（用户输入或 AI 工具参数）的 URL 均应通过此函数请求，
/// 以确保内网地址保护始终生效。
///
/// # Arguments
///
/// * `url` - 需要请求的目标 URL，将先经过 [`validate_url`] 校验。
///
/// # Returns
///
/// * `Ok(String)` - HTTP 响应的文本内容。
///
/// # Errors
///
/// * 若 URL 未通过 SSRF 校验，返回对应的校验错误信息。
/// * 若 HTTP 请求发送失败，返回 `"请求失败: <原因>"` 错误。
/// * 若服务器返回非 2xx 状态码，返回 `"HTTP <状态码>"` 错误。
/// * 若读取响应体失败，返回 `"读取响应失败: <原因>"` 错误。
pub(crate) async fn fetch_raw(url: &str) -> Result<String, String> {
    validate_url(url)?;
    fetch_raw_no_check(url).await
}

/// 直接发起 GET 请求并返回响应文本，**不执行 SSRF 校验**。
///
/// 仅用于已知安全的内部可信 URL（如 `ip-api.com` 查询、DuckDuckGo 搜索等），
/// 这些 URL 由代码硬编码生成，不含用户可控部分。
/// 对于来自外部输入的 URL，必须使用 [`fetch_raw`]（带 SSRF 校验版本）。
///
/// # Arguments
///
/// * `url` - 需要请求的可信 URL，跳过内网地址校验。
///
/// # Returns
///
/// * `Ok(String)` - HTTP 响应的文本内容。
///
/// # Errors
///
/// * 若 HTTP 请求发送失败，返回 `"请求失败: <原因>"` 错误。
/// * 若服务器返回非 2xx 状态码，返回 `"HTTP <状态码>"` 错误。
/// * 若读取响应体失败，返回 `"读取响应失败: <原因>"` 错误。
pub(crate) async fn fetch_raw_no_check(url: &str) -> Result<String, String> {
    let client = get_client()?;
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }

    response
        .text()
        .await
        .map_err(|e| format!("读取响应失败: {}", e))
}

/// 抓取网页 HTML 并解析为包含标题、正文与链接的结构化 Markdown 文本。
///
/// 正文超过 `scraper.max_content_length` 字符时，截断后附加 `[内容已截断]` 提示。
/// 链接列表最多展示前 50 条，超出时附加汇总行。
///
/// # Arguments
///
/// * `url` - 需要抓取并解析的目标网页 URL。
///
/// # Returns
///
/// * `Ok(String)` - 解析后的多行 Markdown 格式文本，包含标题、URL、正文与链接列表。
///
/// # Errors
///
/// * 若 HTTP 请求失败，将错误向上传播。
async fn fetch_and_parse(url: &str) -> Result<String, String> {
    let html_text = fetch_raw(url).await?;
    let document = Html::parse_document(&html_text);

    let title = extract_title(&document);
    let body_text = extract_body_text(&document);
    let links = extract_links(&document, url);

    let mut result = String::new();
    result.push_str(&format!("# {}\n\n", title));
    result.push_str(&format!("URL: {}\n\n", url));
    result.push_str("## 页面内容\n\n");

    let max_len = config::get().scraper.max_content_length;
    let body_char_count = body_text.chars().count();
    if body_char_count > max_len {
        result.push_str(truncate_safe(&body_text, max_len));
        result.push_str(&format!(
            "\n\n[内容已截断，原始长度: {} 字符]",
            body_char_count
        ));
    } else {
        result.push_str(&body_text);
    }

    if !links.is_empty() {
        result.push_str("\n\n## 页面链接\n\n");
        for (i, (text, href)) in links.iter().enumerate().take(50) {
            result.push_str(&format!("{}. [{}]({})\n", i + 1, text, href));
        }
        if links.len() > 50 {
            result.push_str(&format!(
                "\n... 共 {} 个链接，仅显示前 50 个\n",
                links.len()
            ));
        }
    }

    Ok(result)
}

/// 从已解析的 HTML 文档中提取 `<title>` 标签的文本内容。
///
/// # Arguments
///
/// * `document` - 已通过 `scraper::Html::parse_document` 解析的 HTML 文档。
///
/// # Returns
///
/// * `String` - `<title>` 标签的修剪后文本；不存在时返回 `"无标题"`。
fn extract_title(document: &Html) -> String {
    let selector = match Selector::parse("title") {
        Ok(s) => s,
        Err(_) => return "无标题".to_string(),
    };
    document
        .select(&selector)
        .next()
        .map(|el| el.text().collect::<String>().trim().to_string())
        .unwrap_or_else(|| "无标题".to_string())
}

/// 从 HTML `<body>` 中提取可读正文文本，跳过 `script`、`style`、`nav` 等非内容标签。
///
/// 通过遍历 `body` 的所有后代文本节点，逐级向上检查祖先元素标签名，
/// 若任意祖先属于跳过标签集合，则忽略该文本节点，确保输出不含脚本代码、样式声明
/// 以及导航栏、页脚等与正文无关的文本。
///
/// # Arguments
///
/// * `document` - 已通过 `scraper::Html::parse_document` 解析的 HTML 文档。
///
/// # Returns
///
/// * `String` - 由换行符连接的所有有效文本段落；`body` 不存在时返回空字符串。
fn extract_body_text(document: &Html) -> String {
    let skip_tags = [
        "script", "style", "noscript", "nav", "footer", "header", "svg",
    ];

    let body_selector = match Selector::parse("body") {
        Ok(s) => s,
        Err(_) => return String::new(),
    };
    let body = match document.select(&body_selector).next() {
        Some(b) => b,
        None => return String::new(),
    };

    let mut text_parts: Vec<String> = Vec::new();

    for node in body.descendants() {
        if let Some(text) = node.value().as_text() {
            let mut should_skip = false;
            let mut current = node.parent();
            while let Some(parent) = current {
                if let Some(el) = parent.value().as_element() {
                    if skip_tags.contains(&el.name()) {
                        should_skip = true;
                        break;
                    }
                }
                current = parent.parent();
            }
            if !should_skip {
                let trimmed = text.trim();
                if !trimmed.is_empty() {
                    text_parts.push(trimmed.to_string());
                }
            }
        }
    }

    text_parts.join("\n")
}

/// 从 HTML 文档中提取所有超链接，并将相对 URL 解析为绝对 URL。
///
/// 跳过以 `#`、`javascript:`、`mailto:` 开头的链接，
/// 只保留可直接访问的 HTTP/HTTPS 链接。
/// 对于以 `/` 开头的绝对路径，拼接页面来源的 scheme 与 host。
/// 对于其他相对路径，拼接在页面 URL 末尾。
///
/// # Arguments
///
/// * `document` - 已通过 `scraper::Html::parse_document` 解析的 HTML 文档。
/// * `base_url` - 当前页面的 URL，用于将相对路径转换为绝对 URL。
///
/// # Returns
///
/// * `Vec<(String, String)>` - `(显示文本, 完整绝对 URL)` 的二元组列表；
///   链接文本为空时以 `href` 原始值作为显示文本。
fn extract_links(document: &Html, base_url: &str) -> Vec<(String, String)> {
    let selector = match Selector::parse("a[href]") {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };
    let mut links = Vec::new();

    for element in document.select(&selector) {
        if let Some(href) = element.value().attr("href") {
            let text: String = element.text().collect::<String>().trim().to_string();
            let display_text = if text.is_empty() {
                href.to_string()
            } else {
                text
            };

            let full_url = if href.starts_with("http://") || href.starts_with("https://") {
                href.to_string()
            } else if href.starts_with('/') {
                if let Ok(parsed) = url::Url::parse(base_url) {
                    format!(
                        "{}://{}{}",
                        parsed.scheme(),
                        parsed.host_str().unwrap_or(""),
                        href
                    )
                } else {
                    href.to_string()
                }
            } else if href.starts_with('#')
                || href.starts_with("javascript:")
                || href.starts_with("mailto:")
            {
                continue;
            } else {
                format!("{}/{}", base_url.trim_end_matches('/'), href)
            };

            links.push((display_text, full_url));
        }
    }

    links
}
