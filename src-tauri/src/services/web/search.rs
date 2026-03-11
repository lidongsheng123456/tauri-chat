use super::scraper::{fetch_raw, fetch_raw_no_check};
use scraper::{Html, Selector};

/// 通过 DuckDuckGo HTML 接口搜索互联网，返回格式化的搜索结果列表。
///
/// 对查询关键词进行 URL 编码后构造搜索请求，解析返回的 HTML 页面，
/// 提取最多 10 条结果的标题、链接与摘要，格式化为 Markdown 有序列表。
/// 使用 [`fetch_raw_no_check`] 绕过 SSRF 校验，因为 DuckDuckGo 域名为硬编码可信地址。
///
/// # Arguments
///
/// * `query` - 搜索关键词字符串，支持中英文，内部自动进行 URL 编码。
///
/// # Returns
///
/// * `String` - 包含搜索结果的多行 Markdown 格式字符串，每条结果含标题、链接与摘要；
///   未找到任何结果时返回 `"未找到关于「query」的搜索结果"` 提示；
///   网络请求失败时返回 `"搜索失败: <原因>"` 提示字符串。
pub async fn web_search(query: &str) -> String {
    let encoded_query = urlencoding::encode(query);
    let search_url = format!("https://html.duckduckgo.com/html/?q={}", encoded_query);

    let html_text = match fetch_raw_no_check(&search_url).await {
        Ok(text) => text,
        Err(e) => return format!("搜索失败: {}", e),
    };

    let document = Html::parse_document(&html_text);
    let result_selector = match Selector::parse(".result") {
        Ok(s) => s,
        Err(_) => return "搜索结果解析失败".to_string(),
    };
    let title_sel = Selector::parse(".result__a").unwrap_or_else(|_| Selector::parse("a").unwrap());
    let snippet_sel =
        Selector::parse(".result__snippet").unwrap_or_else(|_| Selector::parse("td").unwrap());

    let mut results = Vec::new();
    for element in document.select(&result_selector).take(10) {
        let title = element
            .select(&title_sel)
            .next()
            .map(|el| el.text().collect::<String>().trim().to_string())
            .unwrap_or_default();

        let link = element
            .select(&title_sel)
            .next()
            .and_then(|el| el.value().attr("href"))
            .map(|h| h.to_string())
            .unwrap_or_default();

        let snippet = element
            .select(&snippet_sel)
            .next()
            .map(|el| el.text().collect::<String>().trim().to_string())
            .unwrap_or_default();

        if !title.is_empty() {
            results.push((title, link, snippet));
        }
    }

    if results.is_empty() {
        return format!("未找到关于「{}」的搜索结果", query);
    }

    let mut output = format!("## 搜索结果：{}\n\n", query);
    for (i, (title, link, snippet)) in results.iter().enumerate() {
        output.push_str(&format!("### {}. {}\n", i + 1, title));
        if !link.is_empty() {
            output.push_str(&format!("链接: {}\n", link));
        }
        if !snippet.is_empty() {
            output.push_str(&format!("{}\n", snippet));
        }
        output.push('\n');
    }

    output
}

/// 提取指定网页中所有图片的 URL、Alt 文本与尺寸信息。
///
/// 通过 [`fetch_raw`] 发起带 SSRF 校验的请求获取网页 HTML，
/// 解析所有 `<img src="...">` 标签（跳过空 src 与 Data URI），
/// 并将相对路径通过 [`resolve_url`] 解析为绝对 URL。
/// 最多返回前 50 张图片，超出时附加汇总提示行。
///
/// # Arguments
///
/// * `url` - 需要提取图片的目标网页 URL（需通过 SSRF 校验）。
///
/// # Returns
///
/// * `String` - 包含所有图片 URL、Alt 文本与尺寸信息的多行格式化字符串；
///   网页中无图片时返回 `"网页 <url> 未找到图片"` 提示；
///   网络请求失败时返回 `"获取网页失败: <原因>"` 提示字符串。
pub async fn extract_webpage_images(url: &str) -> String {
    let html_text = match fetch_raw(url).await {
        Ok(text) => text,
        Err(e) => return format!("获取网页失败: {}", e),
    };

    let document = Html::parse_document(&html_text);
    let img_selector = match Selector::parse("img[src]") {
        Ok(s) => s,
        Err(_) => return "选择器解析失败".to_string(),
    };

    let mut images: Vec<(String, String, String)> = Vec::new();

    for element in document.select(&img_selector) {
        let src = element.value().attr("src").unwrap_or_default();
        if src.is_empty() || src.starts_with("data:") {
            continue;
        }

        let full_url = resolve_url(url, src);
        let alt = element.value().attr("alt").unwrap_or("").to_string();
        let size = [
            element.value().attr("width").map(|w| format!("{}w", w)),
            element.value().attr("height").map(|h| format!("{}h", h)),
        ]
        .iter()
        .flatten()
        .cloned()
        .collect::<Vec<_>>()
        .join("×");

        images.push((full_url, alt, size));
    }

    if images.is_empty() {
        return format!("网页 {} 未找到图片", url);
    }

    let mut output = format!("## 网页图片（共 {} 张）\n\nURL: {}\n\n", images.len(), url);
    for (i, (img_url, alt, size)) in images.iter().enumerate().take(50) {
        output.push_str(&format!("{}. {}", i + 1, img_url));
        if !alt.is_empty() {
            output.push_str(&format!("  (alt: {})", alt));
        }
        if !size.is_empty() {
            output.push_str(&format!("  [{}]", size));
        }
        output.push('\n');
    }
    if images.len() > 50 {
        output.push_str(&format!(
            "\n... 共 {} 张图片，仅显示前 50 张\n",
            images.len()
        ));
    }

    output
}

/// 将相对 URL 解析为基于页面来源的绝对 URL。
///
/// 处理以下几种相对路径格式：
/// - 已是绝对 URL（`http://` 或 `https://` 开头）— 原样返回。
/// - 协议相对 URL（`//` 开头）— 补充 `https:` 前缀。
/// - 绝对路径（`/` 开头）— 拼接 `base` 的 scheme 与 host。
/// - 相对路径（其他情况）— 拼接在 `base` URL 末尾（去除尾部斜杠后加 `/`）。
///
/// # Arguments
///
/// * `base` - 当前页面的完整 URL，用于提取 scheme 与 host。
/// * `src`  - 需要解析的原始 `src` 属性值（相对或绝对路径）。
///
/// # Returns
///
/// * `String` - 解析后的完整绝对 URL 字符串。
fn resolve_url(base: &str, src: &str) -> String {
    if src.starts_with("http://") || src.starts_with("https://") {
        src.to_string()
    } else if src.starts_with("//") {
        format!("https:{}", src)
    } else if src.starts_with('/') {
        if let Ok(parsed) = url::Url::parse(base) {
            format!(
                "{}://{}{}",
                parsed.scheme(),
                parsed.host_str().unwrap_or(""),
                src
            )
        } else {
            src.to_string()
        }
    } else {
        format!("{}/{}", base.trim_end_matches('/'), src)
    }
}
