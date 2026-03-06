use scraper::{Html, Selector};

/// 抓取内容最大长度（字符数），超出则截断
const MAX_CONTENT_LENGTH: usize = 50_000;
/// HTTP 请求超时秒数
const REQUEST_TIMEOUT_SECS: u64 = 30;

/// UTF-8 安全截断：按字符数截取，避免在多字节字符中间切断导致 panic
fn truncate_safe(s: &str, max_chars: usize) -> &str {
    if s.chars().count() <= max_chars {
        return s;
    }
    let end = s.char_indices()
        .nth(max_chars)
        .map(|(i, _)| i)
        .unwrap_or(s.len());
    &s[..end]
}

/// 创建带超时和 User-Agent 的 HTTP 客户端
fn build_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))
}

/// 抓取并解析网页，返回标题、正文和链接列表
pub async fn browse_website(url: &str) -> String {
    match fetch_and_parse(url).await {
        Ok(content) => content,
        Err(e) => format!("抓取网页失败: {}", e),
    }
}

/// 获取 URL 原始文本内容，适用于 API 或 JSON
pub async fn fetch_url_raw(url: &str) -> String {
    match fetch_raw(url).await {
        Ok(content) => {
            let char_count = content.chars().count();
            if char_count > MAX_CONTENT_LENGTH {
                format!("{}\n\n[内容已截断，原始长度: {} 字符]", truncate_safe(&content, MAX_CONTENT_LENGTH), char_count)
            } else {
                content
            }
        }
        Err(e) => format!("获取 URL 内容失败: {}", e),
    }
}

/// 发起 GET 请求并返回响应文本
async fn fetch_raw(url: &str) -> Result<String, String> {
    let client = build_client()?;
    let response = client.get(url)
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }

    response.text()
        .await
        .map_err(|e| format!("读取响应失败: {}", e))
}

/// 抓取 HTML 并解析为结构化文本（标题、正文、链接）
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

    let body_char_count = body_text.chars().count();
    if body_char_count > MAX_CONTENT_LENGTH {
        result.push_str(truncate_safe(&body_text, MAX_CONTENT_LENGTH));
        result.push_str(&format!("\n\n[内容已截断，原始长度: {} 字符]", body_char_count));
    } else {
        result.push_str(&body_text);
    }

    if !links.is_empty() {
        result.push_str("\n\n## 页面链接\n\n");
        for (i, (text, href)) in links.iter().enumerate().take(50) {
            result.push_str(&format!("{}. [{}]({})\n", i + 1, text, href));
        }
        if links.len() > 50 {
            result.push_str(&format!("\n... 共 {} 个链接，仅显示前 50 个\n", links.len()));
        }
    }

    Ok(result)
}

/// 从 HTML 文档提取 title 标签内容
fn extract_title(document: &Html) -> String {
    let selector = Selector::parse("title").unwrap();
    document.select(&selector)
        .next()
        .map(|el| el.text().collect::<String>().trim().to_string())
        .unwrap_or_else(|| "无标题".to_string())
}

/// 从 body 提取正文文本，跳过 script/style/nav 等标签及其所有子节点
fn extract_body_text(document: &Html) -> String {
    let skip_tags = ["script", "style", "noscript", "nav", "footer", "header", "svg"];

    let body_selector = Selector::parse("body").unwrap();
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

/// 提取页面内所有链接，返回 (显示文本, 完整 URL)
fn extract_links(document: &Html, base_url: &str) -> Vec<(String, String)> {
    let selector = Selector::parse("a[href]").unwrap();
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
                    format!("{}://{}{}", parsed.scheme(), parsed.host_str().unwrap_or(""), href)
                } else {
                    href.to_string()
                }
            } else if href.starts_with('#') || href.starts_with("javascript:") || href.starts_with("mailto:") {
                continue;
            } else {
                format!("{}/{}", base_url.trim_end_matches('/'), href)
            };

            links.push((display_text, full_url));
        }
    }

    links
}
