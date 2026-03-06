use super::web_scraper::{fetch_raw, fetch_raw_no_check};
use scraper::{Html, Selector};

/// 搜索引擎查询（DuckDuckGo HTML），返回搜索结果列表
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

/// 提取网页中所有图片 URL（src、alt、尺寸）
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

/// 将相对 URL 解析为绝对 URL
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
