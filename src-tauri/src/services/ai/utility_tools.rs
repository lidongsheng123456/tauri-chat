use crate::services::web::scraper as web_scraper;

/// 获取当前日期时间（含时区、星期、Unix 时间戳）
pub fn get_current_datetime(timezone: Option<&str>) -> String {
    let now = chrono::Local::now();

    let tz_label = timezone.unwrap_or("system");
    let weekday_cn = match now.format("%A").to_string().as_str() {
        "Monday" => "星期一",
        "Tuesday" => "星期二",
        "Wednesday" => "星期三",
        "Thursday" => "星期四",
        "Friday" => "星期五",
        "Saturday" => "星期六",
        "Sunday" => "星期日",
        _ => "未知",
    };

    format!(
        "当前时间信息：\n\
         - 日期: {}\n\
         - 时间: {}\n\
         - 星期: {}\n\
         - 时区: {} ({})\n\
         - ISO 8601: {}\n\
         - Unix 时间戳: {}",
        now.format("%Y-%m-%d"),
        now.format("%H:%M:%S"),
        weekday_cn,
        now.format("%:z"),
        tz_label,
        now.format("%Y-%m-%dT%H:%M:%S%:z"),
        now.timestamp(),
    )
}

/// 文本编码/解码工具，支持 base64、url、hex
pub fn encode_decode(action: &str, encoding: &str, text: &str) -> String {
    match (action, encoding) {
        ("encode", "base64") => {
            use base64::Engine;
            base64::engine::general_purpose::STANDARD.encode(text.as_bytes())
        }
        ("decode", "base64") => {
            use base64::Engine;
            match base64::engine::general_purpose::STANDARD.decode(text) {
                Ok(bytes) => String::from_utf8_lossy(&bytes).to_string(),
                Err(e) => format!("Base64 解码失败: {}", e),
            }
        }
        ("encode", "url") => urlencoding::encode(text).to_string(),
        ("decode", "url") => urlencoding::decode(text)
            .map(|s| s.into_owned())
            .unwrap_or_else(|e| format!("URL 解码失败: {}", e)),
        ("encode", "hex") => text
            .as_bytes()
            .iter()
            .map(|b| format!("{:02x}", b))
            .collect(),
        ("decode", "hex") => {
            let cleaned: String = text.chars().filter(|c| !c.is_whitespace()).collect();
            let bytes: Result<Vec<u8>, _> = (0..cleaned.len())
                .step_by(2)
                .map(|i| u8::from_str_radix(&cleaned[i..i.min(cleaned.len()) + 2], 16))
                .collect();
            match bytes {
                Ok(b) => String::from_utf8_lossy(&b).to_string(),
                Err(e) => format!("Hex 解码失败: {}", e),
            }
        }
        _ => format!("不支持的操作: action={}, encoding={}", action, encoding),
    }
}

/// 查询 IP 地理位置信息（使用免费 ip-api.com）
pub async fn get_ip_geolocation(ip: Option<&str>) -> String {
    let url = match ip {
        Some(addr) if !addr.is_empty() => format!("http://ip-api.com/json/{}?lang=zh-CN", addr),
        _ => "http://ip-api.com/json/?lang=zh-CN".to_string(),
    };

    match web_scraper::fetch_url_raw(&url).await {
        result if result.starts_with("获取 URL 内容失败") || result.starts_with("不允许") =>
        {
            format!("IP 查询失败: {}", result)
        }
        json_str => {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&json_str) {
                if v.get("status").and_then(|s| s.as_str()) == Some("success") {
                    format!(
                        "IP 地理位置信息：\n\
                         - IP: {}\n\
                         - 国家: {}\n\
                         - 地区: {}\n\
                         - 城市: {}\n\
                         - ISP: {}\n\
                         - 经纬度: {}, {}\n\
                         - 时区: {}",
                        v["query"].as_str().unwrap_or("-"),
                        v["country"].as_str().unwrap_or("-"),
                        v["regionName"].as_str().unwrap_or("-"),
                        v["city"].as_str().unwrap_or("-"),
                        v["isp"].as_str().unwrap_or("-"),
                        v["lat"].as_f64().unwrap_or(0.0),
                        v["lon"].as_f64().unwrap_or(0.0),
                        v["timezone"].as_str().unwrap_or("-"),
                    )
                } else {
                    format!(
                        "IP 查询失败: {}",
                        v["message"].as_str().unwrap_or("未知错误")
                    )
                }
            } else {
                format!("IP 查询结果解析失败: {}", json_str)
            }
        }
    }
}

/// 生成文本的摘要统计（字符数、词数、行数等）
pub fn text_stats(text: &str) -> String {
    let chars = text.chars().count();
    let chars_no_space = text.chars().filter(|c| !c.is_whitespace()).count();
    let lines = text.lines().count();
    let words_en = text.split_whitespace().count();
    let chinese_chars = text
        .chars()
        .filter(|c| *c >= '\u{4e00}' && *c <= '\u{9fff}')
        .count();
    let bytes = text.len();

    format!(
        "文本统计：\n\
         - 总字符数: {}\n\
         - 非空白字符: {}\n\
         - 中文字符数: {}\n\
         - 英文单词数: {}\n\
         - 行数: {}\n\
         - 字节数: {} ({:.1} KB)",
        chars,
        chars_no_space,
        chinese_chars,
        words_en,
        lines,
        bytes,
        bytes as f64 / 1024.0,
    )
}
